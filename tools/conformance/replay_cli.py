#!/usr/bin/env python3
"""Replay a call corpus through the cantus CLI and compare normalized JSON.

A corpus is a JSONL file, or a directory of them, of {"op", "args", "result" | "error"} lines.
Without a path, tests/corpus/fixtures is used when it exists, else the CLI's own small fixture.
Exits non-zero on any mismatch and when no call was replayed.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXED_CORPUS = ROOT / "tests/corpus/fixtures"
OWN_FIXTURE = ROOT / "tools/cli/tests/fixture.jsonl"

# Mirrors tools/cli/exit_codes.h.
EXIT_CODES = {
    "INVALID_INPUT": 1,
    "NO_SOLUTION": 2,
    "BUDGET_EXCEEDED": 3,
    "HOST_TYPE_ERROR": 4,
    "UNKNOWN_OP": 10,
    "BAD_REQUEST": 11,
    "INTERNAL": 99,
}


def normalize(text: str) -> str:
    return json.dumps(json.loads(text), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def corpus_files(path: Path) -> list[Path]:
    if path.is_dir():
        return sorted(path.rglob("*.jsonl"))
    return [path]


def replay(cli: Path, files: list[Path]) -> tuple[int, list[str]]:
    count = 0
    failures: list[str] = []
    for file in files:
        for lineno, line in enumerate(file.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            case = json.loads(line)
            where = f"{file}:{lineno} {case['op']}"
            count += 1
            proc = subprocess.run(
                [str(cli), case["op"], json.dumps(case["args"], ensure_ascii=False)],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            if "error" in case:
                expected = normalize(json.dumps(case["error"]))
                want_exit = EXIT_CODES[case["error"]["code"]]
                actual = proc.stderr
            else:
                expected = normalize(json.dumps(case["result"]))
                want_exit = 0
                actual = proc.stdout
            try:
                got = normalize(actual)
            except ValueError:
                failures.append(f"{where}: output is not JSON: {actual!r}")
                continue
            if proc.returncode != want_exit:
                failures.append(f"{where}: exit {proc.returncode}, want {want_exit}")
            elif got != expected:
                failures.append(f"{where}: got {got}, want {expected}")
    return count, failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, default=ROOT / "build/tools/cli/cantus")
    parser.add_argument("corpus", nargs="?", type=Path)
    args = parser.parse_args()

    path = args.corpus or (FIXED_CORPUS if FIXED_CORPUS.exists() else OWN_FIXTURE)
    files = corpus_files(path)
    count, failures = replay(args.cli, files)
    for f in failures:
        print(f, file=sys.stderr)
    print(f"replay_cli: {count} calls replayed from {path}, {len(failures)} failures")
    return 1 if failures or count == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
