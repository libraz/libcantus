"""``python -m libcantus``: the same contract as the ``cantus`` command."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import libcantus

THROW_EXIT = {
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


def run(*argv: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "libcantus", *argv],
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


@pytest.mark.parametrize(("name", "code"), THROW_EXIT.items())
def test_throw_exit_codes(name: str, code: int) -> None:
    result = run("$throw", json.dumps([{"code": name, "message": "m"}]))
    assert result.returncode == code
    assert result.stdout == ""
    assert json.loads(result.stderr)["code"] == name


def test_result_goes_to_stdout() -> None:
    result = run("$echo", "[[1,2.5,null]]")
    assert result.returncode == 0
    assert result.stderr == ""
    assert result.stdout == "[1,2.5,null]\n"


def test_dollar_keys_are_written_escaped() -> None:
    result = run("$echo", '[{"$$a":1}]')
    assert result.returncode == 0
    assert result.stdout == '{"$$a":1}\n'


def test_arguments_from_stdin_and_file(tmp_path: Path) -> None:
    assert run("$echo", "-", stdin="[7]").stdout == "7\n"
    file = tmp_path / "args.json"
    file.write_text('["from file"]', encoding="utf-8")
    assert run("$echo", f"@{file}").stdout == '"from file"\n'
    missing = run("$echo", f"@{tmp_path / 'absent.json'}")
    assert missing.returncode == 11


def test_no_arguments_means_none() -> None:
    result = run("$counter")
    assert result.returncode == 11
    assert "callback arguments are not available from the CLI" in result.stderr


def test_callback_ops_are_rejected() -> None:
    result = run("$call", '[{"$cb":0}]')
    assert result.returncode == 11
    assert (
        json.loads(result.stderr)["message"] == "callback arguments are not available from the CLI"
    )


def test_unknown_op_and_bad_usage() -> None:
    assert run("nope").returncode == 10
    assert run().returncode == 11
    assert run("$echo", "[1]", "extra").returncode == 11
    assert run("$echo", "{}").returncode == 11


def test_list_describe_and_version() -> None:
    listed = json.loads(run("list").stdout)
    assert {entry["name"] for entry in listed} == {e["name"] for e in libcantus.list_ops()}
    described = run("describe", "$echo")
    assert described.returncode == 0
    assert json.loads(described.stdout)["name"] == "$echo"
    assert run("describe", "nope").returncode == 10
    assert run("describe").returncode == 11
    assert json.loads(run("version").stdout) == libcantus.version()
