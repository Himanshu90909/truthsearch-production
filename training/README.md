# Qwen3.8-27B training path

TruthSearch now uses `Qwen/Qwen3.8-27B` as the primary Hugging Face synthesis model, with automatic fallback models if the provider is unavailable. That change is inference integration; it does not modify the base model weights.

Actual training requires a dataset and a CUDA-capable machine. The application repository is not a suitable place to run a 27B training process: its web runtime is request-oriented and has no GPU allocation. Use the included `finetune_qwen38.py` on an external GPU worker, then serve the resulting PEFT adapter through an OpenAI-compatible endpoint or merge it into a deployment image.

## Dataset format

Create a JSONL file in chat format. Each line should contain a `messages` array, for example:

```json
{"messages":[{"role":"user","content":"Summarize the retrieved evidence and identify uncertainty."},{"role":"assistant","content":"Direct answer: ...\n\nEvidence and sources: ..."}]}
```

For TruthSearch, training examples should contain retrieved evidence and the expected citation discipline. Do not train on private or copyrighted material without permission, and keep unsupported claims out of the assistant responses.

## Run a LoRA/QLoRA job

Install the training dependencies on a CUDA worker:

```bash
pip install torch transformers datasets peft trl bitsandbytes accelerate
python training/finetune_qwen38.py \
  --dataset data/truthsearch_train.jsonl \
  --output-dir artifacts/qwen38-truthsearch-lora
```

The script defaults to 4-bit loading and LoRA adapters to reduce memory requirements. Exact VRAM needs depend on sequence length, batch size, framework versions, and whether the vision tower is trained. Start with text-only examples and a shorter sequence length before attempting multimodal fine-tuning.

## Connect a trained model

After serving the adapter/model behind an OpenAI-compatible endpoint, either configure the Hugging Face hosted model/router or add a provider-specific endpoint implementation. The current production path reads `HF_API_KEY` server-side and routes to `Qwen/Qwen3.8-27B` first. Never put the key in the frontend or commit it to Git.
