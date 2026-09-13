# Proposal — Snapdragon AI Lab Build & Present Challenge

## TruthSearch: Evidence-First AI Research, Fully On-Device

**Participant:** Himanshu Suthar (HB) — resident of India, 18+
**Repository:** https://github.com/Himanshu90909/truthsearch-production
**Branch:** `snapdragon-ai-lab` — the significant modification described below
**Target hardware:** Snapdragon-powered HP PCs (Omnibook Ultra on Snapdragon X Elite, Omnibook 3 on Snapdragon X2 class)

---

### One-paragraph summary

TruthSearch is an evidence-first AI research workspace: it retrieves live public sources, extracts and ranks evidence, and produces a structured, citation-audited explanatory answer — with the hard rule that no answer may use facts absent from retrieved evidence, and any answer whose `[n]` citations don't exist is rejected. The original project ran synthesis on remote cloud APIs. **This submission significantly modifies that project to add AI models from Qualcomm AI Hub, moving the entire AI stack — semantic evidence reranking (all-MiniLM-L6-v2, w8a16) and cited synthesis (Llama-v3.2-3B-Instruct, w4a16) — onto the Snapdragon NPU via the QNN execution provider.** The result is a private, offline-capable research assistant: questions, evidence, and answers never leave the device, and the pipeline continues to work with zero connectivity.

---

### Application use case & innovation

**Problem.** Cloud AI research assistants send your questions — and everything you read — to third-party APIs. They cost per token, they rate-limit, they go down, and they die without Wi-Fi. Students, researchers, and professionals working with sensitive or personal topics have no private option.

**Solution.** TruthSearch's differentiation has always been *citation discipline*: structured answers (Direct answer / Why it happens / Evidence and sources / Conflicting evidence / Limitations / Conclusion / Follow-ups), every factual sentence cited, dangling-citation audit, explicit per-reason failure counts instead of silent fallbacks, and model-knowledge answers labeled as such. The Snapdragon modification keeps every one of those guarantees and removes the cloud:

- **Privacy:** the full pipeline — retrieval adapters, semantic reranking, synthesis, audit — runs on-device; in offline evidence mode the demo runs with airplane Wi-Fi.
- **Cost & availability:** zero per-token spend, zero rate limits, zero outages.
- **Innovation:** citation-audited, hallucination-resistant generation is rare even in cloud products; running it **fully on a 3B w4a16 NPU model** — where the model has less headroom to "know" answers it wasn't given — makes the evidence-only discipline the load-bearing design element, and it is what makes small on-device models trustworthy.

**Who it's for:** any Snapdragon PC user who researches with AI — students, analysts, journalists, engineers — with a first natural distribution channel in HP's education segment.

### Technical implementation

- **Models from Qualcomm AI Hub**, quantized and compiled for the target chipsets:
  - *Llama-v3.2-3B-Instruct* (w4a16, partially w8a16) — on-device synthesis, supported on Snapdragon X Elite / X2 Elite; SSD variant available for faster token generation with identical accuracy.
  - *all-MiniLM-L6-v2* (w8a16) — on-device 384-dim semantic reranking of retrieved passages.
- **Runtime stack:** ONNX Runtime GenAI + ONNX Runtime with the **QNN execution provider (QNN_HTP)** dispatching to the Hexagon NPU on Windows on Snapdragon (ARM64).
- **Engineering discipline:**
  - Provider auto-detection: QNN when present, CPU fallback elsewhere — same code path, identical outputs, and the active provider is surfaced in every result so the UI never claims NPU execution on a CPU.
  - Generation params tuned for synthesis-not-invention (temperature 0.2, top_p 0.9, evidence-only system prompt).
  - Citation audit (`audit_citations`) rejects answers with `[n]` references outside the evidence set; verifiable with `python run_demo.py --audit` on any machine.
  - The local pipeline (`snapdragon/engine/research_pipeline.py`) mirrors the production cloud pipeline (`server/research.ts`) stage-for-stage: bounded query variants, URL canonicalization + dedup, per-reason fetch-failure counts, evidence-only synthesis.
  - The existing production app (TypeScript monorepo, React/Vite client, deployed on Vercel + Base44 serverless) remains the hosted path; the Snapdragon layer is a first-class sibling, integrated behind the same request/response shape so the frontend can target either engine.

### Deployment & accessibility

- **Runs on the challenge's exact target class:** consumer HP Omnibook Ultra / Omnibook 3 on Snapdragon — no dev kit, no cloud account, no API keys needed after the model files are downloaded.
- **Setup:** one `pip install -r requirements.txt`, model folders from Qualcomm AI Hub / Hugging Face, and `python run_demo.py`. QNN provider verification is a one-liner.
- **Accessibility of the concept:** the offline demo mode (`--offline`) makes the product story demonstrable anywhere — a classroom, a conference, a train.
- **Free public adapters** (Wikipedia, Semantic Scholar) keep the live mode zero-cost, consistent with the project's existing no-card operating mode.

### Presentation & documentation

- `snapdragon/README.md` — architecture diagram, model table, setup for Windows on Snapdragon, dev fallback notes, and a cloud-vs-NPU comparison table.
- `PROPOSAL.md` (this file) — mapped one-to-one to the four evaluation criteria.
- Existing docs (`FULLSTACK_DEPLOYMENT.md`, `VERCEL_DEPLOYMENT.md`, `verification-notes.md`) show the production discipline the project was built with.
- Demo flow for the presentation: live question → watch stages stream → offline re-run with airplane Wi-Fi → `--audit` proof of the research boundary.

---

### Statement of originality & eligibility

The TruthSearch project and the Snapdragon modification are the participant's own work. The project existed before the submission period and has been **significantly modified to add AI models from Qualcomm AI Hub** (Llama-v3.2-3B-Instruct w4a16 and all-MiniLM-L6-v2 w8a16 with the QNN runtime), per the submission guidelines. Models are used under the LLAMA3 license and Qualcomm AI Hub terms; no confidential information is included. This is the participant's single submission to the challenge.
