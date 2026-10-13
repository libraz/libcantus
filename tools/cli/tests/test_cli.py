#!/usr/bin/env python3
"""Behavioural tests of the cantus CLI: exit codes, list, version, rejection, `$$` keys, input."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CLI = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else Path("build/tools/cli/cantus")

THROW_EXIT = {
    "INVALID_INPUT": 1,
    "NO_SOLUTION": 2,
    "BUDGET_EXCEEDED": 3,
    "HOST_TYPE_ERROR": 4,
    "UNKNOWN_OP": 10,
    "BAD_REQUEST": 11,
    "INTERNAL": 99,
}


def run(*argv: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(CLI), *argv], input=stdin, capture_output=True, text=True, encoding="utf-8"
    )


class CliTest(unittest.TestCase):
    def test_throw_exit_codes(self) -> None:
        for name, code in THROW_EXIT.items():
            with self.subTest(name):
                p = run("$throw", json.dumps([{"code": name, "message": "m"}]))
                self.assertEqual(p.returncode, code)
                self.assertEqual(p.stdout, "")
                self.assertEqual(json.loads(p.stderr)["code"], name)

    def test_unhandled_statuses_are_absent(self) -> None:
        # CALLBACK_FAILED and RELEASED_HANDLE have no CLI exit code of their own.
        for name in ("CALLBACK_FAILED", "RELEASED_HANDLE"):
            p = run("$throw", json.dumps([{"code": name, "message": "m"}]))
            self.assertEqual(p.returncode, 99)

    def test_list(self) -> None:
        p = run("list")
        self.assertEqual(p.returncode, 0)
        names = [e["name"] for e in json.loads(p.stdout)]
        self.assertIn("$echo", names)
        self.assertEqual(names, sorted(names))

    def test_describe(self) -> None:
        p = run("describe", "$call")
        self.assertEqual(json.loads(p.stdout), {"name": "$call", "callbacks": True, "handles": False})
        self.assertEqual(run("describe", "$nope").returncode, 10)

    def test_version(self) -> None:
        p = run("version")
        self.assertEqual(p.returncode, 0)
        self.assertRegex(json.loads(p.stdout), r"^\d+\.\d+\.\d+")

    def test_callback_and_handle_ops_rejected(self) -> None:
        for op in ("$call", "$counter", "$counter#next"):
            with self.subTest(op):
                p = run(op, "[]")
                self.assertEqual(p.returncode, 11)
                self.assertEqual(
                    json.loads(p.stderr)["message"],
                    "callback arguments are not available from the CLI",
                )

    def test_dollar_key_round_trip(self) -> None:
        p = run("$echo", '[{"$$a":{"$$b":1},"c":2}]')
        self.assertEqual(p.returncode, 0)
        self.assertEqual(json.loads(p.stdout), {"$$a": {"$$b": 1}, "c": 2})
        self.assertEqual(run("$echo", '[{"$a":1}]').returncode, 11)

    def test_input_sources(self) -> None:
        self.assertEqual(json.loads(run("$echo", "-", stdin="[7]").stdout), 7)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            f.write("[8]")
        try:
            self.assertEqual(json.loads(run("$echo", "@" + f.name).stdout), 8)
        finally:
            Path(f.name).unlink()
        self.assertEqual(run("$echo", "@/nonexistent/cantus.json").returncode, 11)

    def test_usage_errors(self) -> None:
        self.assertEqual(run().returncode, 11)
        self.assertEqual(run("$echo", "[1]", "extra").returncode, 11)
        self.assertEqual(run("$echo", "{").returncode, 11)


if __name__ == "__main__":
    unittest.main()
