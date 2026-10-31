"""A macOS wheel tag is one pip accepts: a minimum OS from 11 never carries a minor version."""

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


def macho(command: int, minos: int) -> bytes:
    header = struct.pack("<8I", 0xFEEDFACF, 0x0100000C, 0, 6, 1, 24, 0, 0)
    fields = (1, minos) if command == 0x32 else (minos, 0)
    return header + struct.pack("<4I", command, 24, *fields) + bytes(8)


@pytest.mark.parametrize("command", [0x32, 0x24])
@pytest.mark.parametrize("minos", [(15 << 16) | (5 << 8), (11 << 16) | (3 << 8)])
def test_a_minor_version_from_macos_11_is_refused(tmp_path: Path, command: int, minos: int) -> None:
    lib = tmp_path / "libcantus.dylib"
    lib.write_bytes(macho(command, minos))
    with pytest.raises(ValueError, match="deployment target"):
        hatch_build.platform_tag(lib)


def test_a_patch_level_does_not_change_the_tag(tmp_path: Path) -> None:
    lib = tmp_path / "libcantus.dylib"
    lib.write_bytes(macho(0x32, (14 << 16) | 2))
    assert hatch_build.platform_tag(lib) == "py3-none-macosx_14_0_arm64"
