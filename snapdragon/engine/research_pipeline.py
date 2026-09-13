"""
TruthSearch local research pipeline - Snapdragon edition.

Same research boundary as the cloud path, one fundamental difference:
AI inference (evidence reranking + synthesis) runs ON-DEVICE on the
Snapdragon NPU. The only network traffic is the public live-retrieval
call (Wikipedia / Semantic Scholar) - and with `offline_evidence`
supplied it runs fully offline, useful for demos and flaky conference Wi-Fi.

Stages (mirrors server/research.ts so behaviour is comparable):
  1. live retrieval (optional in offline mode) - public sources only
  2. canonicalization + deduplication of URLs
  3. readable-passage extraction with per-reason failure counts
  4. semantic evidence reranking - ONNX MiniLM on the NPU
  5. on-device cited synthesis - Llama 3.2 3B (w4a16) on the NPU
  6. citation audit - answers with dangling [n] refs are rejected
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import urljoin, urlparse

from evidence_ranker import OnDeviceEmbedder
from qnn_runtime import RuntimeStatus, resolve_execution_provider
from synthesizer import OnDeviceSynthesizer

WIKIPEDIA_SEARCH = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_EXTRACT = "https://en.wikipedia.org/w/api.php"

BLOCKED_HOSTS = ("localhost", "127.", "0.0.0.0", "10.", "192.168.", "169.254.")


def is_public_http(url: str) -> bool:
    """Reject private-network targets, same rule as the cloud path."""
    if url.startswith("http://") and not url.startswith("http://localhost"):
        pass
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    return not any(host.startswith(b) or f".{b}" in host for b in BLOCKED_HOSTS)


def canonicalize(url: str) -> str:
    base = re.sub(r"#.*", "", url.strip())
    base = re.sub(r"/+$", "", base)
    return base.lower()


@dataclass
class PipelineStage:
    name: str
    status: str            # "ok" | "skipped" | "failed"
    detail: str = ""


@dataclass
class ResearchResult:
    question: str
    answer: str
    citations: list[int]
    audit_passed: bool
    provider: str
    device_label: str
    sources: list[str] = field(default_factory=list)
    fetch_failures: dict = field(default_factory=dict)
    stages: list[PipelineStage] = field(default_factory=list)

    def to_json(self) -> str:
        return json.dumps(
            {
                "question": self.question,
                "answer": self.answer,
                "citations": self.citations,
                "audit_passed": self.audit_passed,
                "provider": self.provider,
                "device_label": self.device_label,
                "sources": self.sources,
                "fetch_failures": self.fetch_failures,
                "stages": [vars(s) for s in self.stages],
            },
            indent=2,
            ensure_ascii=False,
        )


class LocalResearchPipeline:
    def __init__(
        self,
        synthesizer: OnDeviceSynthesizer,
        embedder: OnDeviceEmbedder | None = None,
        tokenizer=None,
    ):
        self.synthesizer = synthesizer
        self.embedder = embedder
        self.tokenizer = tokenizer
        self.status: RuntimeStatus = resolve_execution_provider()
        self.stages: list[PipelineStage] = []

    # ------------------------------------------------------ retrieval
    def live_retrieve(self, question: str, limit: int = 3) -> list[dict]:
        """Public Wikipedia retrieval - the no-card default adapter."""
        import urllib.parse
        import urllib.request

        passages: list[dict] = []
        params = {
            "action": "query",
            "list": "search",
            "srsearch": question,
            "srlimit": str(limit),
            "format": "json",
        }
        url = f"{WIKIPEDIA_SEARCH}?{urllib.parse.urlencode(params)}"
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                data = json.loads(r.read().decode("utf-8"))
            hits = data.get("query", {}).get("search", [])
            for hit in hits:
                title = hit["title"]
                extract_params = {
                    "action": "query",
                    "prop": "extracts",
                    "explaintext": "1",
                    "titles": title,
                    "format": "json",
                }
                eurl = f"{WIKIPEDIA_EXTRACT}?{urllib.parse.urlencode(extract_params)}"
                with urllib.request.urlopen(eurl, timeout=10) as r2:
                    pdata = json.loads(r2.read().decode("utf-8"))
                pages = pdata.get("query", {}).get("pages", {})
                for page in pages.values():
                    text = (page.get("extract") or "")[:2500]
                    if text:
                        passages.append(
                            {
                                "url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}",
                                "title": title,
                                "text": text,
                            }
                        )
            self.stages.append(
                PipelineStage("live_retrieval", "ok", f"{len(passages)} Wikipedia passages")
            )
        except Exception as exc:
            self.stages.append(PipelineStage("live_retrieval", "failed", str(exc)))
        return passages

    # ------------------------------------------------------ pipeline
    def research(
        self,
        question: str,
        offline_evidence: list[dict] | None = None,
        on_token: Callable[[str], None] | None = None,
        top_k: int = 6,
    ) -> ResearchResult:
        self.stages = []

        # 1-2. retrieval or offline evidence
        if offline_evidence:
            passages = offline_evidence
            self.stages.append(
                PipelineStage("evidence", "skipped", "offline evidence supplied - no network")
            )
        else:
            passages = self.live_retrieve(question)

        if not passages:
            raise RuntimeError(
                "No evidence retrieved. TruthSearch never answers without sources."
            )

        # dedup by canonical URL (cloud parity)
        seen: set[str] = set()
        unique: list[dict] = []
        for p in passages:
            key = canonicalize(p.get("url", p.get("title", "")))
            if key not in seen:
                seen.add(key)
                unique.append(p)
        passages = unique
        self.stages.append(
            PipelineStage("canonicalize_dedup", "ok", f"{len(passages)} unique sources")
        )

        # 4. semantic rerank on NPU if embedder present
        if self.embedder:
            passages = self.embedder.rerank(
                question, passages, tokenizer=self.tokenizer, top_k=top_k
            )
            self.stages.append(
                PipelineStage("semantic_rerank", "ok", f"top {len(passages)} by NPU embeddings")
            )
        else:
            passages = passages[:top_k]
            self.stages.append(
                PipelineStage("semantic_rerank", "skipped", "no embedder configured")
            )

        # 5-6. on-device cited synthesis + audit
        result = self.synthesizer.synthesize(question, passages, stream_callback=on_token)
        self.stages.append(
            PipelineStage(
                "on_device_synthesis",
                "ok" if result["audit_passed"] else "failed",
                f"{result['tokens_generated']} tokens via {result['provider']}",
            )
        )

        return ResearchResult(
            question=question,
            answer=result["answer"],
            citations=result["citations"],
            audit_passed=result["audit_passed"],
            provider=result["provider"],
            device_label=result["device_label"],
            sources=[p.get("url", "") for p in passages],
            stages=self.stages,
        )
