"""``python -m libcantus``: the ``cantus`` command-line contract over the shared library.

``python -m libcantus <op> [ARGS_JSON | @file | -]`` prints the result JSON to stdout, or the error
JSON to stderr; the exit code is the C ABI status (12 and 13 report as 99). ``list``,
``describe <op>`` and ``version`` are built in. Ops taking callbacks or handles are rejected.
"""

from __future__ import annotations

import json
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


def _fail(code: ErrorCode, message: str) -> int:
    reply = {"code": code.name, "name": "Error", "message": message}
    sys.stderr.write(json.dumps(reply, ensure_ascii=True, separators=(",", ":")) + "\n")
    return _exit_code(code)


def _write(stream: object, body: bytes) -> None:
    buffer = getattr(stream, "buffer")  # noqa: B009 - the binary layer of a text stream
    buffer.write(body + b"\n")
    buffer.flush()


def _entry(name: str) -> dict[str, object] | None:
    for entry in json.loads(_ffi.list_ops()):
        if entry["name"] == name:
            return entry  # type: ignore[no-any-return]
    return None


def _payload(arg: str | None) -> bytes:
    if arg is None:
        return b""
    if arg == "-":
        return sys.stdin.buffer.read()
    if arg.startswith("@"):
        with open(arg[1:], "rb") as file:
            return file.read()
    return arg.encode("utf-8", "surrogatepass")


def _run_op(op: str, arg: str | None) -> int:
    entry = _entry(op)
    if entry is not None and (entry["callbacks"] or entry["handles"]):
        return _fail(ErrorCode.BAD_REQUEST, "callback arguments are not available from the CLI")
    try:
        args = _payload(arg)
    except OSError:
        return _fail(ErrorCode.BAD_REQUEST, f"cannot read {arg}")
    status, body = _ffi.call(op.encode("utf-8", "surrogatepass"), args)
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
            print(json.dumps(_ffi.version()))
            return 0
        if command == "list":
            _write(sys.stdout, _ffi.list_ops())
            return 0
        if command == "describe":
            if len(argv) != 2:
                return _fail(ErrorCode.BAD_REQUEST, "describe takes one op name")
            entry = _entry(argv[1])
            if entry is None:
                message = f"unknown op {json.dumps(argv[1])}"
                return _fail(ErrorCode.UNKNOWN_OP, message)
            print(json.dumps(entry, ensure_ascii=True, separators=(",", ":")))
            return 0
        if len(argv) > 2:
            return _fail(ErrorCode.BAD_REQUEST, "too many arguments")
        return _run_op(command, argv[1] if len(argv) == 2 else None)
    except CantusError as error:
        return _fail(error.code, str(error))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
