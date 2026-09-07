# HB Innovators by Himanshu Suthar

## TruthSearch

**HB Innovators by Himanshu Suthar** is the creator attribution for this TruthSearch research workspace. TruthSearch is a research workspace for asking arbitrary questions and inspecting the path from live retrieval to cited synthesis. It does not ship a demo answer bank and it does not present model-knowledge answers as sourced research — answers that fall back to the model are labeled as such.

## No-card operating mode

The default web adapter is the public Wikipedia API and the default academic adapter is Semantic Scholar. These services may be rate-limited and are not a guarantee of broad web coverage, but they allow development and real queries without purchasing a search card. For stronger general-web coverage, configure Brave or Tavily using project secrets; if a selected paid provider is not configured, the session fails explicitly rather than falling back to fabricated data.

## Research boundary

A session creates bounded query variants, calls live providers, canonicalizes and deduplicates URLs, fetches only public HTTP(S) pages, rejects private-network targets, extracts readable passages, scores source quality from observable signals, ranks evidence lexically, and asks the server-side LLM to synthesize only from the retrieved evidence. Pages that cannot be fetched are reported with per-reason counts (blocked, unsupported content type, no readable text, timed out) instead of failing silently. The interface exposes completed backend stages, source URLs, quality signals, and an evidence trail; it does not expose private chain-of-thought.

## Explanatory synthesis (research first, then causes)

Answers are written in a fixed structure — Direct answer, Why it happens (causal analysis), Evidence and sources, Conflicting evidence, Limitations, Conclusion, Suggested follow-up questions — so a question is not answered with a bare list of sources. The synthesis model is instructed to explain the mechanisms and causes behind the answer in plain language, reasoning across the retrieved evidence, while every factual sentence still cites the retrieved passages. The citation audit rejects any answer whose `[n]` references do not exist in the retrieved evidence.

## Answer model

The synthesis backend is a single fixed model, the way Perplexity runs one pipeline: `meta-models/Muse-Glimmer-30B`, an image-text-to-text model served through Hugging Face Inference Providers and called via `https://router.huggingface.co/v1/chat/completions`. The model is not trained, fine-tuned, or hosted in this repository; it is called as a remote service. The only required secret is `HF_API_KEY`. If it is missing, synthesis fails explicitly rather than substituting generated content.

User-attached images are passed to the model as vision input: a user can attach an image and ask about it, and the model answers from what it sees, while any web-research facts still come only from the retrieved, cited evidence.

## Always answering, honestly labeled

Every question gets an answer. When live research cannot answer the question — no readable sources, no verifiable passages, or a technical/programming question the web results do not address — the model answers from its own knowledge instead of failing, and the answer is labeled for what it is: sentences from the model carry an inline 'model knowledge' mark, and a knowledge-only answer opens with an explicit notice that nothing is web-cited. Answers grounded in retrieved evidence keep their [n] citations. The citation audit still rejects any invalid reference, and a missing HF_API_KEY still fails explicitly rather than fabricating.

Training and evaluation

The web runtime is deliberately not a GPU training environment. The scripts under `training/` are real entry points for licensed Hugging Face-compatible datasets and will detect CPU versus CUDA, stream rows, cap examples, checkpoint models, and record the actual configuration. They fail clearly when the optional ML dependencies are missing. They never write invented metrics. Use a suitable GPU machine for large runs:

```bash
pip install torch datasets sentence-transformers
python training/retriever/train.py --dataset <licensed-dataset> --max-examples 1000000 --output artifacts/retriever
python training/reranker/train.py --dataset <licensed-labelled-dataset> --max-examples 1000000 --output artifacts/reranker
python evaluation/run.py --dataset <licensed-eval-dataset> --model-version <checkpoint> --output artifacts/evaluation/report.json
```

The current production request path uses a deterministic lexical ranking core and records the intended dense/reranker extension points. It must not claim that a custom retriever or reranker has been trained until an external run produces checkpoints and measured evaluation artifacts.

## Local development

Run `pnpm dev` for the application, `pnpm check` for TypeScript validation, `pnpm test` for unit tests, and `pnpm build` for the production bundle. Set `SEARCH_PROVIDER=wikipedia` and `ACADEMIC_SEARCH_PROVIDER=semanticScholar` for the no-card path. The application still requires the managed database and built-in server-side LLM variables supplied by the hosting environment.

## Limitations recorded intentionally

Public providers can throttle or reject requests. Some pages block automated retrieval or expose little readable text. Cross-source contradiction detection is currently conservative and should be expanded with labelled entailment data. Large-scale ML training, distributed jobs, model registry hosting, and production cross-encoder inference require an external GPU-capable service; they are not honestly performed inside the constrained single-process web runtime.
