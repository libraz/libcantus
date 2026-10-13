"""The ctypes binding to the C ABI of ``libcantus.{so,dylib}`` (``cantus_c.h``).

The library is found through the ``CANTUS_LIB`` environment variable, then the copy bundled in the
wheel, then the ``build-shared`` directory of a source checkout. It is loaded on first use, so
importing the package needs no library.
"""

from __future__ import annotations

import ctypes
import os
import sys
import threading
from pathlib import Path
from typing import Any

from ._errors import CantusError, ErrorCode

ABI_VERSION = 1

_LIB_ENV = "CANTUS_LIB"
_LIB_NAMES = ("libcantus.dylib", "libcantus.so") if sys.platform == "darwin" else ("libcantus.so",)

# Host function behind every `$cb`: (ctx, callback_id, args_json, args_len, out_json, out_len).
CallbackFn = ctypes.CFUNCTYPE(
    ctypes.c_int32,
    ctypes.c_void_p,
    ctypes.c_uint32,
    ctypes.c_void_p,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_void_p),
    ctypes.POINTER(ctypes.c_size_t),
)

_lock = threading.Lock()
_library: ctypes.CDLL | None = None


def _find_in(directory: Path) -> Path | None:
    for name in _LIB_NAMES:
        candidate = directory / name
        if candidate.is_file():
            return candidate
    return None


def find_library() -> Path:
    """The shared library to load.

    Raises:
        CantusError: When none of the search locations holds one.
    """
    explicit = os.environ.get(_LIB_ENV)
    if explicit:
        path = Path(explicit)
        if not path.is_file():
            raise CantusError(f"{_LIB_ENV} names no file: {explicit}", ErrorCode.INTERNAL)
        return path
    here = Path(__file__).resolve().parent
    bundled = _find_in(here / "_lib")
    if bundled is not None:
        return bundled
    for parent in here.parents:
        built = _find_in(parent / "build-shared")
        if built is not None:
            return built
    raise CantusError(
        f"cannot find the libcantus shared library; set {_LIB_ENV} or run `make build-shared`",
        ErrorCode.INTERNAL,
    )


def _declare(lib: ctypes.CDLL) -> None:
    lib.cantus_call.argtypes = [
        ctypes.c_char_p,
        ctypes.c_size_t,
        ctypes.c_char_p,
        ctypes.c_size_t,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_size_t),
    ]
    lib.cantus_call.restype = ctypes.c_int32
    lib.cantus_free.argtypes = [ctypes.c_void_p]
    lib.cantus_free.restype = None
    lib.cantus_release.argtypes = [ctypes.c_uint64]
    lib.cantus_release.restype = None
    lib.cantus_version.argtypes = []
    lib.cantus_version.restype = ctypes.c_char_p
    lib.cantus_algorithm_version.argtypes = []
    lib.cantus_algorithm_version.restype = ctypes.c_uint32
    lib.cantus_abi_version.argtypes = []
    lib.cantus_abi_version.restype = ctypes.c_uint32
    lib.cantus_list_ops.argtypes = [
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_size_t),
    ]
    lib.cantus_list_ops.restype = ctypes.c_int32


def library() -> ctypes.CDLL:
    """The loaded library, loading it on first use and checking its ABI version."""
    global _library
    with _lock:
        if _library is None:
            lib = ctypes.CDLL(str(find_library()))
            _declare(lib)
            found = int(lib.cantus_abi_version())
            if found != ABI_VERSION:
                raise CantusError(
                    f"libcantus reports ABI version {found}, this binding needs {ABI_VERSION}",
                    ErrorCode.INTERNAL,
                )
            _library = lib
        return _library


def _take(lib: ctypes.CDLL, out: ctypes.c_void_p, length: ctypes.c_size_t) -> bytes:
    """Copy a buffer the library returned and free it."""
    if not out.value:
        return b""
    try:
        return ctypes.string_at(out.value, length.value)
    finally:
        lib.cantus_free(out)


def call(op: bytes, args: bytes, callback: Any = None) -> tuple[int, bytes]:
    """Run one op.

    Args:
        op: The op name as UTF-8 (embedded NULs are kept).
        args: The wire JSON array of the arguments.
        callback: A ``CallbackFn`` answering ``$cb`` arguments, or None.

    Returns:
        The C ABI status and the output JSON (the result, or the error reply).
    """
    lib = library()
    out = ctypes.c_void_p()
    length = ctypes.c_size_t()
    status = int(
        lib.cantus_call(
            op, len(op), args, len(args), callback, None, ctypes.byref(out), ctypes.byref(length)
        )
    )
    return status, _take(lib, out, length)


def release(handle: int) -> None:
    """Release a handle; unknown and already released ids are ignored."""
    library().cantus_release(handle)


def version() -> str:
    """The library version."""
    return bytes(library().cantus_version()).decode("ascii")


def algorithm_version() -> int:
    """The generator algorithm version the library produces by default."""
    return int(library().cantus_algorithm_version())


def list_ops() -> bytes:
    """The registered ops as the JSON array ``cantus_list_ops`` returns."""
    lib = library()
    out = ctypes.c_void_p()
    length = ctypes.c_size_t()
    status = int(lib.cantus_list_ops(ctypes.byref(out), ctypes.byref(length)))
    body = _take(lib, out, length)
    if status != 0:
        raise CantusError("cantus_list_ops failed", ErrorCode.INTERNAL)
    return body
