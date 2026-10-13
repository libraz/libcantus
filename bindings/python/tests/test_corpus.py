"""Replay the fixed call corpus through the shared library and compare the normalized results.

A corpus file is JSONL, one call per line: ``{"op", "args", "result"}`` or ``{"op", "args",
"error"}``. ``args_raw`` (a string) replaces ``args`` to send text verbatim; a line with ``skip`` is
counted and not replayed. Handle ids (``$h``) and identity tokens (``$id``) depend on process
history, so the first time an expected id meets an actual one they are paired and later lines of
the same file must agree. A ``$cb`` argument is answered by a host callback returning its argument
list. ``CANTUS_CORPUS_DIR`` replays another directory (recorded corpora) instead of the fixtures.
"""

from __future__ import annotations

import ctypes
import json
import os
from pathlib import Path
from typing import Any

import pytest

from libcantus import _ffi
from libcantus._errors import ErrorCode

ROOT = Path(__file__).resolve().parents[3]
CORPUS = Path(os.environ.get("CANTUS_CORPUS_DIR", ROOT / "tests/corpus/fixtures"))
FILES = sorted(CORPUS.rglob("*.jsonl"))
EXCERPT = 400


def normalize(value: Any) -> str:
    """The comparison form: every number a float, objects in wire order, ASCII-escaped strings."""

    def walk(node: Any) -> Any:
        if isinstance(node, bool) or node is None or isinstance(node, str):
            return node
        if isinstance(node, (int, float)):
            return float(node)
        if isinstance(node, list):
            return [walk(item) for item in node]
        return {key: walk(item) for key, item in node.items()}

    return json.dumps(walk(value), ensure_ascii=True, separators=(",", ":"))


class IdMap:
    """Pairs the ``$h`` and ``$id`` values of a recording with those of this process."""

    def __init__(self) -> None:
        self.handles: dict[Any, Any] = {}
        self.handles_back: dict[Any, Any] = {}
        self.identities: dict[Any, Any] = {}
        self.identities_back: dict[Any, Any] = {}

    def bind(self, expected: Any, actual: Any) -> bool:
        """Rewrite ids in ``expected`` to the ones ``actual`` has; False on a conflicting pair."""
        if isinstance(expected, list) and isinstance(actual, list):
            return all(self.bind(e, a) for e, a in zip(expected, actual, strict=False))
        if not isinstance(expected, dict) or not isinstance(actual, dict):
            return True
        for key in list(expected):
            if key not in actual:
                continue
            ev, av = expected[key], actual[key]
            numbers = isinstance(ev, (int, float)) and isinstance(av, (int, float))
            if key in ("$h", "$id") and numbers and not isinstance(ev, bool):
                forward, back = (
                    (self.handles, self.handles_back)
                    if key == "$h"
                    else (self.identities, self.identities_back)
                )
                if forward.setdefault(ev, av) != av or back.setdefault(av, ev) != ev:
                    return False
                expected[key] = av
            elif not self.bind(ev, av):
                return False
        return True

    def apply(self, args: Any) -> None:
        """Rewrite the recorded handle ids in ``args`` to this process's ones."""
        if isinstance(args, list):
            for item in args:
                self.apply(item)
        elif isinstance(args, dict):
            for key, item in args.items():
                if key == "$h" and item in self.handles:
                    args[key] = self.handles[item]
                else:
                    self.apply(item)


def call(op: str, args: bytes) -> tuple[int, str]:
    """One call with a host callback that answers every ``$cb`` with its argument array."""
    held: list[Any] = []

    def host(
        _ctx: int | None, _id: int, args_ptr: int | None, args_len: int, out: Any, out_len: Any
    ) -> int:
        assert args_ptr is not None
        data = ctypes.string_at(args_ptr, args_len)
        buffer = ctypes.create_string_buffer(data, len(data))
        held.append(buffer)
        out[0] = ctypes.addressof(buffer)
        out_len[0] = len(data)
        return 0

    callback = _ffi.CallbackFn(host)
    status, body = _ffi.call(op.encode("utf-8", "surrogatepass"), args, callback)
    return status, body.decode("utf-8", "surrogatepass")


def excerpt(text: str) -> str:
    return text if len(text) <= EXCERPT else text[:EXCERPT] + "..."


def replay_line(record: dict[str, Any], ids: IdMap) -> tuple[bool, str]:
    """Replay one record; returns (replayed, problem) with an empty problem when it matched."""
    if "skip" in record:
        return False, ""
    if "args_raw" in record:
        args = str(record["args_raw"]).encode("utf-8", "surrogatepass")
    else:
        sent = record.get("args", [])
        ids.apply(sent)
        args = json.dumps(sent, ensure_ascii=True, separators=(",", ":")).encode("ascii")
    if ("result" in record) == ("error" in record):
        return True, 'record needs exactly one of "result" and "error"'
    status, text = call(record["op"], args)
    actual = json.loads(text)
    if "result" in record:
        expected = record["result"]
        if status != 0:
            return True, f"expected a result, got status {status}: {excerpt(text)}"
    else:
        expected = record["error"]
        want = ErrorCode[expected["code"]].value
        if status != want:
            return True, f"expected status {want}, got {status}: {excerpt(text)}"
    if not ids.bind(expected, actual):
        return True, "handle or identity ids disagree with an earlier line"
    if normalize(expected) != normalize(actual):
        return True, (
            f"args {excerpt(args.decode('utf-8', 'surrogatepass'))}\n"
            f"  expected {excerpt(normalize(expected))}\n  actual   {excerpt(normalize(actual))}"
        )
    return True, ""


def test_corpus_is_not_empty() -> None:
    assert FILES, f"no corpus files under {CORPUS}"


@pytest.mark.parametrize("path", FILES, ids=[str(f.relative_to(CORPUS)) for f in FILES])
def test_replay(path: Path) -> None:
    ids = IdMap()
    replayed = 0
    problems: list[str] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line:
            continue
        done, problem = replay_line(json.loads(line), ids)
        replayed += done
        if problem:
            problems.append(f"{path.name}:{number}: {problem}")
    assert not problems, "\n".join(problems)
    assert replayed > 0, f"{path.name}: no calls replayed"
