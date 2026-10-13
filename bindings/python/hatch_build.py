"""Hatch build hook: bundle the shared library into the wheel and tag the wheel for the platform."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

_NAMES = ("libcantus.dylib",) if sys.platform == "darwin" else ("libcantus.so",)


def _find_library(root: Path) -> Path:
    explicit = os.environ.get("CANTUS_LIB")
    if explicit:
        return Path(explicit)
    for name in _NAMES:
        candidate = root.parents[1] / "build-shared" / name
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "no shared library to bundle: set CANTUS_LIB or run `make build-shared`"
    )


class CustomBuildHook(BuildHookInterface):  # type: ignore[type-arg]
    """Adds ``libcantus/_lib/<library>`` to the wheel and marks it platform-specific."""

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        if version == "editable":
            return
        library = _find_library(Path(self.root)).resolve()
        build_data["pure_python"] = False
        build_data["infer_tag"] = True
        build_data["force_include"][str(library)] = f"libcantus/_lib/{_NAMES[0]}"
