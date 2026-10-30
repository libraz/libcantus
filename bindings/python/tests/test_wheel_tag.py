"""The wheel tag read from the bundled library."""

from __future__ import annotations

import importlib.util
import struct
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "hatch_build", Path(__file__).resolve().parents[1] / "hatch_build.py"
)
assert spec is not None and spec.loader is not None
hatch_build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hatch_build)


def macho(cputype: int, command: int, minos: int) -> bytes:
    header = struct.pack("<8I", 0xFEEDFACF, cputype, 0, 6, 1, 24, 0, 0)
    # LC_BUILD_VERSION: platform then minos; LC_VERSION_MIN_MACOSX: version directly.
    fields = (1, minos) if command == 0x32 else (minos, 0)
    return header + struct.pack("<4I", command, 24, *fields) + bytes(8)


def test_macho_build_version(tmp_path: Path) -> None:
    lib = tmp_path / "libcantus.dylib"
    lib.write_bytes(macho(0x0100000C, 0x32, 11 << 16))
    assert hatch_build.platform_tag(lib) == "py3-none-macosx_11_0_arm64"


def test_macho_version_min(tmp_path: Path) -> None:
    lib = tmp_path / "libcantus.dylib"
    lib.write_bytes(macho(0x01000007, 0x24, (10 << 16) | (15 << 8)))
    assert hatch_build.platform_tag(lib) == "py3-none-macosx_10_15_x86_64"


@pytest.mark.parametrize(("machine", "arch"), [(62, "x86_64"), (183, "aarch64")])
def test_elf(tmp_path: Path, machine: int, arch: str) -> None:
    lib = tmp_path / "libcantus.so"
    ident = b"\x7fELF" + bytes([2, 1, 1]) + bytes(9)
    lib.write_bytes(ident + struct.pack("<HH", 3, machine) + bytes(40))
    assert hatch_build.platform_tag(lib) == f"py3-none-linux_{arch}"


def test_unknown_file_is_refused(tmp_path: Path) -> None:
    lib = tmp_path / "libcantus.so"
    lib.write_bytes(b"MZ" + bytes(64))
    with pytest.raises(ValueError):
        hatch_build.platform_tag(lib)
