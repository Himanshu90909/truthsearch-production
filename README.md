# TruthSearch

TruthSearch is a research workspace for asking arbitrary questions and inspecting the path from live retrieval to cited synthesis. It does not ship a demo answer bank and it does not silently substitute generated content when a provider fails.

## No-card operating mode

The default web adapter is the public Wikipedia API and the default academic adapter is Semantic Scholar. These services may be rate-limited and are not a guarantee of broad web coverage, but they allow development and real queries without purchasing a search card. For stronger general-web coverage, configure Brave or Tavily using project secrets; if a selected paid provider is not configured, the session fails explicitly rather than falling back to fabricated data.

## Research boundary

A session creates bounded query variants, calls live providers, canonicalizes and deduplicates URLs, fetches only public HTTP(S) pages, rejects private-network targets, extracts readable passages, scores source quality from observable signals, ranks evidence lexically, and asks the server-side LLM to synthesize only from the retrieved evidence. The interface exposes completed backend stages, source URLs, quality signals, and an evidence trail; it does not expose private chain-of-thought.

## Training and evaluation

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
