"""Error classes of the op boundary and the mapping from a failed call to the error it raises.

The three library classes mirror the pure TS ones. Codes the boundary adds (``HOST_TYPE_ERROR``
onwards) surface as a plain ``CantusError`` carrying the code.
"""

from __future__ import annotations

import json
from enum import IntEnum
from typing import Any


class ErrorCode(IntEnum):
    """Failure codes of the C ABI (``CantusStatus``); 0 is success and has no member."""

    INVALID_INPUT = 1
    NO_SOLUTION = 2
    BUDGET_EXCEEDED = 3
    HOST_TYPE_ERROR = 4
    UNKNOWN_OP = 10
    BAD_REQUEST = 11
    CALLBACK_FAILED = 12
    RELEASED_HANDLE = 13
    INTERNAL = 99


class CantusError(Exception):
    """Base of every error the library raises; ``code`` says which failure it is."""

    code: ErrorCode

    def __init__(self, message: str, code: ErrorCode = ErrorCode.INTERNAL) -> None:
        super().__init__(message)
        self.code = code


class InvalidInputError(CantusError, ValueError):
    """An argument is malformed, out of range, or names something unknown."""

    def __init__(self, message: str) -> None:
        super().__init__(message, ErrorCode.INVALID_INPUT)


class NoSolutionError(CantusError):
    """A valid request with no answer; ``at`` is where in a sequence it failed, if known."""

    at: int | None

    def __init__(self, message: str, at: int | None = None) -> None:
        super().__init__(message, ErrorCode.NO_SOLUTION)
        self.at = at


class BudgetExceededError(CantusError, ValueError):
    """Work that would exceed the synchronous generation budget."""

    def __init__(self, message: str) -> None:
        super().__init__(message, ErrorCode.BUDGET_EXCEEDED)


def is_libcantus_error(value: object) -> bool:
    """Whether a caught value is one of the three coded library errors."""
    return isinstance(value, (InvalidInputError, NoSolutionError, BudgetExceededError))


def error_from_reply(status: int, reply: bytes) -> CantusError:
    """The error a failed call raises.

    ``CALLBACK_FAILED`` is not handled here: the caller re-raises the exception the callback
    raised, which only it holds.

    Args:
        status: The C ABI status of the call.
        reply: The ``{"code","name","message","at"?}`` JSON the call returned.
    """
    message = reply.decode("utf-8", "surrogatepass")
    at: Any = None
    code = _code_of_status(status)
    try:
        parsed = json.loads(message)
    except ValueError:
        parsed = None
    if isinstance(parsed, dict):
        message = str(parsed.get("message", message))
        named = ErrorCode.__members__.get(str(parsed.get("code")))
        code = code if named is None else named
        at = parsed.get("at")
    if code is ErrorCode.INVALID_INPUT:
        return InvalidInputError(message)
    if code is ErrorCode.NO_SOLUTION:
        return NoSolutionError(message, at if isinstance(at, int) else None)
    if code is ErrorCode.BUDGET_EXCEEDED:
        return BudgetExceededError(message)
    return CantusError(message, code)


def _code_of_status(status: int) -> ErrorCode:
    try:
        return ErrorCode(status)
    except ValueError:
        return ErrorCode.INTERNAL
