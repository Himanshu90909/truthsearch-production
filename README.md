# HB Innovators by Himanshu Suthar

## TruthSearch

**HB Innovators by Himanshu Suthar** is the creator attribution for this TruthSearch research workspace. TruthSearch is a research workspace for asking arbitrary questions and inspecting the path from live retrieval to cited synthesis. It does not ship a demo answer bank and it does not present model-knowledge answers as sourced research — answers that fall back to the model are labeled as such.

## No-card operating mode

The default web adapter is the public Wikipedia API and the default academic adapter is Semantic Scholar. These services may be rate-limited and are not a guarantee of broad web coverage, but they allow development and real queries without purchasing a search card. For stronger general-web coverage, configure Brave or Tavily using project secrets; if a selected paid provider is not configured, the session fails explicitly rather than falling back to fabricated data.

## Research boundary

A session creates bounded query variants, calls live providers, canonicalizes and deduplicates URLs, fetches only public HTTP(S) pages, rejects private-network targets, extracts readable passages, scores source quality from observable signals, ranks evidence lexically, and asks the server-side LLM to synthesize only from the retrieved evidence. Pages that cannot be fetched are reported with per-reason counts (blocked, unsupported content type, no readable text, timed out) instead of failing silently. The interface exposes completed backend stages, source URLs, quality signals, and an evidence trail; it does not expose private chain-of-thought.

## Explanatory synthesis (research first, then causes)

Answers are written in a fixed structure — Direct answer, Why it happens (causal analysis), Evidence and sources, Conflicting evidence, Limitations, Conclusion, Suggested follow-up questions — so a question is not answered with a bare list of sources. The synthesis model is instructed to explain the mechanisms and causes behind the answer in plain language, reasoning across the retrieved evidence, while every factual sentence still cites the retrieved passages. The citation audit rejects any answer whose `[n]` references do not exist in the retrieved evidence.

## Answer models

The production backend is the Base44 serverless function included in this repository at `server/base44/truthsearchResearch.ts` and deployed at `https://solene-7c76de54.base44.app/functions/truthsearchResearch`. It runs the full research pipeline — query planning, live multi-source search (Wikipedia, arXiv, Europe PMC), evidence ranking, and causal synthesis — and the Vercel frontend calls it directly.

Synthesis runs through a three-provider free-tier chain with automatic failover, internally (like Perplexity, with no model picker in the UI):

1. **Google Gemini 2.5 Flash** (primary; `GEMINI_API_KEY`, free tier ~1,500 requests/day, includes vision for image questions)
2. **Groq GPT-OSS-120b, then Qwen3.8-27b** (fallback; `GROK_API_KEY`, free daily-reset limits, sub-second latency)
3. **Hugging Face Inference Providers router** (last resort; `HF_API_KEY`, used while monthly included credits remain)

If every provider fails, synthesis fails explicitly with the per-provider reasons; nothing is fabricated. Attached images are fetched, base64-inlined, and passed to the vision-capable primary as inline image parts, so a user can upload an image and ask about it. Models are never trained or hosted here — they are called as remote services.

The frontend server (`server/research.ts`) keeps the same no-card research boundary: bounded query variants, live providers, canonicalization and deduplication, readable-passage extraction, quality scoring, and explicit per-reason failure counts instead of silent fallbacks.

## Local development

Run `pnpm dev` for the application, `pnpm check` for TypeScript validation, `pnpm test` for unit tests, and `pnpm build` for the production bundle. Set `SEARCH_PROVIDER=wikipedia` and `ACADEMIC_SEARCH_PROVIDER=semanticScholar` for the no-card path. The application still requires the managed database and built-in server-side LLM variables supplied by the hosting environment.

## Limitations recorded intentionally

Public providers can throttle or reject requests. Some pages block automated retrieval or expose little readable text. Cross-source contradiction detection is currently conservative and should be expanded with labelled entailment data. Large-scale ML training, distributed jobs, model registry hosting, and production cross-encoder inference require an external GPU-capable service; they are not honestly performed inside the constrained single-process web runtime.
