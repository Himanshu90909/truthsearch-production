# TruthSearch — Snapdragon Edition

**On-device AI research workspace for Snapdragon-powered HP PCs.** The full TruthSearch research boundary — live retrieval, evidence ranking, cited synthesis, citation audit — with all AI inference moved off the cloud and onto the Snapdragon NPU via models from [Qualcomm AI Hub](https://aihub.qualcomm.com).

> **The pitch:** A private, offline-capable research assistant that runs entirely on your Snapdragon PC's Hexagon NPU. Your questions and your evidence never leave your device.

---

## Why this exists

TruthSearch's cloud deployment calls Gemini / Groq / Hugging Face for synthesis. This layer replaces that with **Llama-v3.2-3B-Instruct (w4a16)** — quantized and NPU-compiled on Qualcomm AI Hub — so the same cited-synthesis discipline runs with **zero network AI calls**. Per the challenge rules this is a *significant modification to add AI models from Qualcomm AI Hub*, which keeps an existing project eligible.

## Architecture

```
┌────────────────────────────── Snapdragon X Elite / X2 Elite NPU ──────────────────────────────┐
│                                                                                                │
│  all-MiniLM-L6-v2 (w8a16)                    Llama-v3.2-3B-Instruct (w4a16)                   │
│  ONNX Runtime + QNN_HTP                       onnxruntime-genai + QNN_HTP                       │
│  ─ evidence semantic reranking                ─ cited explanatory synthesis                     │
│  ─ runs per query, ~ms latency               ─ streams tokens, low temp, structured output     │
│                                                                                                │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ evidence                                        ▲ top-k passages
        │                                                │
┌───────┴────────────────────────────────────────────────┴───────────────────────────────────┐
│ LocalResearchPipeline (research_pipeline.py)                                                │
│ 1. live retrieval — public Wikipedia / Semantic Scholar APIs (only network traffic, optional)│
│ 2. canonicalize + dedup URLs                                                                │
│ 3. per-reason fetch failure counts (blocked / unsupported / empty / timeout)                  │
│ 4. semantic rerank on NPU                                                                    │
│ 5. on-device cited synthesis on NPU                                                          │
│ 6. citation audit — dangling [n] refs reject the answer                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Every stage runs locally. In `--offline` mode even retrieval is skipped (pre-supplied evidence), so the demo runs on airplane Wi-Fi — useful at a presentation.

## Models (all from Qualcomm AI Hub)

| Role | Model | Quant | Runtime | Verified chipsets |
|---|---|---|---|---|
| Synthesis | [Llama-v3.2-3B-Instruct](https://aihub.qualcomm.com/compute/models/llama_v3_2_3b_instruct) | w4a16 | ONNX Runtime GenAI (QNN_HTP) | Snapdragon X Elite, X2 Elite |
| Synthesis fallback | Llama-v3.2-1B-Instruct | w4a16 | ONNX Runtime GenAI (QNN_HTP) | X Elite, X2 Elite |
| Evidence reranking | [all-MiniLM-L6-v2](https://huggingface.co/qualcomm/all-MiniLM-L6-v2) | w8a16 | ONNX Runtime (QNN_HTP) | X Elite, X2 Elite |

An SSD (Self-Speculative Decoding) variant `llama_v3_2_3b_instruct_ssd` is available on AI Hub for faster token generation with identical accuracy.

## Setup (Windows 11 on Snapdragon / HP Omnibook)

```powershell
# 1. Python 3.10+ (ARM64 native build ships with the Windows on Snapdragon SDK)
cd snapdragon\engine
pip install -r requirements.txt

# 2. Download the NPU-compiled models
#    From AI Hub: compile/profile on "Snapdragon X Elite CRD", then download assets.
#    Pre-exported copies: huggingface.co/qualcomm/Llama-v3.2-3B-Instruct
#                         huggingface.co/qualcomm/all-MiniLM-L6-v2
#    Place under: snapdragon/models/llama-v3.2-3b-instruct/
#                 snapdragon/models/all-MiniLM-L6-v2/model.onnx

# 3. Verify the QNN execution provider is active
python -c "import onnxruntime as o; print(o.get_available_providers())"
# expect QNNExecutionProvider / QNNHtp listed

# 4. Run
python run_demo.py --live "Why do lithium-ion batteries lose capacity over time?"
python run_demo.py --offline sample_evidence.json     # fully offline demo
python run_demo.py --audit                            # citation-boundary checks
```

### Development machines (x86 / non-Snapdragon)

Same code, CPU execution provider, identical outputs, lower speed. The pipeline reports the active provider in every result (`device_label`), and the UI surfaces it — we never claim NPU execution when running on CPU.

## Research boundary (unchanged from the cloud path)

- Answers are synthesized **only** from retrieved evidence; the model is instructed accordingly.
- Every factual sentence carries `[n]` citations; `audit_citations()` rejects answers with dangling references.
- Pages that fail to fetch are reported with per-reason counts — no silent fallbacks.
- If evidence is missing, the answer says so in *Limitations*. Nothing is fabricated.

## What the NPU changes for users

| | Cloud path | Snapdragon path |
|---|---|---|
| Privacy | questions + evidence sent to 3rd-party APIs | never leave the device |
| Cost | per-token API spend | none |
| Offline | dead | full pipeline (offline evidence mode) |
| Latency | network RTT + queue | first token in milliseconds, on-NPU |
| Availability | provider rate limits / outages | always available |

## Relationship to the web app

`server/research.ts` remains the cloud engine for the hosted deployment. The Vercel/Base44 frontend can call a local Snapdragon bridge (same request/response shape) when running on a Windows-on-Snapdragon device — the `provider` field in the response distinguishes `QNN_HTP` from cloud providers, and the UI badge renders it.
