/**
 * Playground API — a model playground that lives inside the research app.
 *
 * Two additive routes, deliberately isolated from the research pipeline so
 * nothing about sessions, sources or synthesis changes:
 *
 *   GET  /api/playground/models   public model catalogue with availability
 *   POST /api/playground/chat     streaming (SSE) proxy to the model provider
 *
 * Provider keys stay server-side; the browser only ever sees catalogue ids.
 * Models are only offered when their provider key is configured on this
 * deployment, so the picker degrades gracefully on forks without keys.
 */
import type { Express, Request, Response } from "express";

const env = (key: string) => process.env[key]?.trim();

function withV1(base: string) {
  const trimmed = base.replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

type ProviderId = "inception" | "nvidia";

const PROVIDERS: Record<ProviderId, { baseUrl: () => string; envKey: string }> = {
  inception: {
    baseUrl: () => withV1(env("INCEPTION_BASE_URL") || "https://api.inceptionlabs.ai/v1"),
    envKey: "INCEPTION_API_KEY",
  },
  nvidia: {
    baseUrl: () => withV1(env("NVIDIA_BASE_URL") || "https://integrate.api.nvidia.com/v1"),
    envKey: "NVIDIA_API_KEY",
  },
};

type PlaygroundModel = {
  id: string;
  provider: ProviderId;
  label: string;
  family: string;
  note: string;
  reasoning: boolean;
  vision: boolean;
  maxOutput: number;
};

// Curated catalogue: the models this NVIDIA/Inception account can actually
// serve. Order matters — it is the picker order.
const CATALOG: PlaygroundModel[] = [
  { id: "mercury-3", provider: "inception", label: "Mercury 3", family: "Inception Labs", note: "diffusion LM, near-instant", reasoning: false, vision: false, maxOutput: 8192 },
  { id: "nvidia/nemotron-3.5-bolt-e4b", provider: "nvidia", label: "Nemotron 3.5 Bolt", family: "NVIDIA NIM", note: "tiny and fast, no thinking", reasoning: false, vision: false, maxOutput: 8192 },
  { id: "nvidia/nemotron-3.5-lightning-30b-a3b", provider: "nvidia", label: "Nemotron 3.5 Lightning", family: "NVIDIA NIM", note: "30B MoE, thinking", reasoning: true, vision: false, maxOutput: 8192 },
  { id: "nvidia/nemotron-3.5-super-vl-120b-a12b", provider: "nvidia", label: "Nemotron 3.5 Super VL", family: "NVIDIA NIM", note: "120B, vision-capable", reasoning: true, vision: true, maxOutput: 16384 },
  { id: "nvidia/nemotron-3-ultra-550b-a55b", provider: "nvidia", label: "Nemotron 3 Ultra", family: "NVIDIA NIM", note: "550B MoE, long context", reasoning: true, vision: false, maxOutput: 16384 },
  { id: "mistralai/mistral-large-4-1t-a52b", provider: "nvidia", label: "Mistral Large 4", family: "Mistral on NIM", note: "1T MoE, slow cold start", reasoning: false, vision: false, maxOutput: 8192 },
  { id: "meta/llama-3.2-90b-vision-instruct", provider: "nvidia", label: "Llama 3.2 90B Vision", family: "Meta", note: "reads images and documents by sight", reasoning: false, vision: true, maxOutput: 4096 },
  { id: "meta/muse-glimmer-30b", provider: "nvidia", label: "Muse Glimmer 30B", family: "Meta", note: "30B, thinking", reasoning: true, vision: false, maxOutput: 8192 },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", provider: "nvidia", label: "Nemotron 3 Nano Omni", family: "NVIDIA NIM", note: "small, multimodal, thinking", reasoning: true, vision: true, maxOutput: 8192 },
];

export function playgroundModels() {
  return CATALOG.map((model) => ({
    id: model.id,
    label: model.label,
    family: model.family,
    note: model.note,
    reasoning: model.reasoning,
    vision: model.vision,
    provider: model.provider,
    maxOutput: model.maxOutput,
    available: Boolean(env(PROVIDERS[model.provider].envKey)),
  }));
}

// ---------------------------------------------------------------------------
// Usage guard: sliding-window hourly limit per client IP. In-memory per
// instance, same trade-off as the research guard in routers.ts.
// ---------------------------------------------------------------------------
const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 120;
const buckets = new Map<string, number[]>();

function rateOk(key: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= LIMIT) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 4000) buckets.clear();
  return true;
}

const MAX_IMAGE_CHARS = 2.6 * 1024 * 1024;

type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ChatMessage = { role: "user" | "assistant" | "system"; content: string | ChatPart[] };

