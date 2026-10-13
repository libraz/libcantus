"""Shared fixtures: the library must load, and a helper to see the bytes a call would send."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest

from libcantus import _codec, _ffi


@pytest.fixture(scope="session", autouse=True)
def native_library() -> None:
    """Fail the whole run, rather than skip, when the shared library cannot be loaded."""
    _ffi.library()


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> Callable[..., str]:
    """Run a call against a stub transport and return the wire JSON of the arguments it got."""

    def capture(
        op: str, args: list[Any], bag: dict[str, Any] | None = None, reply: bytes = b"null"
    ) -> str:
        seen: list[bytes] = []

        def transport(_op: bytes, body: bytes, _cb: Any) -> tuple[int, bytes]:
            seen.append(body)
            return 0, reply

        monkeypatch.setattr(_codec.runtime, "_transport", transport)
        _codec.runtime.call(op, args, bag)
        return seen[0].decode("ascii")

    return capture


@pytest.fixture
def stub_replies(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[tuple[str, str]]]:
    """Answer every call with ``null`` and record ``(op, args_json)`` of each."""
    calls: list[tuple[str, str]] = []

    def transport(op: bytes, body: bytes, _cb: Any) -> tuple[int, bytes]:
        calls.append((op.decode(), body.decode("ascii")))
        return 0, b"null"

    monkeypatch.setattr(_codec.runtime, "_transport", transport)
    yield calls
