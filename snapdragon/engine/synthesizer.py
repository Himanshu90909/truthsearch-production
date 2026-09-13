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

import re
from dataclasses import dataclass, field
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
Every factual sentence must cite the passages it uses as [n] where n is the passage number.
If the evidence does not answer the question, say so plainly in the Limitations section.
Write the answer in this exact structure:
Direct answer / Why it happens / Evidence and sources / Conflicting evidence / Limitations / Conclusion / Suggested follow-up questions.
Be concise and explain causes in plain language."""


@dataclass
class CitationAuditResult:
    passed: bool
    used_citations: list[int] = field(default_factory=list)
    dangling_citations: list[int] = field(default_factory=list)


def build_prompt(question: str, passages: list[dict], text_key: str = "text") -> str:
    evidence_block = "\n\n".join(
        f"Passage {i + 1}: {p[text_key][:1200]}" for i, p in enumerate(passages)
    )
    return (
        f"{SYSTEM_PROMPT}\n\nQuestion: {question}\n\n"
        f"Evidence passages (the ONLY facts you may use):\n{evidence_block}\n\n"
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
        stream_callback=None,
    ) -> dict:
        """
        Run the full on-device synthesis. Returns
          {answer, citations, audit, provider, device_label, tokens_generated}.
        """
        og = self._og
        if not passages:
            raise ValueError("TruthSearch never answers without retrieved evidence.")

        prompt = build_prompt(question, passages, text_key)
        inputs = self.tokenizer.encode(prompt)

        params = og.GeneratorParams(self.model)
        params.set_search_options(
            {
                "max_length": self.max_length,
                "temperature": 0.2,   # low temperature: synthesis, not invention
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
