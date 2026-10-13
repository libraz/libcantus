"""libcantus: music-theory analysis and generation over the libcantus C ABI.

Functions are snake_case versions of the TypeScript exports, model classes keep their names, and
results are plain dicts and lists (model classes, hybrids and handles excepted). Constants are read
on first access.
"""

from __future__ import annotations

import json
from typing import Any

from . import _ffi, _generated
from ._codec import UNSET, Handle, Hybrid, Model
from ._errors import (
    BudgetExceededError,
    CantusError,
    ErrorCode,
    InvalidInputError,
    NoSolutionError,
    is_libcantus_error,
)
from ._generated import *  # noqa: F403

__all__ = [
    *_generated.__all__,
    "UNSET",
    "BudgetExceededError",
    "CantusError",
    "ErrorCode",
    "Handle",
    "Hybrid",
    "InvalidInputError",
    "Model",
    "NoSolutionError",
    "algorithm_version",
    "is_libcantus_error",
    "list_ops",
    "version",
]


def version() -> str:
    """The version of the loaded library."""
    return _ffi.version()


def algorithm_version() -> int:
    """The generator algorithm version the loaded library produces by default."""
    return _ffi.algorithm_version()


def list_ops() -> list[dict[str, Any]]:
    """The ops the loaded library registers, as ``{"name", "callbacks", "handles"}`` dicts."""
    ops: list[dict[str, Any]] = json.loads(_ffi.list_ops())
    return ops


def __getattr__(name: str) -> Any:
    return _generated.constant(name)
