#!/usr/bin/env python3
"""Check that every public header stands alone and keeps JSON out of the typed API.

Each include/cantus/**/*.h is compiled on its own with only `-I include` (never `-I src`).
Headers other than cantus_c.h and ops.h (the op-layer entry points) must not name a JSON type;
cantus_c.h is also compiled as C.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INCLUDE = ROOT / "include"
OP_LAYER_HEADERS = {"cantus/cantus_c.h", "cantus/ops.h"}
JSON_PATTERN = re.compile(r"\bjson::|json/json\.h|\bnlohmann\b|\bJsonValue\b|\bjson_value\b")
CXX_FLAGS = ["-std=c++17", "-fsyntax-only", "-Wall", "-Wextra", "-Wpedantic", "-Werror"]
C_FLAGS = ["-std=c99", "-fsyntax-only", "-Wall", "-Wextra", "-Wpedantic", "-Werror"]


def compile_alone(compiler: str, flags: list[str], language: str, header: str) -> str | None:
    """Compile a TU that includes only `header`; return the diagnostics on failure."""
    source = f'#include "{header}"\n'
    result = subprocess.run(
        [compiler, *flags, "-I", str(INCLUDE), "-x", language, "-"],
        check=False,
        input=source,
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    return None if result.returncode == 0 else result.stderr.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cxx", default=os.environ.get("CXX", "c++"))
    parser.add_argument("--cc", default=os.environ.get("CC", "cc"))
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()

    headers = sorted(str(p.relative_to(INCLUDE)) for p in INCLUDE.glob("cantus/**/*.h"))
    if not headers:
        print("check_public_headers: no headers under include/cantus", file=sys.stderr)
        return 1

    failures: list[str] = []
    for header in headers:
        if header in OP_LAYER_HEADERS:
            continue
        text = (INCLUDE / header).read_text(encoding="utf-8")
        for number, line in enumerate(text.splitlines(), 1):
            if JSON_PATTERN.search(line):
                failures.append(f"{header}:{number}: names a JSON type: {line.strip()}")

    jobs = [(args.cxx, CXX_FLAGS, "c++", h) for h in headers]
    jobs.append((args.cc, C_FLAGS, "c", "cantus/cantus_c.h"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        results = list(pool.map(lambda job: (job, compile_alone(*job)), jobs))
    for (_, _, language, header), error in results:
        if error is not None:
            failures.append(f"{header} ({language}) does not compile alone:\n{error}")

    for failure in failures:
        print(failure, file=sys.stderr)
    print(
        f"check_public_headers: {len(headers)} headers, {len(jobs)} compilations, "
        f"{len(failures)} failures"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
