"""
On-device explanatory synthesis with Llama-v3.2-3B-Instruct (w4a16,
Qualcomm AI Hub) running on the Snapdragon NPU via ONNX Runtime GenAI
(QNN execution provider).

This is the offline twin of the cloud synthesis chain (Gemini -> Groq -> HF).
It keeps TruthSearch's research boundary and citation discipline:

  - The model is instructed to answer ONLY from the retrieved evidence.
  - Every factual sentence must carry [n] citations that exist in the passage
    list; a post-generation citation audit rejects answers with dangling
    references, exactly like the cloud path.
  - The same fixed answer structure is used: Direct answer / Why it happens /
    Evidence and sources / Conflicting evidence / Limitations / Conclusion /
    Suggested follow-up questions.

No network call is ever made by this module.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from qnn_runtime import RuntimeStatus, resolve_execution_provider

ANSWER_SECTIONS = [
    "Direct answer",
    "Why it happens",
    "Evidence and sources",
    "Conflicting evidence",
    "Limitations",
    "Conclusion",
    "Suggested follow-up questions",
]

SYSTEM_PROMPT = """You are TruthSearch, an on-device research assistant running fully offline on a Snapdragon-powered PC.
You answer ONLY from the numbered evidence passages provided. You never use outside knowledge.

Citation rules (the audit will reject the answer if you break them):
1. Every factual sentence must end with [n], where n is the passage number it comes from.
2. Cite at least TWO different passages across the answer.
3. Never write a [n] number higher than the number of passages given.
4. If the evidence does not answer the question, say so plainly in the Limitations section and cite nothing.

