// ImageGenerationService — generates images from a prompt, in the main chat.
//
// Provider chain (first available wins, honest on failure):
//   1. Base44 forge image service (GPT Image 2) when BUILT_IN_FORGE_* is configured
//   2. Pollinations (keyless, free) — prompt+seed URLs are deterministic and
//      server-side cached, so the returned URL is stable enough to embed.
//
// Generated images are AI art, never research: the answer always labels them.

import { storagePut } from "../storage";
import { sniffImageMime } from "./db";
import { generateImage as forgeGenerateImage } from "../_core/imageGeneration";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Strip "generate an image of ..." wrappers so the model gets a clean prompt.
export function extractImagePrompt(question: string): string {
  const raw = question.trim().replace(/^(please\s+)?(can\s+you\s+|could\s+you\s+)?/i, "");
  const stripped = raw
    .replace(/^(generate|create|make|draw|paint|design|render)\s+(me\s+)?(an?\s+)?(ai\s+)?(image|picture|illustration|photo(?:graph)?|art(?:work)?|drawing|painting|wallpaper|logo|icon)\s*(of|for|about|showing|depicting|that\s+shows)?\s*/i, "")
    .replace(/^(generate|create|make|draw|paint|design|render)\s+(me\s+)?(an?\s+)?/i, "")
    .trim();
  const prompt = (stripped.length >= 3 ? stripped : raw).replace(/\s+/g, " ");
  return prompt.slice(0, 700);
}

export type GeneratedImage = { url: string; provider: string; model: string; prompt: string };

export async function generateResearchImage(question: string): Promise<GeneratedImage> {
  const prompt = extractImagePrompt(question);

  // 1) Base44 forge image service (GPT Image 2), when configured on the host.
  if (process.env.BUILT_IN_FORGE_API_URL && process.env.BUILT_IN_FORGE_API_KEY) {
    try {
      const r = await forgeGenerateImage({ prompt });
      if (r?.url) return { url: r.url, provider: "Base44 image service", model: "gpt-image-2", prompt };
    } catch {
      // fall through to the keyless provider below
    }
  }

  // 2) Pollinations — keyless. The seed makes the URL deterministic: repeat
  // fetches return the same cached image, so the URL is embeddable.
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const sourceUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(55_000) });
  if (!res.ok) throw new Error(`the image service did not respond (${res.status}). Try again in a moment.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error("the generated image was too large to store.");
  const mime = sniffImageMime(buf);
  if (!mime) throw new Error("the image service did not return a valid image.");

  // Persist to app storage when available; otherwise embed the deterministic
  // source URL directly.
  try {
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const { url } = await storagePut(`generated/${Date.now()}-${seed}.${ext}`, new Uint8Array(buf), mime);
    return { url, provider: "Pollinations", model: "flux", prompt };
  } catch {
    return { url: sourceUrl, provider: "Pollinations", model: "flux", prompt };
  }
}
