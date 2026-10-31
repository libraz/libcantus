"""``python -m libcantus``: the ``cantus`` command-line contract over the shared library.

``python -m libcantus <op> [ARGS_JSON | @file | -]`` prints the result JSON to stdout, or the error
JSON to stderr; the exit code is the C ABI status (12 and 13 report as 99). ``list``,
``describe <op>`` and ``version`` are built in. Ops taking callbacks or handles are rejected.
"""

from __future__ import annotations

import json
import os
import sys

from . import _ffi
from ._errors import CantusError, ErrorCode

USAGE = (
    "usage: python -m libcantus <op> [ARGS_JSON | @file | -]\n"
    "       python -m libcantus list | describe <op> | version\n"
)

_EXIT = {
    ErrorCode.INVALID_INPUT: 1,
    ErrorCode.NO_SOLUTION: 2,
    ErrorCode.BUDGET_EXCEEDED: 3,
    ErrorCode.HOST_TYPE_ERROR: 4,
    ErrorCode.UNKNOWN_OP: 10,
    ErrorCode.BAD_REQUEST: 11,
}


def _exit_code(status: int) -> int:
    if status == 0:
        return 0
    try:
        return _EXIT.get(ErrorCode(status), 99)
    except ValueError:
        return 99


def _quote(text: str) -> str:
    """A JSON string literal as the cantus tool writes it: quote, backslash and controls escaped."""
    out = ['"']
    for char in text:
        if char in '"\\':
            out.append("\\" + char)
        elif ord(char) < 0x20:
            out.append(f"\\u{ord(char):04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def _shown(text: str) -> str:
    """Argument text as an error message may quote it: ill-formed UTF-8 shown as U+FFFD."""
    return os.fsencode(text).decode("utf-8", "replace")


def _fail(code: ErrorCode, message: str) -> int:
    reply = f'{{"code":{_quote(code.name)},"name":"Error","message":{_quote(message)}}}'
    _write(sys.stderr, reply.encode("utf-8"))
    return _exit_code(code)


class _Unwritable(Exception):
    """An output stream that is closed, missing or rejected the bytes."""


def _write(stream: object, body: bytes) -> None:
    try:
        buffer = getattr(stream, "buffer")  # noqa: B009 - the binary layer of a text stream
        buffer.write(body + b"\n")
        buffer.flush()
    except (AttributeError, OSError, ValueError) as error:
        raise _Unwritable from error


def _silence_output() -> None:
    """Send both output descriptors to the null device so shutdown cannot fail on them again."""
    try:
        null = os.open(os.devnull, os.O_WRONLY)
        for fd in (1, 2):
            os.dup2(null, fd)
    except OSError:
        pass


def _entry(name: str) -> dict[str, object] | None:
    for entry in json.loads(_ffi.list_ops()):
        if entry["name"] == name:
            return entry  # type: ignore[no-any-return]
    return None


class _Unreadable(Exception):
    """An argument source that could not be read in full; the message names it."""


def _payload(arg: str | None) -> bytes:
    if arg is None:
        return b""
    if arg == "-":
        try:
            return sys.stdin.buffer.read()
        except (AttributeError, OSError, ValueError) as error:
            raise _Unreadable("standard input") from error
    if arg.startswith("@"):
        try:
            with open(arg[1:], "rb") as file:
                return file.read()
        except OSError as error:
            raise _Unreadable(_shown(arg[1:])) from error
    return os.fsencode(arg)


def _run_op(op: str, arg: str | None) -> int:
    entry = _entry(op)
    if entry is not None and (entry["callbacks"] or entry["handles"]):
        return _fail(ErrorCode.BAD_REQUEST, "callback arguments are not available from the CLI")
    try:
        args = _payload(arg)
    except _Unreadable as error:
        return _fail(ErrorCode.BAD_REQUEST, f"cannot read {error}")
    status, body = _ffi.call(os.fsencode(op), args)
    _write(sys.stdout if status == 0 else sys.stderr, body)
    return _exit_code(status)


def main(argv: list[str]) -> int:
    """Run the command line and return the process exit code."""
    if not argv:
        sys.stderr.write(USAGE)
        return _fail(ErrorCode.BAD_REQUEST, "missing op")
    command = argv[0]
    try:
        if command == "version":
            _write(sys.stdout, json.dumps(_ffi.version()).encode("ascii"))
            return 0
        if command == "list":
            _write(sys.stdout, _ffi.list_ops())
            return 0
        if command == "describe":
            if len(argv) != 2:
                return _fail(ErrorCode.BAD_REQUEST, "describe takes one op name")
            entry = _entry(argv[1])
            if entry is None:
                message = f"unknown op {_quote(_shown(argv[1]))}"
                return _fail(ErrorCode.UNKNOWN_OP, message)
            _write(sys.stdout, json.dumps(entry, separators=(",", ":")).encode("ascii"))
            return 0
        if len(argv) > 2:
            return _fail(ErrorCode.BAD_REQUEST, "too many arguments")
        return _run_op(command, argv[1] if len(argv) == 2 else None)
    except CantusError as error:
        return _fail(error.code, str(error))
    except _Unwritable:
        try:
            code = _fail(ErrorCode.INTERNAL, "cannot write output")
        except _Unwritable:
            code = _exit_code(ErrorCode.INTERNAL)
        _silence_output()
        return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
