"""
End-to-end demo for the Snapdragon AI Lab Build & Present Challenge.

Three modes:

  python run_demo.py --live "why do electric vehicle batteries degrade"
      Full pipeline: live Wikipedia retrieval + NPU rerank + NPU synthesis.

  python run_demo.py --offline question.json
      Fully offline run using pre-supplied evidence (no network at all) -
      this is the demo mode for the presentation.

  python run_demo.py --audit
      Runs the citation-audit unit checks without any model files -
      verifies the research boundary on any machine.

Model files are expected in snapdragon/models/ (see README.md for the
one-line download from Qualcomm AI Hub / Hugging Face).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS_DIR = HERE.parent / "models"
SYNTH_DIR = MODELS_DIR / "llama-v3.2-3b-instruct"
EMBED_PATH = MODELS_DIR / "all-MiniLM-L6-v2" / "model.onnx"

SAMPLE_QUESTION = "Why do lithium-ion batteries lose capacity over time?"
SAMPLE_EVIDENCE = [
    {
        "url": "https://en.wikipedia.org/wiki/Lithium-ion_battery",
        "title": "Lithium-ion battery",
        "text": (
            "Lithium-ion batteries degrade over time primarily through the growth of the "
            "solid electrolyte interphase (SEI) layer on the anode, which permanently "
            "consumes cyclable lithium. High temperatures accelerate parasitic reactions, "
            "and charging to high voltages stresses the cathode, causing transition-metal "
            "dissolution and structural cracking. Each charge-discharge cycle also causes "
            "mechanical stress from graphite lattice expansion and contraction."
        ),
    },
    {
        "url": "https://en.wikipedia.org/wiki/Solid_electrolyte_interphase",
        "title": "Solid electrolyte interphase",
        "text": (
            "The SEI is a passivation layer formed from electrolyte decomposition products "
            "on the negative electrode. It is beneficial because it prevents further "
            "electrolyte reduction, but its continued slow growth consumes lithium inventory, "
            "increases cell impedance, and is the dominant calendar-aging mechanism in "
            "lithium-ion cells."
        ),
    },
    {
        "url": "https://en.wikipedia.org/wiki/Battery_aging",
        "title": "Battery aging",
        "text": (
            "Battery capacity fade combines calendar aging (time-dependent, driven by "
            "temperature and state of charge) with cycle aging (usage-dependent, driven by "
            "depth of discharge and current magnitude). Some capacity loss can be "
            "temporarily recovered by rest; SEI growth and cathode cracking are irreversible."
        ),
    },
]


def run_audit_checks() -> bool:
    from synthesizer import audit_citations

    ok = True
    good = audit_citations("The SEI grows with time [1], consuming lithium [2].", 3)
    ok &= good.passed and good.used_citations == [1, 2]
    dangling = audit_citations("Something cited to nothing [7].", 3)
    ok &= (not dangling.passed) and dangling.dangling_citations == [7]
    uncited = audit_citations("No references at all.", 3)
    ok &= not uncited.passed
    print("citation audit checks:", "PASS" if ok else "FAIL")
    return bool(ok)


def build_pipeline(require_embedder: bool):
    from research_pipeline import LocalResearchPipeline
    from synthesizer import OnDeviceSynthesizer

    synth = OnDeviceSynthesizer(str(SYNTH_DIR))
    print(f"[runtime] synthesis provider: {synth.status.device_label}")

    embedder = None
    tokenizer = None
    if EMBED_PATH.exists():
        from evidence_ranker import OnDeviceEmbedder

        embedder = OnDeviceEmbedder(str(EMBED_PATH))
        print(f"[runtime] embedding provider: {embedder.status.device_label}")
        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(
            "sentence-transformers/all-MiniLM-L6-v2", local_files_only=True
        )
    elif require_embedder:
        raise FileNotFoundError(f"Embedding model missing: {EMBED_PATH} (see README)")
    else:
        print("[runtime] embedder not found - lexical order kept (dev mode)")

    return LocalResearchPipeline(synth, embedder, tokenizer)


def main() -> int:
    parser = argparse.ArgumentParser(description="TruthSearch Snapdragon demo")
    parser.add_argument("question", nargs="?", default=SAMPLE_QUESTION)
    parser.add_argument("--offline", help="JSON file with offline evidence", default=None)
    parser.add_argument("--audit", action="store_true", help="run citation audit checks only")
    args = parser.parse_args()

    if args.audit:
        return 0 if run_audit_checks() else 1

    pipeline = build_pipeline(require_embedder=False)

    offline_evidence = None
    if args.offline:
        with open(args.offline, "r", encoding="utf-8") as f:
            offline_evidence = json.load(f)

    print(f"\n[question] {args.question}\n")
    streamed: list[str] = []

    result = pipeline.research(
        args.question,
        offline_evidence=offline_evidence,
        on_token=lambda piece: (streamed.append(piece), print(piece, end="", flush=True)),
    )
    print("\n\n===== structured output =====")
    print(result.to_json())
    return 0


if __name__ == "__main__":
    sys.exit(main())
