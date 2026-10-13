#!/usr/bin/env python3
"""Check that every translation unit of the WebAssembly build compiles with -fexceptions.

The core throws internally and cantus_call catches at the boundary; a TU built without exception
support would abort instead of reaching that catch. Reads the compile_commands.json of the
emscripten build (build-wasm/ by default) and fails when any TU's effective setting is not
-fexceptions, or when the database lists no TU at all.
"""

from __future__ import annotations

import argparse
import json
import shlex
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCEPTION_FLAGS = {"-fexceptions", "-fno-exceptions"}


def check(path: Path) -> tuple[int, list[str]]:
    if not path.exists():
        return 0, [f"{path}: not found (run make wasm first)"]
    entries = json.loads(path.read_text(encoding="utf-8"))
    problems = []
    for entry in entries:
        file = Path(entry["file"])
        try:
            rel = file.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            rel = file.as_posix()
        args = entry.get("arguments") or shlex.split(entry["command"])
        flags = [a for a in args if a in EXCEPTION_FLAGS]
        if not flags or flags[-1] != "-fexceptions":
            problems.append(f"{rel}: effective {flags[-1] if flags else 'no -fexceptions'}")
    return len(entries), problems


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--compile-commands", default=str(ROOT / "build-wasm/compile_commands.json")
    )
    args = parser.parse_args()

    units, problems = check(Path(args.compile_commands))
    for p in problems:
        print(p, file=sys.stderr)
    print(f"check_wasm_flags: {units} translation units checked, {len(problems)} violations")
    if units == 0:
        print("check_wasm_flags: nothing to check", file=sys.stderr)
        return 1
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
