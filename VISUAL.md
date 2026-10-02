# TruthSearch Visual Intelligence

AI image understanding and visual explanation engine, integrated into TruthSearch.
Upload any image — diagram, chart, screenshot, code, handwritten note, photo — and get
an evidence-grounded explanation with numbered steps, region annotations, extracted
text and simplified diagrams.

Live at `/visual` on the TruthSearch app (sidebar → "Visual Intelligence").

## User journey

1. **Upload** — drag & drop, paste from clipboard, file picker, or camera (mobile).
   Preview with zoom, rotate and crop before analysis.
2. **Configure** — a question ("What would you like to understand about this image?"),
   six explanation modes (Explain, Analyze, Annotate, Simplify, Compare, Teach),
   four depths (Beginner → Technical), and 8 languages.
3. **Analyze** — the request streams over SSE with progress stages and cancellation.
   The vision model must return structured JSON that passes schema validation;
   invalid output is retried once, then the failure is reported honestly.
4. **Explore** — annotated overlay with interactive regions (hover a step to
   highlight its region; dashed outlines mark low-confidence detections),
   side-by-side original/annotated views, full OCR transcription, simplified
   SVG diagrams, visible-vs-inferred evidence blocks and uncertainties.
5. **Continue** — follow-up questions grounded in the image, 1–5 feedback rating,
   "Verify with TruthSearch" (launches a live research run with citations),
   download of the annotated PNG and the diagram SVG.
6. **History & privacy** — signed-in users keep sessions across devices and can
   delete any session (which removes its analyses, annotations, explanations,
   followups and the uploaded image). Uploads expire after the retention window.

## Architecture

```
server/visual/
  schema.ts     zod schemas + coordinate sanitisation (model output is untrusted)
  providers.ts   VisionModelProvider abstraction (OpenAI-compatible chain)
  prompts.ts    ExplanationGenerationService prompts (anti-hallucination + injection defense)
  analysis.ts   VisualAnalysisService orchestrator (+ OCRService, follow-ups)
  annotation.ts AnnotationEngine — deterministic, escaped SVG overlays
  diagram.ts    DiagramGenerationService — structured spec → deterministic SVG
  db.ts         VisualSessionService + ImageStorageService + UsageAndCostService
  router.ts     tRPC procedures (visual.*)
  routes.ts     GET /api/visual/image/:id (private) + GET /api/visual/stream/:id (SSE)
```

Frontend: `client/src/pages/Visual.tsx` (single page, existing design system).

### Provider chain (swappable, no code changes)

Priority order:

1. Custom override: `VISION_API_URL` + `VISION_API_KEY` + `VISION_MODEL`
   (any OpenAI-compatible endpoint — vLLM, Ollama, OpenRouter, an NPU gateway).
2. `GEMINI_API_KEY` → gemini-2.0-flash (override with `VISION_MODEL_GEMINI`)
3. `HF_API_KEY` → Qwen2.5-VL-72B-Instruct via HF router (`VISION_MODEL_HF`)
4. `GROQ_API_KEY`/`XAI_API_KEY` → llama-4-scout (`VISION_MODEL_GROQ`)

Every provider speaks the OpenAI chat-completions shape with `image_url` input.
Failover is automatic; the UI shows which provider and model produced an answer.
With no key configured the feature reports that honestly — no fake analyses.

## Database

Additive tables on the same Postgres instance (self-healing bootstrap in
`server/db.ts`, no manual migration needed): `visual_uploads`, `visual_sessions`,
`visual_analyses`, `visual_annotations`, `visual_explanations`, `visual_followups`,
`visual_feedback`, `visual_usage`. Drizzle definitions live in `drizzle/schema.ts`.

## Security & privacy

- **Upload validation** — magic-byte sniffing (JPEG/PNG/WebP/GIF), 8 MB limit,
  declared MIME never trusted, `x-content-type-options: nosniff` on serving.
- **Image privacy** — images are private: access requires session ownership
  (signed-in user id) or the unguessable upload token (capability URL).
- **Prompt-injection defense** — OCR'd image text is untrusted content; prompts
  instruct the model to never follow embedded instructions; nothing from the
  image is executed. Model text is escaped before it enters any SVG.
- **Coordinates** — all model bboxes are normalised/clamped against real image
  dimensions; degenerate boxes are dropped, not rendered.
- **Retention** — `VISUAL_RETENTION_DAYS` (default 30); expired uploads return 404
  and are pruned opportunistically. Session deletion cascades fully.
- **Rate limits** — hourly sliding window per user/IP (signed-in users get more).

## Operations

- **Env vars**: see provider list above. Optional: `VISUAL_RETENTION_DAYS`.
- **Monitoring**: `visual_usage` records per-call provider, model, tokens and
  latency; analytics events (`visual.started/completed/failed/feedback/deleted`)
  feed the existing event metrics.
- **Rollback**: the feature is additive — `git revert` the release commit and
  redeploy; old tables are simply unused by the previous build.

## Tests

`server/visual/visual.test.ts` — 23 tests: MIME sniffing, bbox sanitisation
(clamp/pixel-conversion/degenerate/rebind), schema rejection, JSON extraction,
SVG escaping, diagram rendering, prompt discipline, provider chain priority,
full pipeline against a stub provider (success, retry, honest failure), and
cross-user isolation + token gating + deletion in the data layer.
