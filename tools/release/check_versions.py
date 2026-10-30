#!/usr/bin/env python3
"""Check that every site tools/release/versions.json lists carries the version of ts/package.json.

The pure TS package is the reference; a site holding a piece of the version (`part`) must hold
that piece of it. Fails when a pattern does not match exactly once, or when no site is listed.

Usage: python3 tools/release/check_versions.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def main() -> int:
    version = json.loads((REPO / "ts/package.json").read_text())["version"]
    parsed = SEMVER.match(version)
    if not parsed:
        print(
            f"check_versions: ts/package.json version {version!r} is not major.minor.patch "
            "(CMake and PEP 440 accept no prerelease suffix)",
            file=sys.stderr,
        )
        return 1
    parts = {"version": version, "major": parsed[1], "minor": parsed[2], "patch": parsed[3]}
    sites = json.loads((REPO / "tools/release/versions.json").read_text())["sites"]
    errors = []
    for site in sites:
        text = (REPO / site["file"]).read_text()
        found = re.findall(site["pattern"], text, re.MULTILINE)
        want = parts[site.get("part", "version")]
        if len(found) != 1:
            errors.append(f"{site['file']}: {site['pattern']} matches {len(found)} times")
        elif found[0] != want:
            errors.append(f"{site['file']}: {found[0]}, expected {want}")
    for error in errors:
        print(f"check_versions: {error}", file=sys.stderr)
    if not sites:
        print("check_versions: versions.json lists no site", file=sys.stderr)
        return 1
    if errors:
        return 1
    print(f"check_versions: {len(sites)} sites agree on {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
