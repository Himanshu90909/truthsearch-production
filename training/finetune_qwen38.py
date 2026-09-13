#!/usr/bin/env python3
"""QLoRA fine-tuning entry point for Qwen/Qwen3.8-27B.

Expected JSONL rows:
{"messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}

Run this on a CUDA machine with enough VRAM; it is intentionally not invoked by
 the Node web server. The output directory is a PEFT adapter that can be served
by an OpenAI-compatible endpoint and selected through HF_MODEL_ID.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig, TrainingArguments
from trl import SFTTrainer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, help="JSONL file with a messages column")
    parser.add_argument("--output-dir", default="artifacts/qwen38-truthsearch-lora")
    parser.add_argument("--model", default="Qwen/Qwen3.8-27B")
    parser.add_argument("--epochs", type=float, default=2.0)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accumulation", type=int, default=16)
    parser.add_argument("--max-seq-length", type=int, default=8192)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    dataset = load_dataset("json", data_files=str(dataset_path), split="train")
    if "messages" not in dataset.column_names:
        raise ValueError("Each JSONL row must contain a messages array")

    processor = AutoProcessor.from_pretrained(args.model, trust_remote_code=True)
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype="bfloat16",
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForImageTextToText.from_pretrained(
        args.model,
        quantization_config=quantization,
        device_map="auto",
        torch_dtype="bfloat16",
        trust_remote_code=True,
    )

    peft_config = LoraConfig(
        r=32,
        lora_alpha=64,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accumulation,
        learning_rate=2e-4,
        logging_steps=5,
        save_strategy="steps",
        save_steps=100,
        bf16=True,
        gradient_checkpointing=True,
        optim="paged_adamw_8bit",
        report_to="none",
    )
    trainer = SFTTrainer(
        model=model,
        processing_class=processor,
        train_dataset=dataset,
        peft_config=peft_config,
        args=training_args,
        dataset_text_field="messages",
        max_seq_length=args.max_seq_length,
    )
    trainer.train()
    trainer.save_model(args.output_dir)
    processor.save_pretrained(args.output_dir)
    print(f"Saved adapter to {args.output_dir}")


if __name__ == "__main__":
    main()
