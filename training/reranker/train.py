"""Train a cross-encoder reranker on a licensed labelled dataset."""
import argparse, json, pathlib, time

def main():
    p = argparse.ArgumentParser(); p.add_argument("--dataset", required=True); p.add_argument("--output", default="artifacts/reranker"); p.add_argument("--max-examples", type=int, default=1000000); p.add_argument("--epochs", type=int, default=1); p.add_argument("--batch-size", type=int, default=16); p.add_argument("--dry-run", action="store_true"); args = p.parse_args()
    out = pathlib.Path(args.output); out.mkdir(parents=True, exist_ok=True); manifest = vars(args).copy(); manifest.update(task="cross-encoder-reranker", created_at=time.time())
    if args.dry_run: manifest.update(status="dry-run", metrics=None); (out / "manifest.json").write_text(json.dumps(manifest, indent=2)); print(json.dumps(manifest, indent=2)); return
    try:
        import torch
        from datasets import load_dataset
        from sentence_transformers import CrossEncoder, InputExample
    except ImportError as exc: raise SystemExit(f"Training requires torch, datasets, and sentence-transformers. Nothing was trained. Missing: {exc}")
    device = "cuda" if torch.cuda.is_available() else "cpu"; manifest.update(device=device, hardware=torch.cuda.get_device_name(0) if device == "cuda" else "cpu")
    ds = load_dataset(args.dataset, split="train", streaming=True); examples = []
    for row in ds:
        q = row.get("query") or row.get("question"); text = row.get("passage") or row.get("text") or row.get("document"); label = row.get("label", row.get("relevance", 0))
        if q and text: examples.append(InputExample(texts=[q, text], label=float(label)))
        if len(examples) >= args.max_examples: break
    if not examples: raise SystemExit("No compatible labelled pairs found; no checkpoint was written.")
    model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", num_labels=1, device=device)
    loader = torch.utils.data.DataLoader(examples, shuffle=True, batch_size=args.batch_size)
    model.fit(train_dataloader=loader, epochs=args.epochs, warmup_steps=max(1, len(loader)//10), output_path=str(out / "checkpoint"), show_progress_bar=True)
    manifest.update(status="trained", training_examples=len(examples), metrics=None); (out / "manifest.json").write_text(json.dumps(manifest, indent=2)); print(json.dumps(manifest, indent=2))
if __name__ == "__main__": main()
