"""Train a dense retriever on a licensed Hugging Face dataset.

Example on a GPU machine:
  python training/retriever/train.py --dataset sentence-transformers/msmarco-biencoder

The script never writes fabricated metrics. It records the exact run configuration and
fails clearly if the optional ML stack is not installed.
"""
import argparse, json, pathlib, time

def main():
    p = argparse.ArgumentParser(); p.add_argument("--dataset", required=True); p.add_argument("--output", default="artifacts/retriever"); p.add_argument("--max-examples", type=int, default=1000000); p.add_argument("--epochs", type=int, default=1); p.add_argument("--batch-size", type=int, default=32); p.add_argument("--dry-run", action="store_true"); args = p.parse_args()
    out = pathlib.Path(args.output); out.mkdir(parents=True, exist_ok=True)
    manifest = {"task": "dense-retriever", "dataset": args.dataset, "max_examples": args.max_examples, "epochs": args.epochs, "batch_size": args.batch_size, "created_at": time.time()}
    if args.dry_run:
        manifest.update(status="dry-run", metrics=None); (out / "manifest.json").write_text(json.dumps(manifest, indent=2)); print(json.dumps(manifest, indent=2)); return
    try:
        import torch
        from datasets import load_dataset
        from sentence_transformers import SentenceTransformer, InputExample, losses
    except ImportError as exc:
        raise SystemExit(f"Training requires torch, datasets, and sentence-transformers. Install them on a GPU machine; nothing was trained. Missing: {exc}")
    device = "cuda" if torch.cuda.is_available() else "cpu"; manifest["device"] = device; manifest["hardware"] = torch.cuda.get_device_name(0) if device == "cuda" else "cpu"
    if device == "cpu": print("Warning: CPU mode selected; use a GPU for genuinely large training runs.")
    dataset = load_dataset(args.dataset, split="train", streaming=True)
    examples = []
    for row in dataset:
        query = row.get("query") or row.get("question"); passage = row.get("passage") or row.get("text") or row.get("positive")
        if query and passage: examples.append(InputExample(texts=[query, passage], label=1.0))
        if len(examples) >= args.max_examples: break
    if not examples: raise SystemExit("No compatible query/passage pairs found; no checkpoint was written.")
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device=device)
    loader = torch.utils.data.DataLoader(examples, shuffle=True, batch_size=args.batch_size)
    model.fit(train_objectives=[(loader, losses.MultipleNegativesRankingLoss(model))], epochs=args.epochs, warmup_steps=max(1, len(loader)//10), output_path=str(out / "checkpoint"), show_progress_bar=True)
    manifest.update(status="trained", training_examples=len(examples), metrics="Run evaluation/run.py to measure retrieval metrics on labelled data."); (out / "manifest.json").write_text(json.dumps(manifest, indent=2)); print(json.dumps(manifest, indent=2))
if __name__ == "__main__": main()