function cleanContent(content: unknown): string | ChatPart[] {
  if (typeof content === "string") return content.slice(0, 24000);
  if (!Array.isArray(content)) return "";
  const parts: ChatPart[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const item = part as { type?: string; text?: string; image_url?: { url?: string } };
    if (item.type === "text" && typeof item.text === "string") {
      const text = item.text.slice(0, 24000);
      if (text.trim()) parts.push({ type: "text", text });
    } else if (item.type === "image_url") {
      const url = String(item.image_url?.url || "");
      const okData = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(url) && url.length <= MAX_IMAGE_CHARS;
      const okHttp = /^https:\/\/[^\s]+$/.test(url);
      if (okData || okHttp) parts.push({ type: "image_url", image_url: { url } });
    }
  }
  return parts;
}

function hasContent(content: string | ChatPart[]) {
  return typeof content === "string" ? content.trim().length > 0 : content.length > 0;
}

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is { role: "user" | "assistant"; content: unknown } => Boolean(m) && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: cleanContent(m.content) }))
    .filter((m) => hasContent(m.content))
    .slice(-24);
}

async function handleModels(_req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ models: playgroundModels() });
}

async function handleChat(req: Request, res: Response) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body = req.body as Record<string, unknown> | string | undefined;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "Body must be JSON" });
      return;
    }
  }
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Body must be JSON" });
    return;
  }

  const requested = String((body as { model?: string }).model || "");
  const model = CATALOG.find((m) => m.id === requested);
  if (!model) {
    res.status(400).json({ error: `Unknown model: ${requested || "(none)"}` });
    return;
  }

  const provider = PROVIDERS[model.provider];
  const apiKey = env(provider.envKey);
  if (!apiKey) {
    res.status(503).json({ error: `${model.family} is not configured on this deployment (${provider.envKey} missing).` });
    return;
  }

  const ip = String(req.headers["x-forwarded-for"] || "local").split(",")[0].trim();
  if (!rateOk(ip)) {
    res.status(429).json({ error: "Rate limit reached for this hour. Try again shortly." });
    return;
  }

  const payloadIn = body as {
    messages?: unknown;
    system?: unknown;
    temperature?: unknown;
    topP?: unknown;
    maxTokens?: unknown;
    stream?: unknown;
  };

  const messages = sanitizeMessages(payloadIn.messages);
  if (!messages.length) {
    res.status(400).json({ error: "At least one user message is required." });
    return;
  }

  const system = String(payloadIn.system || "").slice(0, 12000).trim();
  if (system) messages.unshift({ role: "system", content: system });

  const temperature = Number.isFinite(Number(payloadIn.temperature)) ? Math.min(2, Math.max(0, Number(payloadIn.temperature))) : 0.7;
  const topP = Number.isFinite(Number(payloadIn.topP)) ? Math.min(1, Math.max(0.01, Number(payloadIn.topP))) : 0.95;
  const maxTokens = Number.isFinite(Number(payloadIn.maxTokens))
    ? Math.min(model.maxOutput, Math.max(64, Math.round(Number(payloadIn.maxTokens))))
    : Math.min(2048, model.maxOutput);
  const stream = payloadIn.stream !== false;

  const payload: Record<string, unknown> = {
    model: model.id,
    messages,
    temperature,
    top_p: topP,
    max_tokens: maxTokens,
    stream,
  };
  if (stream && model.provider === "nvidia") payload.stream_options = { include_usage: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);

  let upstream: Awaited<ReturnType<typeof fetch>>;
  try {
    upstream = await fetch(`${provider.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const timedOut = controller.signal.aborted;
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? "The model took too long to respond." : `Could not reach ${model.family}: ${String((error as Error)?.message || error)}`,
    });
    return;
  }

  if (!upstream.ok) {
    clearTimeout(timer);
    let detail = "";
    try {
      detail = await upstream.text();
    } catch {}
    let message = detail.slice(0, 500);
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string }; message?: string };
      message = parsed.error?.message || parsed.message || message;
    } catch {}
    res.status(upstream.status).json({ error: message || `${model.family} returned ${upstream.status}` });
    return;
  }

  if (!stream) {
    clearTimeout(timer);
    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      usage?: unknown;
    };
    res.status(200).json({
      text: data.choices?.[0]?.message?.content || "",
      reasoning: data.choices?.[0]?.message?.reasoning_content || "",
      usage: data.usage || null,
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const upstreamBody = upstream.body;
  if (!upstreamBody) {
    clearTimeout(timer);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let sawDone = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) {
        if (text.includes("[DONE]")) sawDone = true;
        res.write(text);
      }
    }
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: String((error as Error)?.message || error) })}\n\n`);
  } finally {
    clearTimeout(timer);
    if (!sawDone) res.write("data: [DONE]\n\n");
    res.end();
  }
}

export function registerPlaygroundRoutes(app: Express) {
  app.get("/api/playground/models", handleModels);
  app.post("/api/playground/chat", handleChat);
}
