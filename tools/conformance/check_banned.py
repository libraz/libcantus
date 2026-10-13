#!/usr/bin/env python3
"""Check the JS-compatibility bans of the C++ port and the floating-point compile flags.

Source scan (src/** and include/**, except src/js and src/json, which implement the helpers):
  - std::sort                         -> std::stable_sort (JS sort is stable)
  - round / lround / llround          -> js::round
  - std::max / std::min               -> js::max / js::min; integers may spell the type,
                                         e.g. std::max<std::size_t>(a, b)
  - fmax / fmin                       -> js::max / js::min
  - log / log2 / log10 / log1p / exp / exp2 / expm1 / pow  -> js::log2 / js::exp / js::pow
  - std::to_string                    -> js::to_string
  - printf family, std::format        -> js::to_string / js::to_fixed
  - std::sto* / ato* / strto*         -> js::number / js::parse_int
  - float, long double                -> double
  - FP contraction or fast-math pragmas
Comments and string literals are ignored.

compile_commands.json: every translation unit must end up with -ffp-contract=off, must not
enable fast-math, and on x86-64 must use -msse2 -mfpmath=sse.
"""

from __future__ import annotations

import argparse
import json
import platform
import re
import shlex
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCAN_DIRS = ["src", "include"]
EXCLUDED = ["src/js/", "src/json/"]
SUFFIXES = {".h", ".hpp", ".cpp", ".cc", ".c", ".inc"}

# Translation units allowed to override the floating-point flags, with the reason.
FLAG_EXCEPTIONS = {
    "tests/js/ieee754_fused.cpp": "rebuilds the V8 port with contraction to model Node's FMA build",
}

_FN = r"(?<![\w.:>])(?:std::|::)?"
CODE_BANS = [
    (re.compile(r"\bstd::(?:ranges::)?sort\s*\("), "std::sort: use std::stable_sort"),
    (re.compile(_FN + r"(?:l|ll)?round[fl]?\s*\("), "round: use js::round"),
    (
        re.compile(r"\bstd::(?:max|min)\s*(?:\(|<\s*(?:double|float|long\s+double)\s*>)"),
        "std::max/min: use js::max/min (or name an integer type: std::max<int>)",
    ),
    (re.compile(_FN + r"f(?:max|min)[fl]?\s*\("), "fmax/fmin: use js::max/min"),
    (
        re.compile(_FN + r"(?:log|log2|log10|log1p|exp|exp2|expm1|pow)[fl]?\s*\("),
        "transcendental: use js::log2/exp/pow",
    ),
    (re.compile(r"\bstd::to_string\s*\("), "std::to_string: use js::to_string"),
    (re.compile(r"\bstd::sto(?:d|f|ld|i|l|ll|ul|ull)\s*\("), "std::sto*: use js::number/parse_int"),
    (
        re.compile(_FN + r"(?:ato[ifl]|atoll|strto(?:d|f|ld|l|ll|ul|ull))\s*\("),
        "ato*/strto*: use js::number/parse_int",
    ),
    (
        re.compile(_FN + r"v?(?:s|sn|f|as)?printf\s*\(|\bstd::v?format(?:_to)?\s*\("),
        "printf/std::format: use js::to_string/to_fixed",
    ),
    (re.compile(r"\bfloat\b"), "float: use double"),
    (re.compile(r"\blong\s+double\b"), "long double: use double"),
    (
        re.compile(
            r"#\s*pragma\s+(?:STDC\s+FP_CONTRACT\s+ON|clang\s+fp\s+contract|GCC\s+optimize)"
        ),
        "floating-point pragma",
    ),
]
FAST_MATH_FLAGS = {
    "-ffast-math",
    "-Ofast",
    "-funsafe-math-optimizations",
    "-ffinite-math-only",
    "-fassociative-math",
    "-freciprocal-math",
}

_TOKEN = re.compile(
    r'//[^\n]*|/\*.*?\*/|R"(?P<d>[^(\s]*)\((?P<raw>.*?)\)(?P=d)"|"(?P<str>(?:\\.|[^"\\\n])*)"'
    r"|'(?:\\.|[^'\\\n])*'",
    re.DOTALL,
)


def split_code(text: str) -> str:
    """Code with comments and literals blanked, line numbers kept."""
    out: list[str] = []
    last = 0
    for m in _TOKEN.finditer(text):
        out.append(text[last : m.start()])
        out.append(re.sub(r"[^\n]", " ", m.group(0)))
        last = m.end()
    out.append(text[last:])
    return "".join(out)


def scan_sources() -> tuple[int, list[str]]:
    files = []
    for d in SCAN_DIRS:
        for p in sorted((ROOT / d).rglob("*")):
            rel = p.relative_to(ROOT).as_posix()
            if (
                p.is_file()
                and p.suffix in SUFFIXES
                and not any(rel.startswith(e) for e in EXCLUDED)
            ):
                files.append((rel, p))
    problems = []
    for rel, path in files:
        code = split_code(path.read_text(encoding="utf-8", errors="surrogateescape"))
        for number, line in enumerate(code.splitlines(), 1):
            for pattern, message in CODE_BANS:
                if pattern.search(line):
                    problems.append(f"{rel}:{number}: {message}")
    return len(files), problems


def check_compile_commands(path: Path) -> tuple[int, list[str]]:
    if not path.exists():
        return 0, [f"{path}: not found (configure the build first)"]
    entries = json.loads(path.read_text(encoding="utf-8"))
    x86 = platform.machine().lower() in {"x86_64", "amd64"}
    problems = []
    checked = 0
    for entry in entries:
        file = Path(entry["file"])
        try:
            rel = file.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            rel = file.as_posix()
        if rel.startswith("build") or "/_deps/" in rel:
            continue
        args = entry.get("arguments") or shlex.split(entry["command"])
        checked += 1
        if rel in FLAG_EXCEPTIONS:
            continue
        contract = [a for a in args if a.startswith("-ffp-contract=")]
        if not contract or contract[-1] != "-ffp-contract=off":
            problems.append(f"{rel}: effective {contract[-1] if contract else 'no -ffp-contract'}")
        fast = sorted(FAST_MATH_FLAGS.intersection(args))
        if fast:
            problems.append(f"{rel}: enables {' '.join(fast)}")
        if x86 and not ("-msse2" in args and "-mfpmath=sse" in args):
            problems.append(f"{rel}: missing -msse2 -mfpmath=sse")
    return checked, problems


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--compile-commands", default=str(ROOT / "build/compile_commands.json"))
    args = parser.parse_args()

    scanned, source_problems = scan_sources()
    units, flag_problems = check_compile_commands(Path(args.compile_commands))
    problems = source_problems + flag_problems
    for p in problems:
        print(p, file=sys.stderr)
    print(
        f"check_banned: {scanned} source files scanned, {units} translation units checked, "
        f"{len(problems)} violations"
    )
    if scanned == 0 or units == 0:
        print("check_banned: nothing to check", file=sys.stderr)
        return 1
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
