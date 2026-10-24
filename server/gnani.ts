/**
 * Gnani AI speech integration (api.vachana.ai)
 *
 * Adds an Indian-language voice layer to TruthSearch:
 *  - Prisma v2.5 speech-to-text: the hero composer gets a mic button — speak
 *    your research question in Hindi, English or code-mixed Hinglish and it
 *    lands in the input box.
 *  - Timbre v2.5 text-to-speech: answers get a "Listen" button so the
 *    evidence-backed conclusion can be heard, not just read.
 *
 * Configured via GNANI_API_KEY (create one in the Gnani API dashboard).
 * The key is only ever used server-side; clients talk to this module through
 * the `gnani` tRPC router.
 */

const GNANI_BASE = (process.env.GNANI_BASE_URL || "https://api.vachana.ai").replace(/\/+$/, "");

export function gnaniConfigured(): boolean {
  return Boolean(process.env.GNANI_API_KEY);
}

/** BCP-47 codes Prisma v2.5 accepts for REST transcription. */
export const STT_LANGUAGES = [
  "indic-auto", // auto-detect across supported Indic languages
  "hi-IN", "en-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "ta-IN", "te-IN", "as-IN",
] as const;

/** Language codes Timbre v2.5 accepts for synthesis ("auto" = detect from script). */
export const TTS_LANGUAGES = [
  "auto", "hi-IN", "hi-en", "en-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "ta-IN", "te-IN",
] as const;

export type SttLanguage = (typeof STT_LANGUAGES)[number];
export type TtsLanguage = (typeof TTS_LANGUAGES)[number];

type GnaniError = { success: false; error?: { type?: string; message?: string } };

function errorDetail(body: unknown, fallback: string): string {
  const err = (body as GnaniError)?.error;
  return err?.message || err?.type || fallback;
}

/**
 * Transcribe a short audio clip (≤60s) with Prisma v2.5.
 * `audioBase64` is the raw audio bytes; `mimeType` one of the formats Prisma
 * accepts (wav, mp3, ogg, flac, aac, m4a).
 */
export async function gnaniTranscribe(params: {
  audioBase64: string;
  mimeType: string;
  languageCode: SttLanguage;
}): Promise<{ transcript: string; languageCode: string; requestId: string }> {
  if (!gnaniConfigured()) {
    throw new Error("Gnani speech is not configured: set GNANI_API_KEY to enable voice questions.");
  }
  const bytes = Buffer.from(params.audioBase64, "base64");
  if (!bytes.length) throw new Error("Empty audio recording.");
  const ext = params.mimeType.includes("wav") ? "wav"
    : params.mimeType.includes("mpeg") || params.mimeType.includes("mp3") ? "mp3"
    : params.mimeType.includes("ogg") ? "ogg"
    : params.mimeType.includes("flac") ? "flac"
    : params.mimeType.includes("aac") ? "aac"
    : params.mimeType.includes("mp4") || params.mimeType.includes("m4a") ? "m4a"
    : "wav";
  const form = new FormData();
  form.append("audio_file", new Blob([bytes], { type: params.mimeType }), `recording.${ext}`);
  form.append("language_code", params.languageCode);
  form.append("format", "transcribe");
  const res = await fetch(`${GNANI_BASE}/stt/v3`, {
    method: "POST",
    headers: { "X-API-Key-ID": process.env.GNANI_API_KEY as string },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; transcript?: string; request_id?: string } & GnaniError;
  if (!res.ok || !body.success || typeof body.transcript !== "string") {
    throw new Error(`Gnani speech-to-text failed: ${errorDetail(body, `HTTP ${res.status}`)}`);
  }
  return { transcript: body.transcript.trim(), languageCode: params.languageCode, requestId: body.request_id || "" };
}

/** Strip markdown syntax so Timbre reads plain prose, not asterisks and link URLs. */
export function markdownToSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code snippet omitted) ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, "link omitted")
    .replace(/[#*_`>|]+/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Synthesize speech with Timbre v2.5 and return mp3 audio as base64.
 * Text is capped so the response stays comfortably inside serverless
 * payload limits (~4.5MB on Vercel): 3,500 chars ≈ 3–4 minutes of speech.
 */
export async function gnaniSpeak(params: {
  text: string;
  language: TtsLanguage;
  voice?: string;
}): Promise<{ audioBase64: string; mimeType: "audio/mpeg" }> {
  if (!gnaniConfigured()) {
    throw new Error("Gnani speech is not configured: set GNANI_API_KEY to enable spoken answers.");
  }
  const text = markdownToSpeech(params.text).slice(0, 3500);
  if (!text) throw new Error("Nothing to speak: the answer has no readable text.");
  const res = await fetch(`${GNANI_BASE}/api/v1/tts/inference`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key-ID": process.env.GNANI_API_KEY as string },
    body: JSON.stringify({
      text,
      model: "timbre-v2.5",
      voice: params.voice || "Nalini",
      language: params.language,
      speed: 1.0,
      audio_config: { container: "mp3", bitrate: "64k", sample_rate: 16000, num_channels: 1 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as GnaniError;
    throw new Error(`Gnani text-to-speech failed: ${errorDetail(body, `HTTP ${res.status}`)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("Gnani text-to-speech returned empty audio.");
  return { audioBase64: buffer.toString("base64"), mimeType: "audio/mpeg" };
}
