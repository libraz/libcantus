#!/usr/bin/env python3
"""Check that every `make X` / `yarn X` a workflow runs names something that exists.

A make target is a word in a `CANTUS_TARGETS` list or a rule name in the Makefile or a fragment it
includes (mk/*.mk, bindings/*/*.mk, tools/cli/*.mk). A yarn command is a root package.json script,
a yarn built-in, or, after `yarn workspace <name>`, a script of that workspace. Checking zero
invocations is a failure.

Usage: python3 tools/release/check_workflow_targets.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
YARN_BUILTINS = {"install", "dedupe", "up", "add", "remove", "exec", "dlx", "node", "pack", "run"}
INVOCATION = re.compile(r"(?:^|[\s(;&|])(make|yarn)(?=\s|$)([^\n;&|)]*)")
RULE = re.compile(r"^([A-Za-z][\w.-]*)\s*:(?!=)", re.MULTILINE)
TARGET_LIST = re.compile(r"^CANTUS_TARGETS\s*\+=((?:[^\n]*\\\n)*[^\n]*)", re.MULTILINE)


def make_targets() -> set[str]:
    """Targets named in CANTUS_TARGETS lists or defined as rules in the make sources."""
    files = [ROOT / "Makefile"]
    for pattern in ("mk/*.mk", "bindings/*/*.mk", "tools/cli/*.mk"):
        files += sorted(ROOT.glob(pattern))
    targets: set[str] = set()
    for file in files:
        text = file.read_text(encoding="utf-8")
        targets.update(RULE.findall(text))
        for body in TARGET_LIST.findall(text):
            targets.update(body.replace("\\\n", " ").split())
    return targets


def package_scripts(path: Path) -> set[str]:
    return set(json.loads(path.read_text(encoding="utf-8")).get("scripts", {}))


def workspace_scripts() -> dict[str, set[str]]:
    """Scripts of every workspace package, keyed by package name."""
    root = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    scripts: dict[str, set[str]] = {}
    for pattern in root.get("workspaces", []):
        for manifest in sorted(ROOT.glob(f"{pattern}/package.json")):
            name = json.loads(manifest.read_text(encoding="utf-8")).get("name")
            if name:
                scripts[name] = package_scripts(manifest)
    return scripts


def run_lines(text: str) -> list[tuple[int, str]]:
    """Workflow lines that can hold a command: not comments, not step names."""
    lines = []
    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.strip().lstrip("- ").strip()
        if not stripped or stripped.startswith("#") or re.match(r"(name|if|with|uses):", stripped):
            continue
        lines.append((number, line))
    return lines


def check_make(words: list[str], targets: set[str]) -> list[str]:
    named = [w for w in words if re.fullmatch(r"[A-Za-z][\w.-]*", w)]
    return [w for w in named if w not in targets]


def check_yarn(words: list[str], scripts: set[str], workspaces: dict[str, set[str]]) -> list[str]:
    words = [w for w in words if not w.startswith("-")]
    if not words:
        return []
    if words[0] == "workspace":
        if len(words) < 3:
            return [] if len(words) < 2 else [f"workspace {words[1]} (no script)"]
        known = workspaces.get(words[1])
        if known is None:
            return [f"workspace {words[1]} (unknown workspace)"]
        return [] if words[2] in known else [f"workspace {words[1]} {words[2]}"]
    if words[0] == "run" and len(words) > 1:
        return [] if words[1] in scripts else [words[1]]
    if words[0] in YARN_BUILTINS or words[0] in scripts:
        return []
    return [words[0]]


def main() -> int:
    targets = make_targets()
    scripts = package_scripts(ROOT / "package.json")
    workspaces = workspace_scripts()
    workflows = sorted((ROOT / ".github/workflows").glob("*.y*ml"))
    checked = 0
    problems: list[str] = []
    for workflow in workflows:
        rel = workflow.relative_to(ROOT).as_posix()
        for number, line in run_lines(workflow.read_text(encoding="utf-8")):
            for tool, rest in INVOCATION.findall(line):
                words = [w.strip("'\"") for w in rest.split() if "=" not in w or w.startswith("-")]
                if tool == "make":
                    named = [w for w in words if re.fullmatch(r"[A-Za-z][\w.-]*", w)]
                    checked += len(named)
                    problems += [f"{rel}:{number}: make {m}" for m in check_make(words, targets)]
                else:
                    checked += 1
                    problems += [
                        f"{rel}:{number}: yarn {m}" for m in check_yarn(words, scripts, workspaces)
                    ]
    for problem in problems:
        print(f"{problem}: not defined", file=sys.stderr)
    print(
        f"check_workflow_targets: {checked} invocations checked in {len(workflows)} workflows, "
        f"{len(problems)} undefined"
    )
    if checked == 0:
        print("check_workflow_targets: nothing to check", file=sys.stderr)
        return 1
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
