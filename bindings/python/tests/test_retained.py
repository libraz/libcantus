"""Retained values against the core and a recording transport: what is retained, and the caps."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import pytest

import libcantus
from libcantus import _codec
from libcantus._errors import CantusError, ErrorCode


def notes(*pitches: int) -> list[dict[str, int]]:
    return [{"pitch": pitch, "startBeat": 0, "durationBeat": 4} for pitch in pitches]


def nested(levels: int) -> Any:
    value: Any = 0
    for _ in range(levels):
        value = [value]
    return value


class Recorder:
    """A transport that records every call and answers ``$retain`` with fresh ids."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.released: list[int] = []
        self.next_id = 0

    def transport(self, op: bytes, body: bytes, _cb: Any) -> tuple[int, bytes]:
        self.calls.append((op.decode(), body.decode("ascii")))
        if op == b"$retain":
            self.next_id += 1
            wire = json.loads(body)[0]
            return 0, json.dumps({"$class": wire["$class"], "$ref": self.next_id}).encode()
        return 0, b"null"


def recorded(max_ref_bytes: int = _codec.MAX_REF_BYTES) -> tuple[_codec.Runtime, Recorder]:
    core = Recorder()
    rt = _codec.Runtime(core.transport, core.released.append)
    rt._max_ref_bytes = max_ref_bytes
    rt.register(libcantus.Score)
    rt.by_reference("Score")
    return rt, core


def score(rt: _codec.Runtime, size: int) -> Any:
    """A score whose wire text is ``{"$class":"Score","notes":[...]}`` with ``size`` zeros."""
    return rt._decode({"$class": "Score", "notes": [0] * size})


def text_of(size: int) -> int:
    return len(json.dumps({"$class": "Score", "notes": [0] * size}, separators=(",", ":")))


class TestHybridSnapshot:
    def test_edits_before_the_first_method_call_are_seen(self) -> None:
        timeline = libcantus.chord_timeline_from_notes(notes(60, 64, 67), key="C major")["timeline"]
        g = libcantus.chord_timeline_from_notes(notes(67, 71, 74), key="C major")["timeline"]
        timeline.segments[0]["chord"] = g.segments[0]["chord"]
        assert timeline.at(0)["rootPc"] == 7
        assert timeline.at(0)["rootPc"] == 7


class TestByteCap:
    def test_default_cap_matches_the_js_runtime(self) -> None:
        assert _codec.MAX_REF_BYTES == 4 * 1024 * 1024
        assert _codec.MAX_LIVE_REFS == 1024

    def test_retained_text_stays_within_the_cap(self) -> None:
        size = text_of(5)
        rt, core = recorded(max_ref_bytes=3 * size)
        held = [score(rt, 5) for _ in range(20)]
        for value in held:
            rt.call("Score#secondsAt", [value, 0])
            assert rt.retained_bytes <= 3 * size
        assert rt.retained_refs == 3
        assert rt.retained_bytes == 3 * size
        assert core.released == list(range(1, 18))

    def test_a_value_larger_than_the_cap_is_sent_as_data(self) -> None:
        rt, core = recorded(max_ref_bytes=text_of(5))
        big = score(rt, 6)
        rt.call("Score#secondsAt", [big, 0])
        rt.call("Score#secondsAt", [big, 0])
        assert [op for op, _ in core.calls] == ["Score#secondsAt", "Score#secondsAt"]
        assert core.calls[-1][1].startswith('[{"$class":"Score","notes":[')
        assert rt.retained_refs == 0
        assert rt.retained_bytes == 0

    def test_the_charge_is_counted_in_utf16_units(self) -> None:
        rt, _ = recorded()
        value = rt._decode({"$class": "Score", "notes": [], "title": "é\U0001f3b5"})
        rt.call("Score#secondsAt", [value, 0])
        assert rt.retained_bytes == len('{"$class":"Score","notes":[],"title":"') + 3 + 2

    def test_a_released_value_gives_its_charge_back(self) -> None:
        rt, core = recorded()
        value = score(rt, 2)
        rt.call("Score#secondsAt", [value, 0])
        assert rt.retained_bytes == text_of(2)
        del value
        assert core.released == [1]
        assert rt.retained_bytes == 0


class TestNesting:
    def test_an_argument_max_depth_levels_deep_is_sent(self, sent: Callable[..., str]) -> None:
        depth = _codec.MAX_DEPTH
        assert depth == 4096
        assert sent("$echo", [nested(depth)]) == "[" + "[" * depth + "0" + "]" * depth + "]"

    @pytest.mark.parametrize("levels", [_codec.MAX_DEPTH + 1, 100_000])
    def test_a_deeper_argument_is_a_bad_request(self, levels: int) -> None:
        with pytest.raises(CantusError) as raised:
            libcantus._codec.runtime.call("$echo", [nested(levels)])
        assert raised.value.code == ErrorCode.BAD_REQUEST
        assert str(raised.value) == f"invalid args JSON: nesting deeper than {_codec.MAX_DEPTH}"

    def test_the_core_refuses_what_the_wrapping_list_takes_past_the_limit(self) -> None:
        with pytest.raises(CantusError) as raised:
            libcantus._codec.runtime.call("$echo", [nested(_codec.MAX_DEPTH)])
        assert raised.value.code == ErrorCode.BAD_REQUEST
