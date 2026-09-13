"""
TruthSearch Snapdragon layer - QNN runtime bootstrap.

Detects the Qualcomm QNN execution provider (QNN_HTP / Hexagon NPU) available
on Snapdragon-powered HP PCs (Windows on Snapdragon, ARM64). Falls back to
the CPU execution provider on development machines so the same code runs
everywhere, and reports which provider is active so the UI can display it.

Nothing in this module performs a network call.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

QNN_PROVIDER_CANDIDATES = ("QNNHtp", "QNNExecutionProvider", "QNN")

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE.parent / "model_config.json"


@dataclass
class RuntimeStatus:
    provider: str          # e.g. "QNNExecutionProvider" or "CPUExecutionProvider"
    on_npu: bool
    device_label: str      # human-readable string shown in the UI
    notes: list[str]


def load_model_config() -> dict[str, Any]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def available_execution_providers() -> list[str]:
    """Return the ONNX Runtime execution providers compiled into this install."""
    try:
        import onnxruntime as ort
        return list(ort.get_available_providers())
    except Exception as exc:  # pragma: no cover - import-time environment issue
        raise RuntimeError(
            "onnxruntime is not installed. Run: pip install -r requirements.txt"
        ) from exc


def resolve_execution_provider(prefer: str | None = None) -> RuntimeStatus:
    """
    Choose the best execution provider available.

    Order of preference:
      1. explicit `prefer` (e.g. forced CPU for battery saving)
      2. any QNN provider -> NPU on Snapdragon X Elite / X2 Elite
      3. CPU fallback (development machines)
    """
    notes: list[str] = []
    providers = available_execution_providers()

    if prefer:
        if prefer not in providers:
            notes.append(
                f"Requested provider '{prefer}' is not available in this build; "
                f"available providers: {providers}"
            )
        else:
            on_npu = any(q in prefer for q in QNN_PROVIDER_CANDIDATES)
            return RuntimeStatus(
                provider=prefer,
                on_npu=on_npu,
                device_label="Snapdragon NPU (QNN_HTP)" if on_npu else f"{prefer} (forced)",
                notes=notes,
            )

    for candidate in QNN_PROVIDER_CANDIDATES:
        if candidate in providers:
            return RuntimeStatus(
                provider=candidate,
                on_npu=True,
                device_label="Snapdragon NPU (QNN_HTP) - Hexagon Tensor Processor",
                notes=notes,
            )

    notes.append(
        "QNN execution provider not present (expected on non-Snapdragon dev machines). "
        "Using CPU; install the QNN-enabled onnxruntime/onnxruntime-genai builds on a "
        "Snapdragon-powered HP PC for NPU execution. "
        "Same code path, identical outputs, lower speed."
    )
    return RuntimeStatus(
        provider="CPUExecutionProvider",
        on_npu=False,
        device_label="CPU (development fallback)",
        notes=notes,
    )


def qnn_library_paths() -> dict[str, str]:
    """
    Optional environment overrides for the QNN SDK libraries shipped with the
    Qualcomm AI Runtime / ONNX Runtime QNN builds on Windows on Snapdragon.
    """
    return {
        "QNN_SDK_ROOT": os.environ.get("QNN_SDK_ROOT", ""),
        "LD_LIBRARY_PATH": os.environ.get("LD_LIBRARY_PATH", ""),
    }
