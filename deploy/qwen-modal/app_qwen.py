"""Serve Qwen3.8-27B (multimodal, 27.8B params, BF16 ~55GB) on Modal with vLLM.

Deploy:   modal deploy qwen-modal/app_qwen.py
Costs:    GPU time only, and the container scales to zero after IDLE_MIN minutes
          (~$2.5/hr on A100-80GB, ~$3.9/hr on H100). The 55GB weight download
          happens once into the `qwen-weights` volume; later cold starts skip it.

After deploy, Modal prints an URL like
  https://<workspace>--qwen-serve.modal.run
Point the playground at it:
  QWEN_LOCAL_BASE_URL=https://<workspace>--qwen-serve.modal.run/v1
  QWEN_LOCAL_API_KEY=<QWEN_SERVE_KEY secret>
"""

import os

import modal

APP_NAME = "qwen-serve"
MODEL_ID = "Qwen/Qwen3.8-27B"
IDLE_MIN = 5
MAX_LEN = 16384

app = modal.App(APP_NAME)

weights = modal.Volume.from_name("qwen-weights", create_if_missing=True)
hf_cache = "/root/.cache/huggingface"

image = (
    modal.Image.from_registry("nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.11")
    .entrypoint([])
    .pip_install(
        "vllm==0.11.2",
        "huggingface_hub[hf_transfer]>=0.26",
        "transformers>=4.53",
        "accelerate",
        "fastapi",
        "uvicorn",
    )
    .env({
        "HF_HUB_ENABLE_HF_TRANSFER": "1",
        "HF_HOME": hf_cache,
        # vLLM keeps the text stack only; the vision tower still loads but the
        # OpenAI-compatible server needs no extra flags for image inputs.
        "VLLM_USE_V1": "1",
    })
)


@app.function(
    image=image,
    gpu="A100-80GB",          # 55GB of BF16 weights + KV cache; H100 also works
    timeout=60 * 30,          # allow the first download to finish
    scaledown_window=IDLE_MIN * 60,
    volumes={hf_cache: weights},
    secrets=[modal.Secret.from_name("qwen-serve-key")],
)
@modal.web_server(port=8000, startup_timeout=60 * 25)
def serve():
    import subprocess

    api_key = os.environ.get("QWEN_SERVE_KEY", "")
    cmd = [
        "vllm", "serve", MODEL_ID,
        "--host", "0.0.0.0",
        "--port", "8000",
        "--max-model-len", str(MAX_LEN),
        "--gpu-memory-utilization", "0.92",
        "--served-model-name", MODEL_ID,
    ]
    if api_key:
        cmd += ["--api-key", api_key]
    subprocess.Popen(cmd)


@app.function(image=image, volumes={hf_cache: weights}, timeout=60 * 40)
def prefetch():
    """Warm the volume so the first request does not pay for the 55GB download."""
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL_ID, cache_dir=hf_cache)
    weights.commit()
