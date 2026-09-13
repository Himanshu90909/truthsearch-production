"""
On-device evidence reranking with all-MiniLM-L6-v2 (w8a16, Qualcomm AI Hub).

Embeds the research question and each retrieved passage locally on the
Snapdragon NPU via the QNN execution provider, then reranks evidence by
cosine similarity instead of the lexical ranking used in the cloud path.
No network calls are made. Falls back to CPU on dev machines.
"""

from __future__ import annotations

import numpy as np

try:
    import onnxruntime as ort
except ImportError as exc:  # pragma: no cover
    raise RuntimeError("pip install onnxruntime") from exc

from qnn_runtime import RuntimeStatus, resolve_execution_provider


class OnDeviceEmbedder:
    """Runs a quantized MiniLM sentence embedding model via ONNX Runtime."""

    def __init__(
        self,
        model_path: str,
        provider: str | None = None,
        mean_pool: bool = True,
        normalize: bool = True,
    ):
        if not Path_exists(model_path):
            raise FileNotFoundError(
                f"Embedding model not found at '{model_path}'. "
                "Download the quantized ONNX export of all-MiniLM-L6-v2 from "
                "Qualcomm AI Hub (huggingface.co/qualcomm/all-MiniLM-L6-v2) "
                "or export it with: qai-hub-models --model-name all-MiniLM-L6-v2 "
                "--on-device-model"
            )
        self.status: RuntimeStatus = resolve_execution_provider(provider)
        self.session = ort.InferenceSession(
            model_path,
            providers=[self.status.provider],
        )
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name
        self.mean_pool = mean_pool
        self.normalize = normalize

    # ------------------------------------------------------------- helpers
    def _mean_pool(self, token_embeddings: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
        mask = attention_mask[..., None].astype(token_embeddings.dtype)
        summed = (token_embeddings * mask).sum(axis=1)
        counts = np.clip(mask.sum(axis=1), a_min=1e-9, a_max=None)
        return summed / counts

    def _tokenize(self, text: str, tokenizer):
        enc = tokenizer(
            [text],
            padding=True,
            truncation=True,
            max_length=256,
            return_tensors="np",
        )
        return enc["input_ids"].astype(np.int64), enc["attention_mask"].astype(np.int64)

    # ------------------------------------------------------------- public
    def embed_texts(self, texts: list[str], tokenizer) -> np.ndarray:
        """Embed a batch of passages/questions -> (n, 384) float32 matrix."""
        input_ids, attention_mask = self._tokenize(texts, tokenizer)
        outputs = self.session.run(
            [self.output_name],
            {self.input_name: input_ids, "attention_mask": attention_mask},
        )[0]
        if self.mean_pool:
            emb = self._mean_pool(outputs, attention_mask)
        else:  # CLS-token style models
            emb = outputs[:, 0, :]
        if self.normalize:
            norms = np.linalg.norm(emb, axis=1, keepdims=True)
            emb = emb / np.clip(norms, a_min=1e-9, a_max=None)
        return emb.astype(np.float32)

    def rerank(
        self,
        question: str,
        passages: list[dict],
        text_key: str = "text",
        tokenizer=None,
        top_k: int | None = None,
    ) -> list[dict]:
        """
        Rerank retrieved passages by semantic similarity to the question.
        `passages` items are dicts with at least `text_key`; the similarity
        score is attached as `semantic_score` and the list is returned sorted.
        """
        if tokenizer is None:
            from transformers import AutoTokenizer  # local file load, no network
            tokenizer = AutoTokenizer.from_pretrained(
                "sentence-transformers/all-MiniLM-L6-v2", local_files_only=True
            )
        if not passages:
            return []
        q_emb = self.embed_texts([question], tokenizer)
        p_emb = self.embed_texts([p[text_key] for p in passages], tokenizer)
        sims = (p_emb @ q_emb.T).reshape(-1)
        for passage, score in zip(passages, sims):
            passage["semantic_score"] = float(score)
        ranked = sorted(passages, key=lambda p: p["semantic_score"], reverse=True)
        return ranked[:top_k] if top_k else ranked


def Path_exists(path: str) -> bool:
    from pathlib import Path
    return Path(path).exists()
