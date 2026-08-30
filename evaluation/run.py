"""Evaluate a trained sentence-transformers checkpoint on streamed labelled pairs."""
import argparse, json, pathlib, time

def main():
    p = argparse.ArgumentParser(); p.add_argument("--dataset", required=True); p.add_argument("--model-version", required=True); p.add_argument("--output", default="artifacts/evaluation/report.json"); p.add_argument("--max-examples", type=int, default=5000); args = p.parse_args()
    try:
        import numpy as np
        from datasets import load_dataset
        from sentence_transformers import SentenceTransformer
    except ImportError as exc: raise SystemExit(f"Evaluation requires numpy, datasets, and sentence-transformers. No metrics were fabricated. Missing: {exc}")
    model = SentenceTransformer(args.model_version); rows = []
    for row in load_dataset(args.dataset, split="validation", streaming=True):
        q = row.get("query") or row.get("question"); text = row.get("passage") or row.get("text") or row.get("positive")
        if q and text: rows.append((q, text))
        if len(rows) >= args.max_examples: break
    if not rows: raise SystemExit("No compatible validation pairs found; no metrics were written.")
    qv = model.encode([x[0] for x in rows], normalize_embeddings=True, batch_size=64, show_progress_bar=True); dv = model.encode([x[1] for x in rows], normalize_embeddings=True, batch_size=64, show_progress_bar=True); sim = np.matmul(qv, dv.T)
    recalls = {}; reciprocal = []
    for k in (5, 10): recalls[f"Recall@{k}"] = float(np.mean([i in np.argsort(-sim[i])[:k] for i in range(len(rows))]))
    for i in range(len(rows)): reciprocal.append(1 / (int(np.where(np.argsort(-sim[i]) == i)[0][0]) + 1))
    report = {"dataset": args.dataset, "model_version": args.model_version, "status": "evaluated", "examples": len(rows), "metrics": {**recalls, "MRR": float(np.mean(reciprocal))}, "created_at": time.time()}; out = pathlib.Path(args.output); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(report, indent=2)); print(json.dumps(report, indent=2))
if __name__ == "__main__": main()
