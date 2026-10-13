#!/usr/bin/env python3
"""Check that the eight copies of the error-code table agree.

The C enum in include/cantus/cantus_c.h is canonical. Every other copy must carry exactly its
expected subset of (name, value) pairs with the same values:

  copy                                        how it is read                         subset
  include/cantus/cantus_c.h                   CANTUS_<NAME> = n in enum CantusStatus  all
  include/cantus/core/errors.h                k<Name> = n in enum class ErrorCode     all but OK
  src/ops/error_map.cpp                       case ErrorCode::k<Name>: ErrorInfo{CANTUS_<NAME>, "<NAME>", ...}
                                                                                      all but OK
  bindings/js/src/errors.ts                   <NAME>: n in `ERROR_CODES = { ... }`    all but OK
  bindings/python/src/libcantus/_errors.py    <NAME> = n in `class ErrorCode(...)`    all but OK
  tools/cli/exit_codes.h                      k<Name> = n in enum class ExitCode      all but
                                                                                      CALLBACK_FAILED,
                                                                                      RELEASED_HANDLE
  docs/{en,ja}/errors-and-validation.md       table rows | `<NAME>` | n | ...         all but OK

The default mode requires all eight copies; --present-only checks the copies that exist and
carry a table, and lists the rest.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPECTED_COPIES = 8

Pairs = list[tuple[str, int]]


def camel_to_upper(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper()


def block(text: str, opener: str) -> str:
    """The brace-delimited body after the first match of regex `opener`."""
    m = re.search(opener, text)
    if m is None:
        return ""
    start = text.find("{", m.end() - 1)
    end = text.find("}", start)
    return text[start + 1 : end] if start >= 0 and end > start else ""


def read_c_enum(text: str) -> Pairs:
    body = block(text, r"typedef\s+enum\s+CantusStatus\s*\{")
    return [(n, int(v)) for n, v in re.findall(r"\bCANTUS_([A-Z_]+)\s*=\s*(\d+)", body)]


def read_cpp_enum(enum: str) -> Callable[[str], Pairs]:
    def read(text: str) -> Pairs:
        body = block(text, rf"enum\s+class\s+{enum}\b[^{{]*\{{")
        return [(camel_to_upper(n), int(v)) for n, v in re.findall(r"\bk(\w+)\s*=\s*(\d+)", body)]

    return read


def read_error_map(text: str) -> Pairs:
    if re.search(r"\bdefault\s*:", text):
        raise ValueError("has a default: label")
    rows = re.findall(
        r"case\s+ErrorCode::k(\w+):\s*return\s+ErrorInfo\{CANTUS_(\w+),\s*\"(\w+)\",\s*\"\w+\"\}",
        text,
    )
    pairs = []
    for camel, status, code in rows:
        if not camel_to_upper(camel) == status == code:
            raise ValueError(f"row k{camel} / CANTUS_{status} / {code!r} disagrees with itself")
        pairs.append(code)
    # Values come from the C enum the map returns; only the names are in this file.
    return [(name, -1) for name in pairs]


def read_ts(text: str) -> Pairs:
    body = block(text, r"ERROR_CODES\s*=\s*\{")
    return [(n, int(v)) for n, v in re.findall(r"\b([A-Z][A-Z_]+)\s*:\s*(\d+)", body)]


def read_py(text: str) -> Pairs:
    m = re.search(r"^class\s+ErrorCode\b.*?:\n((?:[ \t]+.*\n|\n)*)", text, re.MULTILINE)
    body = m.group(1) if m else ""
    return [
        (n, int(v)) for n, v in re.findall(r"^[ \t]+([A-Z][A-Z_]+)\s*=\s*(\d+)", body, re.MULTILINE)
    ]


def read_md(text: str) -> Pairs:
    return [
        (n, int(v))
        for n, v in re.findall(r"^\|\s*`([A-Z_]+)`\s*\|\s*(\d+)\s*\|", text, re.MULTILINE)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--present-only",
        action="store_true",
        help="check the copies that exist and list the missing ones",
    )
    args = parser.parse_args()

    canonical_path = ROOT / "include/cantus/cantus_c.h"
    canonical = dict(read_c_enum(canonical_path.read_text(encoding="utf-8")))
    if "OK" not in canonical or len(canonical) < 2:
        print("check_error_tables: CantusStatus not found in cantus_c.h", file=sys.stderr)
        return 1
    all_codes = set(canonical)
    not_ok = all_codes - {"OK"}
    copies: list[tuple[str, Callable[[str], Pairs], set[str]]] = [
        ("include/cantus/cantus_c.h", read_c_enum, all_codes),
        ("include/cantus/core/errors.h", read_cpp_enum("ErrorCode"), not_ok),
        ("src/ops/error_map.cpp", read_error_map, not_ok),
        ("bindings/js/src/errors.ts", read_ts, not_ok),
        ("bindings/python/src/libcantus/_errors.py", read_py, not_ok),
        (
            "tools/cli/exit_codes.h",
            read_cpp_enum("ExitCode"),
            all_codes - {"CALLBACK_FAILED", "RELEASED_HANDLE"},
        ),
        ("docs/en/errors-and-validation.md", read_md, not_ok),
        ("docs/ja/errors-and-validation.md", read_md, not_ok),
    ]
    assert len(copies) == EXPECTED_COPIES

    problems: list[str] = []
    missing: list[str] = []
    checked = 0
    for rel, reader, expected in copies:
        path = ROOT / rel
        if not path.exists():
            missing.append(rel)
            continue
        checked += 1
        try:
            pairs = reader(path.read_text(encoding="utf-8"))
        except ValueError as e:
            problems.append(f"{rel}: {e}")
            continue
        names = [n for n, _ in pairs]
        if not pairs:
            if args.present_only:
                # The file exists but does not carry the table yet.
                missing.append(f"{rel} (no table)")
                checked -= 1
            else:
                problems.append(f"{rel}: no error codes found")
            continue
        if len(names) != len(set(names)):
            problems.append(
                f"{rel}: duplicate names {sorted({n for n in names if names.count(n) > 1})}"
            )
        if set(names) != expected:
            extra = sorted(set(names) - expected)
            absent = sorted(expected - set(names))
            problems.append(f"{rel}: extra {extra}, missing {absent}")
        for name, value in pairs:
            if value >= 0 and name in canonical and canonical[name] != value:
                problems.append(f"{rel}: {name} = {value}, cantus_c.h says {canonical[name]}")

    for p in problems:
        print(p, file=sys.stderr)
    if missing:
        print(
            f"check_error_tables: missing copies: {', '.join(missing)}",
            file=sys.stdout if args.present_only else sys.stderr,
        )
    print(
        f"check_error_tables: {checked}/{EXPECTED_COPIES} copies present and checked, "
        f"{len(problems)} disagreements"
    )
    if problems or checked == 0:
        return 1
    if missing and not args.present_only:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
