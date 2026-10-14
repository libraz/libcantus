#!/usr/bin/env python3
"""Replay a call corpus through the cantus CLI and compare normalized JSON.

A corpus is a JSONL file, or a directory of them, of {"op", "args", "result" | "error"} lines,
in the format the other replayers read: `args_raw` (a string) is sent verbatim instead of `args`,
and a line with `skip` is counted and not replayed. Each call is its own process, so `$h` / `$id`
values are paired within one call only, and a line whose arguments carry a handle or a `$cb`
(which need a host process), whose op the CLI refuses for calling back or holding handles, or
whose op name no command line can carry, is counted as skipped.
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

# Mirrors tools/cli/exit_codes.h and the status mapping of tools/cli/main.cpp.
EXIT_CODES = {
    "INVALID_INPUT": 1,
    "NO_SOLUTION": 2,
    "BUDGET_EXCEEDED": 3,
    "HOST_TYPE_ERROR": 4,
    "UNKNOWN_OP": 10,
    "BAD_REQUEST": 11,
    "CALLBACK_FAILED": 99,
    "RELEASED_HANDLE": 99,
    "INTERNAL": 99,
}


def normalize(text: str) -> str:
    return json.dumps(json.loads(text), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def corpus_files(path: Path) -> list[Path]:
    if path.is_dir():
        return sorted(path.rglob("*.jsonl"))
    return [path]


def needs_host(node: object) -> bool:
    """Whether arguments refer to a handle or a callback, which only a host process holds."""
    if isinstance(node, list):
        return any(needs_host(item) for item in node)
    if isinstance(node, dict):
        return "$h" in node or "$cb" in node or any(needs_host(item) for item in node.values())
    return False


def argv_safe(op: str) -> bool:
    """Whether an op name can be a command-line argument (no NUL, valid UTF-8)."""
    if "\0" in op:
        return False
    try:
        op.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def bind_ids(expected: object, actual: object, pairs: dict[tuple[str, object], object]) -> bool:
    """Rewrite `$h` / `$id` values in `expected` to the ones `actual` has; False on a conflict."""
    if isinstance(expected, list) and isinstance(actual, list):
        return all(bind_ids(e, a, pairs) for e, a in zip(expected, actual, strict=False))
    if not isinstance(expected, dict) or not isinstance(actual, dict):
        return True
    for key in list(expected):
        if key not in actual:
            continue
        ev, av = expected[key], actual[key]
        if key in ("$h", "$id") and isinstance(ev, (int, float)) and not isinstance(ev, bool):
            if pairs.setdefault((key, ev), av) != av or pairs.setdefault((key + "<", av), ev) != ev:
                return False
            expected[key] = av
        elif not bind_ids(ev, av, pairs):
            return False
    return True


def refused_ops(cli: Path) -> set[str]:
    """The ops the CLI refuses up front: those that call back or hold handles (`list`)."""
    listed = subprocess.run([str(cli), "list"], capture_output=True, text=True, check=True)
    return {
        entry["name"]
        for entry in json.loads(listed.stdout)
        if entry.get("callbacks") or entry.get("handles")
    }


def replay(cli: Path, files: list[Path]) -> tuple[int, int, list[str]]:
    refused = refused_ops(cli)
    count = 0
    skipped = 0
    failures: list[str] = []
    for file in files:
        for lineno, line in enumerate(file.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            case = json.loads(line)
            if (
                "skip" in case
                or not argv_safe(case["op"])
                or case["op"] in refused
                or ("args_raw" not in case and needs_host(case.get("args", [])))
            ):
                skipped += 1
                continue
            where = f"{file}:{lineno} {case['op']}"
            count += 1
            if "args_raw" in case:
                sent = str(case["args_raw"]).encode("utf-8", "surrogatepass")
            else:
                # Escaped: lone surrogates have no UTF-8 form. Through stdin: a recorded call can
                # exceed the OS argv limit.
                sent = json.dumps(case.get("args", [])).encode("ascii")
            proc = subprocess.run(
                [str(cli), case["op"], "-"], input=sent, capture_output=True, check=False
            )
            if "error" in case:
                expected_value = case["error"]
                want_exit = EXIT_CODES[expected_value["code"]]
                actual = proc.stderr.decode("utf-8", "surrogatepass")
            else:
                expected_value = case["result"]
                want_exit = 0
                actual = proc.stdout.decode("utf-8", "surrogatepass")
            try:
                got_value = json.loads(actual)
            except ValueError:
                failures.append(f"{where}: output is not JSON: {actual!r}")
                continue
            if proc.returncode != want_exit:
                failures.append(f"{where}: exit {proc.returncode}, want {want_exit}")
            elif not bind_ids(expected_value, got_value, {}):
                failures.append(f"{where}: handle or identity ids disagree within the call")
            else:
                expected = normalize(json.dumps(expected_value))
                got = normalize(json.dumps(got_value))
                if got != expected:
                    failures.append(f"{where}: got {got}, want {expected}")
    return count, skipped, failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, default=ROOT / "build/tools/cli/cantus")
    parser.add_argument("corpus", nargs="?", type=Path)
    args = parser.parse_args()

    path = args.corpus or (FIXED_CORPUS if FIXED_CORPUS.exists() else OWN_FIXTURE)
    files = corpus_files(path)
    count, skipped, failures = replay(args.cli, files)
    for f in failures:
        print(f, file=sys.stderr)
    print(
        f"replay_cli: {count} calls replayed from {path} ({skipped} skipped), "
        f"{len(failures)} failures"
    )
    return 1 if failures or count == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
