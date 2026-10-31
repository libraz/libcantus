"""``python -m libcantus``: the same contract as the ``cantus`` command."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
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


def run_bytes(*argv: bytes) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [os.fsencode(sys.executable), b"-m", b"libcantus", *argv], capture_output=True, check=False
    )


def test_ill_formed_utf8_argv_is_refused_and_never_echoed() -> None:
    for op in (b"\xff", b"\xe2\x82"):
        refused = run_bytes(op, b"[]")
        assert refused.returncode == 11
        assert json.loads(refused.stderr.decode("utf-8")) == {
            "code": "BAD_REQUEST",
            "name": "Error",
            "message": "op name is not valid UTF-8",
        }
    described = run_bytes(b"describe", b"\xff")
    assert described.returncode == 10
    assert json.loads(described.stderr.decode("utf-8"))["message"] == 'unknown op "\ufffd"'
    unreadable = run_bytes(b"$echo", b"@/nonexistent/\xff")
    assert unreadable.returncode == 11
    message = json.loads(unreadable.stderr.decode("utf-8"))["message"]
    assert message == "cannot read /nonexistent/\ufffd"
    payload = run_bytes(b"$echo", b'["\xff"]')
    assert payload.returncode == 11
    assert json.loads(payload.stderr.decode("utf-8"))["code"] == "BAD_REQUEST"


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


def test_stream_sources_are_read_in_full(tmp_path: Path) -> None:
    read_end, write_end = os.pipe()
    os.write(write_end, b"[9]")
    os.close(write_end)
    try:
        piped = subprocess.run(
            [sys.executable, "-m", "libcantus", "$echo", f"@/dev/fd/{read_end}"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
            pass_fds=(read_end,),
        )
    finally:
        os.close(read_end)
    assert piped.returncode == 0
    assert piped.stdout == "9\n"
    fifo = tmp_path / "args.fifo"
    os.mkfifo(fifo)

    def feed() -> None:
        with open(fifo, "w", encoding="utf-8") as sink:
            sink.write("[10]")

    writer = threading.Thread(target=feed)
    writer.start()
    try:
        named = run("$echo", f"@{fifo}")
    finally:
        writer.join()
    assert named.returncode == 0
    assert named.stdout == "10\n"


def test_directory_argument_is_unreadable(tmp_path: Path) -> None:
    result = run("$echo", f"@{tmp_path}")
    assert result.returncode == 11
    assert result.stdout == ""
    assert json.loads(result.stderr)["message"] == f"cannot read {tmp_path}"


def test_closed_standard_streams_are_reported() -> None:
    cmd = [sys.executable, "-m", "libcantus"]
    closed_in = subprocess.run(
        ["sh", "-c", 'exec "$@" <&-', "sh", *cmd, "$echo", "-"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert closed_in.returncode == 11
    assert closed_in.stdout == ""
    assert json.loads(closed_in.stderr)["message"] == "cannot read standard input"
    for argv in (["detectChordBest", "[[0,4,7]]"], ["version"], ["list"], ["describe", "$echo"]):
        closed_out = subprocess.run(
            ["sh", "-c", 'exec "$@" >&-', "sh", *cmd, *argv],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        assert closed_out.returncode == 99, argv
        assert json.loads(closed_out.stderr)["code"] == "INTERNAL", argv


def test_error_messages_match_the_cantus_tool() -> None:
    absent = run("$echo", "@/nonexistent/cantus.json")
    assert absent.stderr == (
        '{"code":"BAD_REQUEST","name":"Error","message":"cannot read /nonexistent/cantus.json"}\n'
    )
    unknown = run("describe", "\u30c9")
    assert unknown.returncode == 10
    assert unknown.stderr == (
        '{"code":"UNKNOWN_OP","name":"Error","message":"unknown op \\"\u30c9\\""}\n'
    )


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