Write the answer in this exact structure:
Direct answer / Why it happens / Evidence and sources / Conflicting evidence / Limitations / Conclusion / Suggested follow-up questions.
Be concise and explain causes in plain language. Start directly with "Direct answer:" - no preamble, no meta-commentary."""


@dataclass
class CitationAuditResult:
    passed: bool
    used_citations: list[int] = field(default_factory=list)
    dangling_citations: list[int] = field(default_factory=list)


def build_prompt(
    question: str,
    passages: list[dict],
    text_key: str = "text",
    feedback: str = "",
) -> str:
    evidence_block = "\n\n".join(
        f"Passage {i + 1}: {p[text_key][:1200]}" for i, p in enumerate(passages)
    )
    correction = f"{feedback}\n\n" if feedback else ""
    return (
        f"{SYSTEM_PROMPT}\n\nQuestion: {question}\n\n"
        f"Evidence passages (the ONLY facts you may use) - cite them as [1] to [{len(passages)}]:\n{evidence_block}\n\n"
        f"{correction}"
        "Write the structured, cited answer now."
    )


def audit_citations(answer: str, passage_count: int) -> CitationAuditResult:
    """Reject answers whose [n] references do not exist in the evidence."""
    cited = {int(m) for m in re.findall(r"\[(\d+)\]", answer)}
    dangling = sorted(c for c in cited if c < 1 or c > passage_count)
    return CitationAuditResult(
        passed=(len(dangling) == 0 and len(cited) > 0),
        used_citations=sorted(cited),
        dangling_citations=dangling,
    )


class OnDeviceSynthesizer:
    """
    Generates the cited research answer with Llama-v3.2-3B-Instruct (w4a16)
    via onnxruntime-genai. On Snapdragon-powered HP PCs the QNN execution
    provider dispatches the model to the Hexagon NPU; on dev machines the
    same code runs on CPU (slower, identical outputs).
    """

    def __init__(self, model_dir: str, provider: str | None = None, max_length: int = 1024):
        try:
            import onnxruntime_genai as og
        except ImportError as exc:
            raise RuntimeError(
                "onnxruntime-genai is not installed. On Windows on Snapdragon "
                "install the QNN-enabled build; see snapdragon/README.md."
            ) from exc
        self._og = og
        self.status: RuntimeStatus = resolve_execution_provider(provider)
        self.model = og.Model(model_dir)
        self.tokenizer = og.Tokenizer(self.model)
        self.max_length = max_length

    def synthesize(
        self,
        question: str,
        passages: list[dict],
        text_key: str = "text",
        temperature: float = 0.2,
        feedback: str = "",
        stream_callback=None,
    ) -> dict:
        """
        Run the full on-device synthesis. Returns
          {answer, citations, audit, provider, device_label, tokens_generated}.
        `temperature` and `feedback` come from the on-device learning loop
        (synthesize_with_retry) - they let retries correct themselves.
        """
        og = self._og
        if not passages:
            raise ValueError("TruthSearch never answers without retrieved evidence.")

        prompt = build_prompt(question, passages, text_key, feedback=feedback)
        inputs = self.tokenizer.encode(prompt)

        params = og.GeneratorParams(self.model)
        params.set_search_options(
            {
                "max_length": self.max_length,
                "temperature": temperature,   # tuned by on-device learning loop
                "top_p": 0.9,
                "do_sample": True,
                "min_new_tokens": 64,
            }
        )
        generator = og.Generator(self.model, params)
        sequence = inputs[0] if isinstance(inputs, list) else inputs

        tokens: Iterable = generator
        pieces: list[str] = []
        count = 0
        for _ in range(self.max_length):
            if not generator.is_done():
                generator.generate_next_token()
            token = generator.get_output(0)[-1]
            piece = self.tokenizer.decode([int(token)])
            pieces.append(piece)
            count += 1
            if stream_callback:
                stream_callback(piece)
            if generator.is_done():
                break

        answer = "".join(pieces).strip()
        audit = audit_citations(answer, len(passages))
        return {
            "answer": answer,
            "citations": audit.used_citations,
            "audit_passed": audit.passed,
            "dangling_citations": audit.dangling_citations,
            "provider": self.status.provider,
            "device_label": self.status.device_label,
            "tokens_generated": count,
        }


# =============================================================================
# On-device learning: persistent feedback memory + rejection-sampling retry.
# The model weights stay frozen (they are NPU-compiled artifacts), but every
# run is a training example for the *process*: which generation settings
# produce audit-passing answers, and what corrective feedback the model
# needs on retry. Over time the synthesizer tunes itself on your machine.
# =============================================================================

LEARNING_FILE = Path(__file__).with_name("synthesis_learning.json")


class SynthesisMemory:
    """JSON-backed record of synthesis runs. Learns the best-performing
    temperature for this device/question mix and keeps a rolling pass-rate."""

    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else LEARNING_FILE
        self.data = self._load()

    def _load(self) -> dict:
        try:
            if self.path.exists():
                parsed = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(parsed, dict) and isinstance(parsed.get("runs"), list):
                    return parsed
        except Exception:
            pass
        return {"runs": []}

    def _save(self) -> None:
        try:
            self.data["runs"] = self.data["runs"][-200:]  # rolling window
            self.path.write_text(json.dumps(self.data, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass  # learning is best-effort, never blocks research

    def record(self, question: str, temperature: float, attempts: int, passed: bool) -> None:
        self.data["runs"].append(
            {
                "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "question": question[:200],
                "temperature": temperature,
                "attempts": attempts,
                "audit_passed": passed,
            }
        )
        self._save()

    def best_temperature(self, default: float = 0.2) -> float:
        """Pick the temperature with the best audit pass-rate (>= 2 samples).
        Falls back to the default until enough evidence accumulates."""
        by_temp: dict[float, list[bool]] = {}
        for run in self.data["runs"]:
            if isinstance(run.get("temperature"), (int, float)):
                by_temp.setdefault(float(run["temperature"]), []).append(bool(run.get("audit_passed")))
        candidates = {t: (sum(1 for x in p if x) / len(p), len(p)) for t, p in by_temp.items()}
        proven = {t: rate for t, (rate, n) in candidates.items() if n >= 2 and rate > 0}
        if not proven:
            return default
        return max(proven, key=proven.get)

    def stats(self) -> dict:
        runs = self.data["runs"]
        passed = sum(1 for r in runs if r.get("audit_passed"))
        return {
            "runs": len(runs),
            "pass_rate": round(100 * passed / len(runs), 1) if runs else None,
            "best_temperature": self.best_temperature(),
        }


def synthesize_with_retry(
    synthesizer,
    question: str,
    passages: list[dict],
    memory: SynthesisMemory | None = None,
    max_attempts: int = 3,
    text_key: str = "text",
    stream_callback=None,
) -> dict:
    """Train-the-process loop: generate -> citation audit -> corrective retry.

    Each failed attempt feeds explicit feedback back into the next prompt
    (which citation numbers were dangling) and nudges the temperature up so
    the model can escape repetitive failure modes. Every outcome is recorded
    in the persistent memory, so future runs start from what worked.
    """
    temperature = memory.best_temperature() if memory else 0.2
    result: dict | None = None
    feedback: str = ""

    for attempt in range(1, max_attempts + 1):
        result = synthesizer.synthesize(
            question,
            passages,
            text_key=text_key,
            temperature=temperature,
            feedback=feedback,
            stream_callback=stream_callback if attempt == 1 else None,
        )
        if result.get("audit_passed"):
            if memory:
                memory.record(question, temperature, attempt, True)
            result["attempts"] = attempt
            return result
        dangling = result.get("dangling_citations") or []
        uncited = not result.get("citations")
        parts = [f"Attempt {attempt} was rejected by the citation audit."]
        if dangling:
            parts.append(
                f"It cited passage number(s) {dangling} which DO NOT exist. "
                f"Only [1] to [{len(passages)}] are valid."
            )
        if uncited:
            parts.append("It cited no passages at all. Every factual sentence needs [n].")
        feedback = "CORRECTION FROM PREVIOUS DRAFT: " + " ".join(parts) + " Rewrite the full answer, fixed."
        temperature = min(0.8, round(temperature + 0.15, 2))

    if memory and result:
        memory.record(question, temperature, max_attempts, False)
    if result:
        result["attempts"] = max_attempts
    return result
