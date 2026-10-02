// VisionModelProvider — provider abstraction for multimodal vision models.
//
// Mirrors the research synthesis chain (HF router → Gemini → Groq), every
// provider speaking the OpenAI chat-completions shape with image_url input.
// A single custom override (VISION_API_URL + VISION_API_KEY + VISION_MODEL)
// takes priority, so vision can point at any OpenAI-compatible endpoint
// (vLLM, Ollama, OpenRouter, a Snapdragon NPU gateway …) without code changes.

const env = (key: string) => (process.env[key] ?? "").trim();

export type VisionProvider = {
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
};

export function visionProviders(): VisionProvider[] {
  const providers: VisionProvider[] = [];
  const customUrl = env("VISION_API_URL");
  const customKey = env("VISION_API_KEY");
  const customModel = env("VISION_MODEL");
  if (customUrl && customKey && customModel) {
    providers.push({ name: "custom", endpoint: customUrl.replace(/\/$/, ""), apiKey: customKey, model: customModel });
  }
  const geminiKey = env("GEMINI_API_KEY");
  if (geminiKey) {
    providers.push({ name: "gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", apiKey: geminiKey, model: env("VISION_MODEL_GEMINI") || "gemini-2.0-flash" });
  }
  const hfKey = env("HF_API_KEY");
  if (hfKey) {
    providers.push({ name: "huggingface", endpoint: "https://router.huggingface.co/v1/chat/completions", apiKey: hfKey, model: env("VISION_MODEL_HF") || "Qwen/Qwen2.5-VL-72B-Instruct" });
  }
  const groqKey = env("XAI_API_KEY") || env("GROQ_API_KEY");
  if (groqKey) {
    providers.push({ name: "groq", endpoint: "https://api.groq.com/openai/v1/chat/completions", apiKey: groqKey, model: env("VISION_MODEL_GROQ") || "meta-llama/llama-4-scout-17b-16e-instruct" });
  }
  return providers;
}

export function visionConfigured(): boolean {
  return visionProviders().length > 0;
}

export type VisionMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }> };

export type VisionInvokeOptions = {
  messages: VisionMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export type VisionResult = {
  text: string;
  provider: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number } | null;
  latencyMs: number;
};

async function postChat(provider: VisionProvider, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Vision provider ${provider.name} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const extractContent = (payload: any): string => {
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((part: any) => (typeof part === "string" ? part : part?.text ?? "")).join("");
  }
  return "";
};

// Non-streaming JSON-style call with provider fallback.
export async function invokeVision(options: VisionInvokeOptions): Promise<VisionResult> {
  const providers = visionProviders();
  if (!providers.length) throw new Error("No vision model is configured. Set GEMINI_API_KEY, HF_API_KEY, GROQ_API_KEY, or VISION_API_URL + VISION_API_KEY + VISION_MODEL.");
  let lastError: Error | null = null;
  for (const provider of providers) {
    const startedAt = Date.now();
    try {
      const response = await postChat(provider, {
        model: provider.model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.2,
      }, options.signal);
      const payload = await response.json();
      const text = extractContent(payload);
      if (!text.trim()) throw new Error(`Vision provider ${provider.name} returned an empty response.`);
      return {
        text,
        provider: provider.name,
        model: provider.model,
        usage: payload?.usage ? { promptTokens: payload.usage.prompt_tokens ?? 0, completionTokens: payload.usage.completion_tokens ?? 0 } : null,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      // fall through to the next provider
    }
  }
  throw lastError ?? new Error("All vision providers failed.");
}

// Streaming call against one provider (used by the SSE explanation route).
// Yields text deltas as they arrive.
export async function* invokeVisionStream(options: VisionInvokeOptions): AsyncGenerator<{ delta: string; provider: string; model: string }, void, void> {
  const providers = visionProviders();
  if (!providers.length) throw new Error("No vision model is configured. Set GEMINI_API_KEY, HF_API_KEY, GROQ_API_KEY, or VISION_API_URL + VISION_API_KEY + VISION_MODEL.");
  let lastError: Error | null = null;
  for (const provider of providers) {
    let response: Response;
    try {
      response = await postChat(provider, {
        model: provider.model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.2,
        stream: true,
      }, options.signal);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }
    // Streamed provider chosen — consume its SSE stream.
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let emitted = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const payload = JSON.parse(data);
            const delta = payload?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length) {
              emitted = true;
              yield { delta, provider: provider.name, model: provider.model };
            }
          } catch {
            // Ignore malformed keep-alive frames.
          }
        }
      }
    } finally {
      try { await reader.cancel(); } catch { /* connection already closed */ }
    }
    if (emitted) return;
    // No deltas emitted (empty stream) — try the next provider.
    lastError = new Error(`Vision provider ${provider.name} streamed no content.`);
  }
  throw lastError ?? new Error("All vision providers failed.");
}
