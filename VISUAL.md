# TruthSearch Visual Intelligence (in-chat)

AI image understanding built **into the main chat**, not a separate page:
attach a photo to any research question and the vision engine analyzes it —
what is visible, what is inferred, uncertainties, and any text in the image
(OCR) — then the answer in the thread reflects the image alongside the cited
web evidence. Attach documents (PDF/DOCX/XLSX/TXT/CSV/MD) and their extracted
text is analyzed the same way.

## How it works in the thread

1. Attach an image or document in the composer (paperclip) and ask your question.
2. Server pipeline (`server/research.ts`):
   - Images: `analyzeImageFromUrl` fetches the attachment, re-validates it
     (magic bytes, 8 MB, dimension parsing) and runs the vision analysis
     (`server/visual/analysis.ts`) — schema-validated structured JSON with
     one repair retry, coordinates sanitized, no fabrication.
   - The analysis is fed to the answer model as clearly-labeled untrusted
     content (never instructions), and shown in the thread.
   - Documents: extracted text is analyzed with BM25; in no-card mode the
     answer quotes the most relevant passages in a dedicated
     "From your document" section.
3. Honest behavior: with no vision model configured the thread says exactly
   that (no fake analysis). With no synthesis model, image analysis and
   document quotes still appear (extractive mode).

## Image generation (in-chat)

The composer's **Generate image** mode creates a picture from your prompt in the
same thread. Provider chain: the Base44 image service (GPT Image 2) when
configured, else Pollinations (keyless). Generated images are always labeled as
AI art — never research, never evidence, no fabricated citations.

## Vision provider chain (swappable, no code changes)

1. `VISION_API_URL` + `VISION_API_KEY` + `VISION_MODEL` (any OpenAI-compatible endpoint)
2. `GEMINI_API_KEY` → gemini-2.0-flash (`VISION_MODEL_GEMINI`)
3. `HF_API_KEY` → Qwen2.5-VL-72B-Instruct (`VISION_MODEL_HF`)
4. `GROQ_API_KEY`/`XAI_API_KEY` → llama-4-scout (`VISION_MODEL_GROQ`)

## Modules

`server/visual/generate.ts` — in-chat image generation (prompt extraction,
provider chain, byte validation, persistence with deterministic-URL fallback).

`server/visual/{schema,providers,prompts,analysis,annotation,diagram,db}.ts` —
zod-validated analysis JSON, coordinate sanitisation, deterministic SVG
rendering (used for exports), upload validation helpers (magic-byte MIME
sniffing, dimension parsing, size caps) and provider abstraction.

## Tests

`server/visual/visual.test.ts` + `server/research.test.ts` — MIME sniffing,
bbox sanitisation, schema rejection, JSON extraction, SVG escaping, provider
chain, URL-based in-chat analysis (valid attachment, non-image rejection,
header dimension parsing), extractive document sections and honest
no-vision-model notes.
