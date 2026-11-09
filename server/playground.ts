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

type ProviderId = "inception" | "nvidia" | "freellm" | "hf" | "astraflow" | "atlas" | "pollinations" | "openai" | "fal" | "google" | "gemini" | "evon" | "groq" | "openrouter" | "cerebras";

const PROVIDERS: Record<ProviderId, { baseUrl: () => string; envKey?: string; family: string; chatPath?: string }> = {
  inception: { baseUrl: () => withV1(env("INCEPTION_BASE_URL") || "https://api.inceptionlabs.ai/v1"), envKey: "INCEPTION_API_KEY", family: "Inception Labs" },
  nvidia: { baseUrl: () => withV1(env("NVIDIA_BASE_URL") || "https://integrate.api.nvidia.com/v1"), envKey: "NVIDIA_API_KEY", family: "NVIDIA NIM" },
  freellm: { baseUrl: () => withV1(env("FREELLMAPI_BASE_URL") || "https://freellmapi.vercel.app"), envKey: "FREELLMAPI_API_KEY", family: "Free models" },
  // Hugging Face router: one OpenAI-compatible endpoint in front of every
  // serverless provider HF hosts. The catalogue is public, chat needs HF_API_KEY.
  hf: { baseUrl: () => withV1(env("HF_BASE_URL") || "https://router.huggingface.co/v1"), envKey: "HF_API_KEY", family: "Hugging Face" },
  // Keyless free tier: Pollinations serves one anonymous reasoning model with no
  // signup, which is what "free models" means without any credit card.
  pollinations: { baseUrl: () => (env("POLLINATIONS_BASE_URL") || "https://text.pollinations.ai").replace(/\/+$/, ""), family: "Pollinations", chatPath: "/openai" },
  openai: { baseUrl: () => (env("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, ""), envKey: "OPENAI_API_KEY", family: "OpenAI" },
  fal: { baseUrl: () => (env("FAL_BASE_URL") || "https://fal.run").replace(/\/+$/, ""), envKey: "FAL_KEY", family: "fal.ai" },
  // Gemini's OpenAI-compatible surface: free-tier text works on an AI Studio key
  // even when image generation on the same key is quota-blocked.
  gemini: { baseUrl: () => `${(env("GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "")}/openai`, envKey: "GOOGLE_API_KEY", family: "Google" },
  google: { baseUrl: () => (env("GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, ""), envKey: "GOOGLE_API_KEY", family: "Google" },
  // Gnani Evon v3.3 (30B MoE, Apache 2.0) has no hosted inference anywhere, so
  // it only appears once a self-hosted OpenAI-compatible endpoint (vLLM/SGLang
  // on Modal or an HF Inference Endpoint) is pointed at by EVON_BASE_URL.
  // Free-tier gateways that actually serve Qwen. Each lights up the moment its
  // key exists, so adding one account adds the whole Qwen family to the picker.
  groq: { baseUrl: () => (env("GROQ_BASE_URL") || "https://api.groq.com/openai/v1").replace(/\/+$/, ""), envKey: "GROQ_API_KEY", family: "Qwen on Groq" },
  openrouter: { baseUrl: () => (env("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1").replace(/\/+$/, ""), envKey: "OPENROUTER_API_KEY", family: "Qwen on OpenRouter" },
  cerebras: { baseUrl: () => (env("CEREBRAS_BASE_URL") || "https://api.cerebras.ai/v1").replace(/\/+$/, ""), envKey: "CEREBRAS_API_KEY", family: "Qwen on Cerebras" },
  evon: { baseUrl: () => (env("EVON_BASE_URL") || "").replace(/\/+$/, ""), envKey: "EVON_API_KEY", family: "Gnani" },
  astraflow: { baseUrl: () => withV1(env("ASTRAFLOW_BASE_URL") || "https://api.umodelverse.ai/v1"), envKey: "ASTRAFLOW_API_KEY", family: "Astraflow" },
  atlas: { baseUrl: () => withV1(env("ATLAS_BASE_URL") || "https://api.atlascloud.ai/v1"), envKey: "ATLAS_API_KEY", family: "Atlas Cloud" },
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
  image?: boolean;
};

// Curated catalogue: the models this NVIDIA/Inception account can actually
// serve. Order matters — it is the picker order.
const CATALOG: PlaygroundModel[] = [
  { id: "gnani/gnani-evon-v3.3-30B-A3B", provider: "evon", label: "Evon v3.3 30B", family: "Gnani", note: "Indic MoE, self-hosted", reasoning: true, vision: false, maxOutput: 32768 },
  { id: "qwen/qwen3-32b", provider: "groq", label: "Qwen3 32B", family: "Qwen on Groq", note: "free tier, fast", reasoning: false, vision: false, maxOutput: 8192 },
  { id: "qwen/qwen3-235b-a22b:free", provider: "openrouter", label: "Qwen3 235B (free)", family: "Qwen on OpenRouter", note: "free tier", reasoning: true, vision: false, maxOutput: 8192 },
  { id: "qwen-3-32b", provider: "cerebras", label: "Qwen3 32B", family: "Qwen on Cerebras", note: "free tier, very fast", reasoning: false, vision: false, maxOutput: 8192 },
  { id: "gemini-3.1-flash-lite", provider: "gemini", label: "Gemini 3.1 Flash Lite", family: "Google", note: "free tier", reasoning: false, vision: false, maxOutput: 8192 },
  { id: "gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash", family: "Google", note: "free tier, vision", reasoning: false, vision: true, maxOutput: 8192 },
  { id: "gemini-2.5-flash-image", provider: "google", label: "Gemini Flash Image", family: "Google", note: "text-to-image, free tier key", reasoning: false, vision: false, maxOutput: 0, image: true },
  { id: "gpt-image-1", provider: "openai", label: "GPT Image 1", family: "OpenAI", note: "text-to-image, needs OPENAI_API_KEY", reasoning: false, vision: false, maxOutput: 0, image: true },
  { id: "fal-ai/flux/dev", provider: "fal", label: "Flux Dev", family: "fal.ai", note: "text-to-image, needs FAL_KEY", reasoning: false, vision: false, maxOutput: 0, image: true },
  { id: "openai-fast", provider: "pollinations", label: "GPT-OSS 20B", family: "Pollinations", note: "free, no key, reasoning", reasoning: true, vision: false, maxOutput: 4096 },
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

// ---------------------------------------------------------------------------
// Free-model discovery. Anything an OpenAI-compatible provider advertises at
// /models is listed automatically, so a free gateway (FreeLLMAPI) or a trial
// key (Astraflow, Atlas) needs no code change: add the env vars and the models
// show up in the picker. Curated entries keep their hand-written labels.
// ---------------------------------------------------------------------------
// NVIDIA publishes far more model ids than this account is allowed to serve:
// probing 41 of them on 2026-11-08 left 7 working, so the extra ones are only
// listed once they answer. Re-probe with /api/playground/models?debug=1.
const VERIFIED_EXTRA: Partial<Record<ProviderId, Set<string>>> = {
  // Probed 2026-11-08: gemma-4-31b-it never finished inside 55s, so only
  // this one extra is listed alongside the curated Nemotron/Mistral/Meta set.
  nvidia: new Set(["minimaxai/minimax-m3.1-flash"]),
  // Inception lists helper endpoints (e.g. mercury-decide) that chat rejects.
  inception: new Set<string>(),
  gemini: new Set<string>(),
  groq: new Set<string>(),
  openrouter: new Set<string>(),
  cerebras: new Set<string>(),
};

const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 6000;
const DISCOVERY_LIMIT = 40;
const SKIP_MODEL = /(embed|whisper|tts|speech|audio|dall|stable-diffusion|sdxl|flux|rerank|moderation|guard|ocr|fuyu|deplot|kosmos|detector|calibration|diffusion|reward|classifier|safety)/i;
const VISION_HINT = /(vision|--vl|-vl\b|llava|pixtral|gemma-?3|omni|multimodal)/i;
const REASONING_HINT = /(think|reason|r1\b|qwq|o1|o3|deepseek-r)/i;

type Discovered = { at: number; models: PlaygroundModel[]; status: string };
const discoveryStatus: Record<string, string> = {};
const discoveryCache = new Map<ProviderId, Discovered>();

function labelFor(id: string) {
  const tail = id.split("/").pop() || id;
  return tail
    .replace(/[-_.]+/g, " ")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Gpt|Llm|Api|Ai)\b/g, (m) => m.toUpperCase())
    .trim();
}

// Hugging Face only serves the router to accounts with PRO or pre-paid
// credits, so a key alone is not enough. One 1-token call decides whether the
// catalogue is usable and keeps dead models out of the picker.
async function hfCanInfer(key: string, modelId: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROVIDERS.hf.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      signal: controller.signal,
    });
    if (res.ok) return null;
    const detail = (await res.text()).slice(0, 300);
    if (res.status === 402 || /credits|PRO|quota|billing/i.test(detail)) return "needs credits or PRO";
    return `http ${res.status}`;
  } catch {
    return "probe failed";
  } finally {
    clearTimeout(timer);
  }
}

// Some keys authenticate but cannot infer: a fresh OpenAI key with no credits
// answers /models and then 429s every call. One cheap probe per provider keeps
// those models (text and image) out of the picker until the account can pay.
const PROBE_MODELS: Partial<Record<ProviderId, string>> = { hf: "", openai: "gpt-4o-mini" };
const probeCache = new Map<ProviderId, { at: number; problem: string | null }>();

async function probeProvider(provider: ProviderId, key: string, firstModel?: string): Promise<string | null> {
  const cached = probeCache.get(provider);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.problem;

  const model = PROBE_MODELS[provider] || firstModel || "";
  if (!model) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  let problem: string | null = null;
  try {
    const res = await fetch(`${PROVIDERS[provider].baseUrl()}${PROVIDERS[provider].chatPath || "/chat/completions"}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      problem = /credit|quota|billing|402/i.test(detail) || res.status === 402 ? "no credits" : `http ${res.status}`;
    }
  } catch {
    problem = "probe failed";
  } finally {
    clearTimeout(timer);
  }
  probeCache.set(provider, { at: Date.now(), problem });
  return problem;
}

async function discoverProvider(provider: ProviderId): Promise<PlaygroundModel[]> {
  const keyName = PROVIDERS[provider].envKey;
  const key = keyName ? env(keyName) : "";
  if (keyName && !key) return [];
  const cached = discoveryCache.get(provider);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.models;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  let models: PlaygroundModel[] = [];
  try {
    const res = await fetch(`${PROVIDERS[provider].baseUrl()}/models`, {
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), accept: "application/json" },
      signal: controller.signal,
    });
    discoveryStatus[provider] = `http ${res.status}`;
    if (res.ok) {
      const payload: unknown = await res.json();
      const raw = Array.isArray(payload)
        ? payload
        : ((payload as { data?: unknown[]; models?: unknown[] })?.data ??
           (payload as { models?: unknown[] })?.models ??
           []);
      const seen = new Set<string>();
      discoveryStatus[provider] = `http ${res.status}, ${raw.length} entries`;
      models = (raw as Array<{ id?: string; name?: string }>)
        .map((item) => String(item?.id || item?.name || "").trim())
        .filter((id) => id && !SKIP_MODEL.test(id) && !seen.has(id) && seen.add(id))
        .slice(0, DISCOVERY_LIMIT)
        .map((id) => ({
          id,
          provider,
          label: labelFor(id),
          family: PROVIDERS[provider].family,
          note: "free tier",
          reasoning: REASONING_HINT.test(id),
          vision: VISION_HINT.test(id),
          maxOutput: 8192,
        }));
    }
  } catch (error) {
    discoveryStatus[provider] = `error: ${String((error as Error)?.message || error).slice(0, 80)}`;
    // A missing or slow gateway must never break the picker: cached or empty.
    models = cached?.models ?? [];
  } finally {
    clearTimeout(timer);
  }
  if (provider === "hf" && models.length) {
    const problem = await hfCanInfer(key as string, models[0].id);
    if (problem) {
      discoveryStatus.hf = `catalogue ${models.length}, unusable: ${problem}`;
      models = [];
    }
  }

  discoveryCache.set(provider, { at: Date.now(), models, status: discoveryStatus[provider] || (models.length ? "ok" : "empty") });
  return models;
}

/** Curated models first, then everything the configured gateways advertise. */
// Image models fail independently of text ones: a Gemini key that chats fine
// still returns 429 for every image call on the free tier. One tiny render
// decides whether the image entry is worth showing.
const imageProbeCache = new Map<ProviderId, { at: number; ok: boolean }>();

async function imageModelUsable(provider: ProviderId, key: string): Promise<boolean> {
  const cached = imageProbeCache.get(provider);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.ok;
  if (provider !== "google") return true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS * 2);
  let ok = false;
  try {
    const res = await fetch(
      `${PROVIDERS.google.baseUrl()}/models/gemini-3.1-flash-lite-image:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "red dot" }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
        signal: controller.signal,
      },
    );
    ok = res.ok;
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  imageProbeCache.set(provider, { at: Date.now(), ok });
  return ok;
}

function providerAvailable(provider: ProviderId) {
  const keyName = PROVIDERS[provider].envKey;
  if (provider === "evon") return Boolean(env("EVON_BASE_URL") && env("EVON_API_KEY"));
  return keyName ? Boolean(env(keyName)) : true;
}

export async function playgroundModels(): Promise<Array<PlaygroundModel & { available: boolean }>> {
  const discovered = (
    await Promise.all((Object.keys(PROVIDERS) as ProviderId[]).map(discoverProvider))
  ).flat();

  const blocked = new Set<ProviderId>();
  await Promise.all(
    (Object.entries(PROBE_MODELS) as Array<[ProviderId, string]>).map(async ([provider]) => {
      const keyName = PROVIDERS[provider].envKey;
      const key = keyName ? env(keyName) : "";
      if (!key) return;
      const problem = await probeProvider(provider, key);
      if (problem) blocked.add(provider);
    }),
  );

  const imageOk = new Map<ProviderId, boolean>();
  await Promise.all(
    Array.from(new Set(CATALOG.filter((m) => m.image).map((m) => m.provider))).map(async (provider) => {
      const keyName = PROVIDERS[provider].envKey;
      const key = keyName ? env(keyName) : "";
      const usable = key || !keyName ? await imageModelUsable(provider, key as string) : false;
      imageOk.set(provider, usable && !blocked.has(provider));
    }),
  );

  const curated = CATALOG.map((model) => ({
    ...model,
    available: model.image
      ? Boolean(imageOk.get(model.provider))
      : providerAvailable(model.provider) && !blocked.has(model.provider),
  }));
  const known = new Set(curated.map((m) => m.id));
  const extra = discovered
    .filter((m) => !known.has(m.id))
    .filter((m) => !blocked.has(m.provider))
    .filter((m) => {
      const allow = VERIFIED_EXTRA[m.provider];
      // Providers with a curated list only surface models verified to answer.
      return allow ? allow.has(m.id) : true;
    })
    .map((m) => ({ ...m, available: providerAvailable(m.provider) && !blocked.has(m.provider) }));

  return [...curated, ...extra];
}

async function resolveModel(id: string) {
  const all = await playgroundModels();
  return all.find((m) => m.id === id) ?? null;
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

// Text-to-image is provider-specific. Each image model names its provider, so
// adding a key is all it takes for that model to appear in the picker.
async function handleImage(req: Request, res: Response) {
  const body = (req.body || {}) as { prompt?: unknown; model?: unknown; size?: unknown };
  const prompt = String(body.prompt || "").trim().slice(0, 4000);
  if (prompt.length < 3) {
    res.status(400).json({ error: "Describe the image you want (at least a few words)." });
    return;
  }
  const requested = String(body.model || "gpt-image-1");
  const model = CATALOG.find((m) => m.id === requested && m.image);
  if (!model) {
    res.status(400).json({ error: `Unknown image model: ${requested}` });
    return;
  }
  const provider = PROVIDERS[model.provider];
  const apiKey = provider.envKey ? env(provider.envKey) : "";
  if (provider.envKey && !apiKey) {
    res.status(503).json({ error: `${model.label} is not configured on this deployment (${provider.envKey} missing).` });
    return;
  }
  const ip = String(req.headers["x-forwarded-for"] || "local").split(",")[0].trim();
  if (!rateOk(`img:${ip}`)) {
    res.status(429).json({ error: "Image limit reached for this hour. Try again shortly." });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    let url = "";
    if (model.provider === "openai") {
      const upstream = await fetch(`${provider.baseUrl()}/images/generations`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model.id, prompt, size: "1024x1024", n: 1 }),
        signal: controller.signal,
      });
      const payload = (await upstream.json().catch(() => ({}))) as {
        data?: Array<{ url?: string; b64_json?: string }>;
        error?: { message?: string };
      };
      if (!upstream.ok) throw new Error(payload.error?.message || `${model.label} returned ${upstream.status}`);
      const first = payload.data?.[0];
      url = first?.url || (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : "");
    } else if (model.provider === "google") {
      // Gemini image models answer through generateContent with IMAGE modality,
      // and the free AI Studio tier covers them without billing.
      const upstream = await fetch(
        `${provider.baseUrl()}/models/${model.id}:generateContent?key=${encodeURIComponent(String(apiKey || ""))}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
          signal: controller.signal,
        },
      );
      const payload = (await upstream.json().catch(() => ({}))) as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
        error?: { message?: string };
      };
      if (!upstream.ok) throw new Error(payload.error?.message || `${model.label} returned ${upstream.status}`);
      const part = payload.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const data = part?.inlineData?.data;
      if (data) url = `data:${part?.inlineData?.mimeType || "image/png"};base64,${data}`;
    } else if (model.provider === "fal") {
      const upstream = await fetch(`${provider.baseUrl()}/${model.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Key ${apiKey}` },
        body: JSON.stringify({ prompt, image_size: "square_hd", num_images: 1 }),
        signal: controller.signal,
      });
      const payload = (await upstream.json().catch(() => ({}))) as {
        images?: Array<{ url?: string }>;
        detail?: unknown;
      };
      if (!upstream.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : `${model.label} returned ${upstream.status}`);
      url = payload.images?.[0]?.url || "";
    }

    if (!url) throw new Error(`${model.label} did not return an image.`);
    res.status(200).json({ url, prompt, model: model.id });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? "The image took too long to render. Try a shorter prompt." : String((error as Error)?.message || error),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function handleModels(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  const models = await playgroundModels();
  const debug = String(req.query?.debug || "") === "1";
  res.status(200).json(debug ? { models, discovery: discoveryStatus } : { models });
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
  const model = await resolveModel(requested);
  if (!model) {
    res.status(400).json({ error: `Unknown model: ${requested || "(none)"}` });
    return;
  }

  const provider = PROVIDERS[model.provider];
  const apiKey = provider.envKey ? env(provider.envKey) : "";
  if (provider.envKey && !apiKey) {
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
    upstream = await fetch(`${provider.baseUrl()}${provider.chatPath || "/chat/completions"}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
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

/* ------------------------------------------------------------------ voice ---
 * Mic input and read-aloud for the composer, the way ChatGPT does it: the
 * browser records, normalises to 16 kHz mono WAV (Vachana's STT wants a real
 * container) and posts the bytes here. Speech never leaves Gnani's API.
 */
const vachanaBase = () => (env("VACHANA_BASE_URL") || "https://api.vachana.ai").replace(/\/+$/, "");
const vachanaKey = () => env("VACHANA_API_KEY") || env("VACHANA_API_KEY_2") || env("GNANI_API_KEY") || "";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const VOICES = ["Avinash", "Shivani", "Lakshmi", "Kalpana", "Shubham", "Prakash", "Devansh", "Yashraj", "Chetana", "Vasudha"];

function wavFromPcm(pcm: Buffer, sampleRate = 24000, channels = 1) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function handleStt(req: Request, res: Response) {
  const key = vachanaKey();
  if (!key) {
    res.status(503).json({ error: "Speech-to-text is not configured on this deployment." });
    return;
  }
  const audio = req.body as Buffer;
  if (!Buffer.isBuffer(audio) || audio.length < 2000) {
    res.status(400).json({ error: "No audio received. Hold the mic and speak, then release." });
    return;
  }
  if (audio.length > 20 * 1024 * 1024) {
    res.status(413).json({ error: "Recording too long. Keep it under 20MB (about two minutes)." });
    return;
  }
  const ip = String(req.headers["x-forwarded-for"] || "local").split(",")[0].trim();
  if (!rateOk(`stt:${ip}`)) {
    res.status(429).json({ error: "Voice limit reached for this hour. Try again shortly." });
    return;
  }
  const language = String(req.query.language || "hi-IN");
  const form = new FormData();
  form.append("audio_file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "voice.wav");
  form.append("language_code", language);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const upstream = await fetch(`${vachanaBase()}/stt/v3`, {
      method: "POST",
      headers: { "X-API-Key-ID": key, "user-agent": BROWSER_UA },
      body: form,
      signal: controller.signal,
    });
    const data = (await upstream.json().catch(() => ({}))) as { transcript?: string; message?: string };
    if (!upstream.ok) {
      res.status(502).json({ error: data.message || `Transcription failed (${upstream.status}).` });
      return;
    }
    res.status(200).json({ text: String(data.transcript || "").trim(), language });
  } catch (error) {
    res.status(504).json({ error: String((error as Error)?.message || "Transcription timed out.") });
  } finally {
    clearTimeout(timer);
  }
}

async function handleTts(req: Request, res: Response) {
  const key = vachanaKey();
  if (!key) {
    res.status(503).json({ error: "Speech output is not configured on this deployment." });
    return;
  }
  const body = (req.body || {}) as { text?: unknown; language?: unknown; voice?: unknown };
  const text = String(body.text || "").trim().slice(0, 1200);
  if (text.length < 2) {
    res.status(400).json({ error: "Nothing to read out." });
    return;
  }
  const language = String(body.language || "hi");
  const voice = VOICES.includes(String(body.voice)) ? String(body.voice) : "Avinash";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const upstream = await fetch(`${vachanaBase()}/api/v1/tts/inference`, {
      method: "POST",
      headers: { "X-API-Key-ID": key, "content-type": "application/json", "user-agent": BROWSER_UA },
      body: JSON.stringify({ text, model: "timbre-v3.0", language, voice }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      res.status(502).json({ error: detail.slice(0, 200) || `Speech failed (${upstream.status}).` });
      return;
    }
    // Timbre returns headerless s16le PCM at 24 kHz mono.
    const wav = wavFromPcm(Buffer.from(await upstream.arrayBuffer()));
    res.setHeader("content-type", "audio/wav");
    res.setHeader("cache-control", "no-store");
    res.status(200).send(wav);
  } catch (error) {
    res.status(504).json({ error: String((error as Error)?.message || "Speech timed out.") });
  } finally {
    clearTimeout(timer);
  }
}

function handleVoiceInfo(_req: Request, res: Response) {
  res.status(200).json({ enabled: Boolean(vachanaKey()), voices: VOICES, model: "timbre-v3.0", stt: "prisma-v2.5" });
}

export function registerPlaygroundRoutes(app: Express) {
  app.get("/api/playground/models", handleModels);
  app.post("/api/playground/chat", handleChat);
  app.post("/api/playground/image", handleImage);
  app.get("/api/playground/voice", handleVoiceInfo);
  app.post(
    "/api/playground/stt",
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("express").raw({ type: ["audio/wav", "audio/webm", "application/octet-stream"], limit: "20mb" }),
    handleStt,
  );
  app.post("/api/playground/tts", handleTts);
}
