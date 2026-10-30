"""Hatch build hook: bundle the shared library into the wheel and tag the wheel for the platform."""

from __future__ import annotations

import os
import struct
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


_MACHO_MAGIC_64 = 0xFEEDFACF
_MACHO_ARCHS = {0x0100000C: "arm64", 0x01000007: "x86_64"}
_LC_VERSION_MIN_MACOSX = 0x24
_LC_BUILD_VERSION = 0x32
_ELF_ARCHS = {62: "x86_64", 183: "aarch64"}


def _macho_tag(data: bytes) -> str:
    magic, cputype, _, _, ncmds = struct.unpack_from("<5I", data)
    arch = _MACHO_ARCHS.get(cputype)
    if magic != _MACHO_MAGIC_64 or arch is None:
        raise ValueError("the bundled library is not a thin 64-bit arm64 or x86_64 Mach-O file")
    offset = 32
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<2I", data, offset)
        # Both commands carry the minimum OS as major<<16 | minor<<8 | patch.
        if cmd == _LC_BUILD_VERSION:
            (minos,) = struct.unpack_from("<I", data, offset + 12)
            return f"macosx_{minos >> 16}_{(minos >> 8) & 0xFF}_{arch}"
        if cmd == _LC_VERSION_MIN_MACOSX:
            (minos,) = struct.unpack_from("<I", data, offset + 8)
            return f"macosx_{minos >> 16}_{(minos >> 8) & 0xFF}_{arch}"
        offset += size
    raise ValueError("the bundled library records no minimum macOS version")


def _elf_tag(data: bytes) -> str:
    if data[:4] != b"\x7fELF" or data[4] != 2 or data[5] != 1:
        raise ValueError("the bundled library is not a little-endian 64-bit ELF file")
    (machine,) = struct.unpack_from("<H", data, 18)
    arch = _ELF_ARCHS.get(machine)
    if arch is None:
        raise ValueError(f"the bundled library targets an unsupported ELF machine {machine}")
    # auditwheel raises this to the manylinux tag the library's symbols allow.
    return f"linux_{arch}"


def platform_tag(library: Path) -> str:
    """The wheel tag ``py3-none-<platform>`` of ``library``, read from its own headers.

    The library is plain C linked through ctypes, so no interpreter ABI is involved; the platform
    and minimum macOS come from the file, not from the machine or Python that runs the build.
    """
    data = library.read_bytes()
    plat = _macho_tag(data) if data[:4] == struct.pack("<I", _MACHO_MAGIC_64) else _elf_tag(data)
    return f"py3-none-{plat}"


class CustomBuildHook(BuildHookInterface):  # type: ignore[type-arg]
    """Adds ``libcantus/_lib/<library>`` to the wheel and marks it platform-specific."""

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        if version == "editable":
            return
        library = _find_library(Path(self.root)).resolve()
        build_data["pure_python"] = False
        build_data["tag"] = platform_tag(library)
        build_data["force_include"][str(library)] = f"libcantus/_lib/{_NAMES[0]}"
