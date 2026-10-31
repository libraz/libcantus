"""The op boundary through the builtin ops: tags, errors, callbacks, handles."""

from __future__ import annotations

import copy
import gc
import json
import math
import pickle
import threading
from collections.abc import Callable
from typing import Any, ClassVar

import pytest

import libcantus
from libcantus import _codec, _ffi
from libcantus._errors import ErrorCode, error_from_reply

runtime = _codec.runtime


def echo(value: Any) -> Any:
    return runtime.call("$echo", [value])


def echo_wire(text: str) -> Any:
    """Send raw wire JSON (tags included) through ``$echo`` and decode the reply."""
    status, body = _ffi.call(b"$echo", f"[{text}]".encode("ascii"))
    assert status == 0, body
    return runtime._decode(json.loads(body))


def live() -> int:
    count = runtime.call("$live", [])
    assert isinstance(count, int)
    return count


class TestValues:
    @pytest.mark.parametrize(
        "value", [None, True, False, 0, -1, 7, 2**31, 1.5, -2.25, 1e21, 5e-324]
    )
    def test_roundtrip(self, value: Any) -> None:
        result = echo(value)
        assert result == value
        assert type(result) is type(value)

    def test_bool_stays_bool(self, sent: Callable[..., str]) -> None:
        assert sent("$echo", [True]) == "[true]"
        assert sent("$echo", [False]) == "[false]"

    def test_ints_above_2_53_are_sent_as_decimal(self, sent: Callable[..., str]) -> None:
        assert sent("$echo", [2**53 + 1]) == "[9007199254740993]"
        assert sent("$echo", [-(10**20)]) == "[-100000000000000000000]"

    def test_ints_above_2_53_meet_the_double_of_the_core(self) -> None:
        assert echo(2**53 + 1) == 2**53
        assert echo(10**20) == 10**20
        assert echo(2**53 - 1) == 2**53 - 1

    def test_nan_and_infinities_are_tagged(self, sent: Callable[..., str]) -> None:
        assert sent("$echo", [math.nan]) == '[{"$n":"NaN"}]'
        assert sent("$echo", [math.inf]) == '[{"$n":"Infinity"}]'
        assert sent("$echo", [-math.inf]) == '[{"$n":"-Infinity"}]'
        assert sent("$echo", [-0.0]) == '[{"$n":"-0"}]'

    def test_nan_and_infinities_come_back(self) -> None:
        assert math.isnan(echo(math.nan))
        assert echo(math.inf) == math.inf
        assert echo(-math.inf) == -math.inf
        negative_zero = echo(-0.0)
        assert negative_zero == 0.0
        assert math.copysign(1.0, negative_zero) < 0

    def test_nan_inside_containers(self) -> None:
        result = echo([1, {"x": math.nan}])
        assert result[0] == 1
        assert math.isnan(result[1]["x"])

    def test_tuples_are_lists(self) -> None:
        assert echo((1, (2, 3))) == [1, [2, 3]]

    def test_unsupported_values_raise_type_error(self) -> None:
        with pytest.raises(TypeError):
            echo({1: "a"})
        with pytest.raises(TypeError):
            echo(object())

    def test_self_reference_is_cut(self) -> None:
        looped: list[Any] = [1]
        looped.append(looped)
        assert echo(looped) == [1, []]

    def test_big_tag_and_other_result_tags(self) -> None:
        assert echo_wire('{"$big":"-12345678901234567890"}') == -12345678901234567890
        assert echo_wire('{"$sym":"tag"}') == "tag"
        assert echo_wire('{"$tojson":{"a":[1,2]},"$repr":"[object Object]"}') == {"a": [1, 2]}
        assert echo_wire('{"$n":"NaN"}') != echo_wire('{"$n":"NaN"}')


class TestAbsentAndNull:
    def test_positional_none_is_null(self, sent: Callable[..., str]) -> None:
        assert sent("$echo", [None]) == "[null]"

    def test_none_inside_containers_is_null(self, sent: Callable[..., str]) -> None:
        assert sent("$echo", [[1, None], {"a": None}]) == '[[1,null],{"a":null}]'

    def test_none_option_is_absent(self, sent: Callable[..., str]) -> None:
        assert sent("$echo", [], {"a": None, "b": None}) == "[]"
        assert sent("$echo", [], {"a": None, "b": 2}) == '[{"b":2}]'
        assert sent("$echo", [1], {"a": None}) == "[1]"

    def test_unset_positional(self, sent: Callable[..., str]) -> None:
        unset = libcantus.UNSET
        assert sent("$echo", [1, unset]) == "[1]"
        assert sent("$echo", [1, unset, unset]) == "[1]"
        assert sent("$echo", [1, unset], {"k": 2}) == '[1,{"$u":1},{"k":2}]'
        assert sent("$echo", [[1, unset, 3]]) == '[[1,{"$u":1},3]]'
        assert sent("$echo", [{"a": unset, "b": 1}]) == '[{"b":1}]'

    def test_undefined_comes_back_as_none(self) -> None:
        assert echo_wire('[1,{"$u":1},3]') == [1, None, 3]
        assert runtime.call("$echo", []) is None

    def test_none_and_absent_differ_in_the_core(self) -> None:
        absent = runtime.call("$counter", [])
        assert absent.value["count"] == 0
        absent.close()
        with pytest.raises(libcantus.CantusError, match="start must be a number"):
            runtime.call("$counter", [None])


class TestStrings:
    @pytest.mark.parametrize(
        "text",
        ["", "café ♫ \U0001f3b5", "\ud800", "x\udfffy", '\x00\x01\x1f\x7f"\\/', "\u2028"],
    )
    def test_roundtrip_including_lone_surrogates(self, text: str) -> None:
        assert echo(text) == text

    def test_lone_surrogate_travels_escaped(self, sent: Callable[..., str]) -> None:
        assert sent("$echo", ["a\ud800b"]) == '["a\\ud800b"]'

    def test_embedded_nul_in_op_name(self) -> None:
        with pytest.raises(libcantus.CantusError) as info:
            runtime.call("$echo\x00x", [1])
        assert info.value.code is ErrorCode.UNKNOWN_OP
        assert "\\u0000" in str(info.value)

    def test_lone_surrogate_in_error_message(self) -> None:
        with pytest.raises(libcantus.CantusError) as info:
            runtime.call("$throw", [{"code": "UNKNOWN_OP", "message": "m \ud800 é"}])
        assert str(info.value) == "m \ud800 é"


class TestDollarKeys:
    def test_user_keys_are_escaped(self, sent: Callable[..., str]) -> None:
        assert sent("$echo", [{"$a": 1, "$$b": 2, "c": 3}]) == '[{"$$a":1,"$$$b":2,"c":3}]'

    def test_roundtrip(self) -> None:
        value = {"$a": 1, "$$b": {"$c": [{"$": 2}]}, "__proto__": {"x": 1}}
        assert echo(value) == value

    def test_key_order_is_kept(self) -> None:
        assert list(echo({"b": 1, "a": 2})) == ["b", "a"]

    def test_unknown_tag_is_a_bad_request(self) -> None:
        status, body = _ffi.call(b"$echo", b'[{"$zz":1}]')
        assert status == ErrorCode.BAD_REQUEST
        assert "unknown wire tag" in str(error_from_reply(status, body))

    def test_unknown_tag_in_a_result(self) -> None:
        with pytest.raises(libcantus.CantusError) as info:
            runtime._decode({"$zz": 1})
        assert info.value.code is ErrorCode.BAD_REQUEST


class TestTaggedObjects:
    def test_class_instance_roundtrips_its_wire(self) -> None:
        chord = echo_wire('{"$class":"Chord","root":0,"quality":"maj"}')
        assert isinstance(chord, libcantus.Chord)
        assert chord._wire == {"$class": "Chord", "root": 0, "quality": "maj"}
        assert echo(chord) is not chord
        assert echo(chord)._wire == chord._wire

    def test_unknown_class_is_a_bad_request(self) -> None:
        with pytest.raises(libcantus.CantusError) as info:
            echo_wire('{"$class":"Nope","x":1}')
        assert info.value.code is ErrorCode.BAD_REQUEST

    def test_hybrid_has_fields_and_resends_them(self, sent: Callable[..., str]) -> None:
        timeline = echo_wire('{"$hy":"ChordTimeline","segments":[1,2]}')
        assert isinstance(timeline, libcantus.ChordTimeline)
        assert timeline.segments == [1, 2]
        assert sent("$echo", [timeline]) == '[{"$hy":"ChordTimeline","segments":[1,2]}]'
        timeline.segments = [3]
        assert sent("$echo", [timeline]) == '[{"$hy":"ChordTimeline","segments":[3]}]'

    def test_hybrid_method_goes_over_as_a_callback(self, sent: Callable[..., str]) -> None:
        timeline = echo_wire('{"$hy":"ChordTimeline","segments":[]}')
        assert sent("$echo", [timeline.at]) == '[{"$cb":0}]'

    def test_class_instance_goes_over_as_its_methods(self, sent: Callable[..., str]) -> None:
        class Rng:
            hidden = 1

            def at(self) -> float:
                return 0.1

        assert sent("$echo", [Rng()]) == '[{"at":{"$cb":0}}]'
        with pytest.raises(TypeError):
            echo(object())

    def test_callback_tag(self, sent: Callable[..., str]) -> None:
        assert sent("$echo", [lambda: 1]) == '[{"$cb":0}]'
        assert sent("$echo", [lambda: 1, lambda: 2]) == '[{"$cb":0},{"$cb":1}]'


class TestErrors:
    CASES: tuple[tuple[str, type[Exception]], ...] = (
        ("INVALID_INPUT", libcantus.InvalidInputError),
        ("NO_SOLUTION", libcantus.NoSolutionError),
        ("BUDGET_EXCEEDED", libcantus.BudgetExceededError),
        ("HOST_TYPE_ERROR", libcantus.CantusError),
        ("UNKNOWN_OP", libcantus.CantusError),
        ("BAD_REQUEST", libcantus.CantusError),
        ("CALLBACK_FAILED", libcantus.CantusError),
        ("RELEASED_HANDLE", libcantus.CantusError),
        ("INTERNAL", libcantus.CantusError),
    )

    @pytest.mark.parametrize(("name", "cls"), CASES)
    def test_every_code(self, name: str, cls: type[Exception]) -> None:
        with pytest.raises(libcantus.CantusError) as info:
            runtime.call("$throw", [{"code": name, "message": "boom"}])
        error = info.value
        assert type(error) is cls
        assert error.code is ErrorCode[name]
        assert error.code.name == name
        assert str(error) == "boom"

    def test_statuses_match_the_c_abi(self) -> None:
        for name, _ in self.CASES:
            status, body = _ffi.call(
                b"$throw", json.dumps([{"code": name, "message": "m"}]).encode()
            )
            assert status == ErrorCode[name].value
            assert json.loads(body)["code"] == name

    def test_value_error_ancestry(self) -> None:
        assert issubclass(libcantus.InvalidInputError, ValueError)
        assert issubclass(libcantus.BudgetExceededError, ValueError)
        assert not issubclass(libcantus.NoSolutionError, ValueError)
        assert issubclass(libcantus.NoSolutionError, libcantus.CantusError)

    def test_no_solution_at(self) -> None:
        with pytest.raises(libcantus.NoSolutionError) as info:
            runtime.call("$throw", [{"code": "NO_SOLUTION", "message": "m", "at": 3}])
        assert info.value.at == 3
        with pytest.raises(libcantus.NoSolutionError) as zero:
            runtime.call("$throw", [{"code": "NO_SOLUTION", "message": "m", "at": 0}])
        assert zero.value.at == 0
        with pytest.raises(libcantus.NoSolutionError) as none:
            runtime.call("$throw", [{"code": "NO_SOLUTION", "message": "m"}])
        assert none.value.at is None

    def test_is_libcantus_error(self) -> None:
        assert libcantus.is_libcantus_error(libcantus.InvalidInputError("x"))
        assert libcantus.is_libcantus_error(libcantus.NoSolutionError("x"))
        assert libcantus.is_libcantus_error(libcantus.BudgetExceededError("x"))
        assert not libcantus.is_libcantus_error(libcantus.CantusError("x"))
        assert not libcantus.is_libcantus_error(ValueError("x"))

    def test_error_class_in_a_result_decodes_to_an_instance(self) -> None:
        error = echo_wire('{"$class":"NoSolutionError","message":"m","at":2}')
        assert isinstance(error, libcantus.NoSolutionError)
        assert error.at == 2


class TestCallbacks:
    def test_arguments_and_result(self) -> None:
        assert runtime.call("$call", [lambda *a: list(a), 1, "a"]) == [1, "a"]
        assert runtime.call("$call", [lambda *a: list(a)]) == []

    def test_values_cross_both_ways(self) -> None:
        seen: list[Any] = []

        def callback(*args: Any) -> Any:
            seen.extend(args)
            return args[0]

        result = runtime.call("$call", [callback, math.nan, {"$k": [None]}])
        assert math.isnan(seen[0])
        assert seen[1] == {"$k": [None]}
        assert math.isnan(result)

    def test_original_exception_is_reraised(self) -> None:
        class Boom(Exception):
            pass

        failure = Boom("original")

        def callback(*_: Any) -> Any:
            raise failure

        with pytest.raises(Boom) as info:
            runtime.call("$call", [callback, 1])
        assert info.value is failure

    def test_library_error_from_a_callback_keeps_its_class(self) -> None:
        def callback(*_: Any) -> Any:
            raise libcantus.NoSolutionError("from the callback", 9)

        with pytest.raises(libcantus.NoSolutionError) as info:
            runtime.call("$call", [callback])
        assert info.value.at == 9

    def test_unencodable_result_is_reraised(self) -> None:
        with pytest.raises(TypeError):
            runtime.call("$call", [lambda *_: object()])

    def test_reentrant_call(self) -> None:
        def callback(*args: Any) -> Any:
            return runtime.call("$echo", [{"inner": args}])

        assert runtime.call("$call", [callback, 5]) == {"inner": [5]}

    def test_error_inside_a_reentrant_call(self) -> None:
        def callback(*_: Any) -> Any:
            return runtime.call("$throw", [{"code": "BUDGET_EXCEEDED", "message": "inner"}])

        with pytest.raises(libcantus.BudgetExceededError, match="inner"):
            runtime.call("$call", [callback])

    def test_callback_argument_is_required(self) -> None:
        with pytest.raises(libcantus.CantusError) as info:
            runtime.call("$call", [1])
        assert info.value.code is ErrorCode.BAD_REQUEST

    def test_result_echoing_a_callback_hands_back_the_function(self) -> None:
        def at(_beat: float) -> None:
            return None

        segments = [{"startBeat": 0, "endBeat": 4, "chord": None}]
        result = libcantus.assert_chord_timeline({"segments": segments, "at": at})
        assert result == {"segments": segments, "at": at}
        assert result["at"] is at
        assert echo(at) is at


class TestHandles:
    def test_methods_and_identity_tokens(self) -> None:
        with runtime.call("$counter", [5]) as counter:
            assert counter.next() == 6
            first = counter.value
            assert first == {"count": 6}
            assert counter.value is first
            assert counter.next() == 7
            assert counter.value is not first
            assert counter.value == {"count": 7}

    def test_live_count_follows_close(self) -> None:
        before = live()
        counter = runtime.call("$counter", [])
        assert live() == before + 1
        assert not counter.closed
        counter.close()
        assert counter.closed
        assert live() == before
        counter.close()
        assert live() == before

    def test_context_manager_releases(self) -> None:
        before = live()
        with runtime.call("$counter", []) as counter:
            assert live() == before + 1
        assert counter.closed
        assert live() == before

    def test_released_handle_raises(self) -> None:
        counter = runtime.call("$counter", [])
        counter.close()
        with pytest.raises(libcantus.CantusError) as info:
            counter.next()
        assert info.value.code is ErrorCode.RELEASED_HANDLE

    def test_dropping_a_handle_releases_it(self) -> None:
        before = live()
        counter = runtime.call("$counter", [])
        assert live() == before + 1
        del counter
        gc.collect()
        assert live() == before

    def test_handle_goes_back_as_its_tag(self, sent: Callable[..., str]) -> None:
        counter = runtime.call("$counter", [])
        try:
            assert sent("$echo", [counter]) == f'[{{"$h":{counter._id},"$type":"$counter"}}]'
        finally:
            counter.close()

    def test_calls_from_threads_are_serialized(self) -> None:
        with runtime.call("$counter", []) as counter:
            errors: list[BaseException] = []

            def work() -> None:
                try:
                    for _ in range(200):
                        counter.next()
                except BaseException as error:
                    errors.append(error)

            threads = [threading.Thread(target=work) for _ in range(8)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            assert errors == []
            assert counter.value == {"count": 1600}

    def test_unknown_handle_type_is_a_bad_request(self) -> None:
        with pytest.raises(libcantus.CantusError) as info:
            runtime._decode({"$h": 99, "$type": "Nope"})
        assert info.value.code is ErrorCode.BAD_REQUEST


class TestSharedValues:
    def test_identity_results_refuse_writes(self) -> None:
        shared = echo_wire('{"$id":4101,"pitch":60,"tags":[1,2],"inner":{"a":1}}')
        with pytest.raises(TypeError):
            shared["pitch"] = 0
        with pytest.raises(TypeError):
            shared["tags"].append(3)
        with pytest.raises(TypeError):
            shared["inner"].update(a=2)
        assert shared == {"pitch": 60, "tags": [1, 2], "inner": {"a": 1}}

    def test_constants_refuse_writes(self) -> None:
        with pytest.raises(TypeError):
            libcantus.NAMED_SCALES["major"] = "CORRUPT"


class TestLibrary:
    def test_version_and_abi(self) -> None:
        assert libcantus.version() == _ffi.version()
        assert _ffi.library().cantus_abi_version() == _ffi.ABI_VERSION
        assert libcantus.algorithm_version() >= 1

    def test_list_ops_has_the_builtins(self) -> None:
        names = {entry["name"] for entry in libcantus.list_ops()}
        assert {"$echo", "$throw", "$counter", "$call", "$live", "$version"} <= names
        call = next(e for e in libcantus.list_ops() if e["name"] == "$call")
        assert call["callbacks"] is True


class FakeCore:
    """A transport that records every call and releases, and answers ``$retain`` with fresh ids."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.released: list[int] = []
        self.replies: dict[str, bytes] = {}
        self.retain_status = 0
        self.next_id = 100
        self.on_call: Callable[[str], None] | None = None

    def transport(self, op: bytes, body: bytes, _cb: Any) -> tuple[int, bytes]:
        name = op.decode()
        self.calls.append((name, body.decode("ascii")))
        if self.on_call is not None:
            self.on_call(name)
        if name == "$retain":
            if self.retain_status != 0:
                return self.retain_status, b'{"code":"UNKNOWN_OP","message":"unknown op"}'
            self.next_id += 1
            wire = json.loads(body)[0]
            tag = "$class" if "$class" in wire else "$hy"
            return 0, json.dumps({tag: wire[tag], "$ref": self.next_id}).encode()
        if name.startswith("ArrangementSession#") and 7 in self.released:
            return ErrorCode.RELEASED_HANDLE, b'{"code":"RELEASED_HANDLE","message":"released"}'
        return 0, self.replies.get(name, b"null")

    def ops(self) -> list[str]:
        return [name for name, _ in self.calls]


def fake_runtime(max_refs: int = _codec.MAX_LIVE_REFS) -> tuple[_codec.Runtime, FakeCore]:
    core = FakeCore()
    rt = _codec.Runtime(core.transport, core.released.append)
    rt._max_refs = max_refs
    rt.register(libcantus.Score, libcantus.Timeline, libcantus.ChordTimeline, libcantus.Rng)
    rt.register(libcantus.ArrangementSession, libcantus.Arrangement)
    rt.by_reference("Arrangement", "Score", "Timeline", "ChordTimeline")
    return rt, core


def make_score(rt: _codec.Runtime, notes: int = 1) -> Any:
    return rt._decode({"$class": "Score", "notes": list(range(notes))})


class TestRetainedValues:
    def test_receiver_is_retained_once_and_sent_as_a_reference(self) -> None:
        rt, core = fake_runtime()
        score = make_score(rt)
        rt.call("Score#secondsAt", [score, 1.5])
        rt.call("Score#secondsAt", [score, 2.5])
        assert core.ops() == ["$retain", "Score#secondsAt", "Score#secondsAt"]
        assert core.calls[0][1] == '[{"$class":"Score","notes":[0]}]'
        assert core.calls[1][1] == '[{"$class":"Score","$ref":101},1.5]'
        assert core.calls[2][1] == '[{"$class":"Score","$ref":101},2.5]'

    def test_a_retained_class_is_a_reference_in_any_position(self) -> None:
        rt, core = fake_runtime()
        score = make_score(rt)
        rt.call("Score#secondsAt", [score, 0])
        rt.call("$echo", [[score, {"inner": score}]])
        assert core.calls[-1][1] == (
            '[[{"$class":"Score","$ref":101},{"inner":{"$class":"Score","$ref":101}}]]'
        )

    def test_only_receivers_of_by_reference_types_are_retained(self) -> None:
        rt, core = fake_runtime()
        score = make_score(rt)
        rt.call("$echo", [score])
        rt.call("Tempo#secondsAt", [score, 1])
        rt.call("Score.of", [score])
        assert core.ops() == ["$echo", "Tempo#secondsAt", "Score.of"]
        assert score._ref is None

    def test_a_hybrid_is_a_reference_only_as_its_own_receiver(self) -> None:
        rt, core = fake_runtime()
        timeline = rt._decode({"$hy": "ChordTimeline", "segments": [1, 2]})
        rt.call("ChordTimeline#at", [timeline, 0])
        rt.call("ChordTimeline#at", [timeline, 1])
        assert core.calls[0] == ("$retain", '[{"$hy":"ChordTimeline","segments":[1,2]}]')
        assert core.calls[1][1] == '[{"$hy":"ChordTimeline","$ref":101},0]'
        assert core.calls[2][1] == '[{"$hy":"ChordTimeline","$ref":101},1]'
        rt.call("$echo", [timeline])
        rt.call("Score#secondsAt", [make_score(rt), timeline])
        assert core.calls[3][1] == '[{"$hy":"ChordTimeline","segments":[1,2]}]'
        assert core.calls[-1][1].endswith(',{"$hy":"ChordTimeline","segments":[1,2]}]')

    def test_a_hybrid_is_retained_with_the_fields_written_before_its_first_use(self) -> None:
        rt, core = fake_runtime()
        timeline = rt._decode({"$hy": "ChordTimeline", "segments": [1, 2]})
        timeline.segments = [9]
        rt.call("ChordTimeline#at", [timeline, 0])
        assert core.calls[0] == ("$retain", '[{"$hy":"ChordTimeline","segments":[9]}]')
        timeline.segments.append(10)
        rt.call("ChordTimeline#at", [timeline, 0])
        assert core.calls[-1][1] == '[{"$hy":"ChordTimeline","$ref":101},0]'

    def test_a_hybrid_whose_fields_hold_a_function_is_not_retained(self) -> None:
        rt, core = fake_runtime()
        timeline = rt._decode({"$hy": "ChordTimeline", "segments": []})
        timeline.segments = [len]
        rt.call("ChordTimeline#at", [timeline, 0])
        assert core.ops() == ["ChordTimeline#at"]
        assert rt.retained_refs == 0

    def test_a_value_holding_a_callback_is_not_retained(self) -> None:
        rt, core = fake_runtime()
        score = rt._decode({"$class": "Score", "notes": [], "f": {"$cb": 0}})
        rt.call("Score#secondsAt", [score, 0])
        assert core.ops() == ["Score#secondsAt"]

    def test_a_failed_retain_sends_data_and_is_tried_again(self) -> None:
        rt, core = fake_runtime()
        core.retain_status = ErrorCode.BAD_REQUEST
        score = make_score(rt)
        rt.call("Score#secondsAt", [score, 0])
        rt.call("Score#secondsAt", [score, 0])
        assert core.ops() == ["$retain", "Score#secondsAt", "$retain", "Score#secondsAt"]
        assert core.calls[1][1] == '[{"$class":"Score","notes":[0]},0]'
        core.retain_status = 0
        rt.call("Score#secondsAt", [score, 0])
        assert core.calls[-1][1] == '[{"$class":"Score","$ref":101},0]'

    def test_unknown_op_stops_trying(self) -> None:
        rt, core = fake_runtime()
        core.retain_status = ErrorCode.UNKNOWN_OP
        score = make_score(rt)
        for _ in range(3):
            rt.call("Score#secondsAt", [score, 0])
        assert core.ops().count("$retain") == 1
        assert core.ops().count("Score#secondsAt") == 3

    def test_a_result_reference_is_adopted_and_left_out_of_the_data(self) -> None:
        rt, core = fake_runtime()
        core.replies["Arrangement#update"] = b'{"$class":"Arrangement","tracks":[],"$ref":7}'
        arrangement = rt._decode({"$class": "Arrangement", "tracks": []})
        updated = rt.call("Arrangement#update", [arrangement, []])
        assert updated._wire == {"$class": "Arrangement", "tracks": []}
        assert updated._ref == (rt, 7)
        rt.call("Arrangement#analysis", [updated])
        assert core.ops() == ["$retain", "Arrangement#update", "Arrangement#analysis"]
        assert core.calls[-1][1] == '[{"$class":"Arrangement","$ref":7}]'
        assert rt.retained_refs == 2

    def test_dropping_an_instance_releases_its_reference(self) -> None:
        rt, core = fake_runtime()
        score = make_score(rt)
        rt.call("Score#secondsAt", [score, 0])
        assert rt.retained_refs == 1
        del score
        gc.collect()
        assert core.released == [101]
        assert rt.retained_refs == 0

    def test_the_cap_evicts_the_least_recently_used(self) -> None:
        rt, core = fake_runtime(max_refs=2)
        scores = [make_score(rt, n) for n in (1, 2, 3)]
        for score in scores:
            rt.call("Score#secondsAt", [score, 0])
        assert core.released == [101]
        assert rt.retained_refs == 2
        assert scores[0]._ref is None
        rt.call("Score#secondsAt", [scores[0], 0])
        assert core.calls[-1][1] == '[{"$class":"Score","$ref":104},0]'
        assert core.ops()[-2:] == ["$retain", "Score#secondsAt"]
        assert core.released == [101, 102]

    def test_a_recent_use_protects_from_eviction(self) -> None:
        rt, core = fake_runtime(max_refs=2)
        first, second, third = (make_score(rt, n) for n in (1, 2, 3))
        rt.call("Score#secondsAt", [first, 0])
        rt.call("Score#secondsAt", [second, 0])
        rt.call("Score#secondsAt", [first, 0])
        rt.call("Score#secondsAt", [third, 0])
        assert core.released == [102]

    def test_eviction_spares_a_reference_an_enclosing_call_has_sent(self) -> None:
        rt, core = fake_runtime(max_refs=1)
        first, second = make_score(rt, 1), make_score(rt, 2)
        rt.call("Score#secondsAt", [first, 0])
        inside: list[list[int]] = []

        def nested(name: str) -> None:
            if name == "Score#barAt" and not inside:
                rt.call("Score#secondsAt", [second, 0])
                inside.append(list(core.released))

        core.on_call = nested
        rt.call("Score#barAt", [first, 0])
        # The nested call returns over the cap; the one reference it may release is its own.
        assert inside == [[102]]
        assert core.released == [102]
        rt.call("Score#secondsAt", [first, 0])
        assert core.calls[-1][1] == '[{"$class":"Score","$ref":101},0]'

    def test_eviction_runs_at_every_call_exit_while_other_threads_call(self) -> None:
        rt, core = fake_runtime(max_refs=2)
        held = make_score(rt, 1)
        rt.call("Score#secondsAt", [held, 0])
        entered = threading.Event()
        leave = threading.Event()

        def block(name: str) -> None:
            if name == "Score#barAt" and threading.current_thread() is not threading.main_thread():
                entered.set()
                leave.wait(10)

        core.on_call = block
        worker = threading.Thread(target=rt.call, args=("Score#barAt", [held, 0]))
        worker.start()
        try:
            assert entered.wait(10)
            sizes = []
            scores = [make_score(rt, notes) for notes in range(2, 12)]
            for score in scores:
                rt.call("Score#secondsAt", [score, 0])
                sizes.append(rt.retained_refs)
            # The call still running keeps its reference; everything else stays within the cap.
            assert sizes == [2] * 10
            assert held._ref == (rt, 101)
            assert 101 not in core.released
        finally:
            leave.set()
            worker.join()
        assert rt.retained_refs <= 2

    def test_the_loser_of_a_concurrent_retain_releases_its_id(self) -> None:
        rt, core = fake_runtime()
        score = make_score(rt)

        def other_thread_wins(name: str) -> None:
            if name == "$retain":
                core.on_call = None
                rt._adopt(score, 50, 0)

        core.on_call = other_thread_wins
        rt.call("Score#secondsAt", [score, 0])
        assert score._ref == (rt, 50)
        assert core.released == [101]
        rt.call("Score#secondsAt", [score, 0])
        assert core.calls[-1][1] == '[{"$class":"Score","$ref":50},0]'

    def test_copies_and_pickles_carry_no_reference(self) -> None:
        rt, core = fake_runtime()
        score = make_score(rt, 2)
        rt.call("Score#secondsAt", [score, 0])
        assert score._ref == (rt, 101)
        copies = [copy.copy(score), copy.deepcopy(score), pickle.loads(pickle.dumps(score))]
        for duplicate in copies:
            assert type(duplicate) is type(score)
            assert duplicate._ref is None
            assert duplicate._wire == score._wire
            rt.call("$echo", [duplicate])
            assert core.calls[-1][1] == '[{"$class":"Score","notes":[0,1]}]'
        assert copies[1]._wire is not score._wire
        # A copy used as a receiver is retained on its own, and the original keeps its id.
        rt.call("Score#secondsAt", [copies[0], 0])
        assert copies[0]._ref == (rt, 102)
        del score
        gc.collect()
        assert core.released == [101]
        rt.call("Score#secondsAt", [copies[0], 0])
        assert core.calls[-1][1] == '[{"$class":"Score","$ref":102},0]'

    def test_a_copied_hybrid_keeps_its_fields_and_drops_the_reference(self) -> None:
        rt, _ = fake_runtime()
        timeline = rt._decode({"$hy": "ChordTimeline", "segments": [1, 2]})
        rt.call("ChordTimeline#at", [timeline, 0])
        assert timeline._ref == (rt, 101)
        for duplicate in (copy.copy(timeline), copy.deepcopy(timeline)):
            assert duplicate._ref is None
            assert duplicate.segments == [1, 2]

    def test_a_handle_refuses_to_be_copied_or_pickled(self) -> None:
        rt, core = fake_runtime()
        session = rt._decode({"$h": 7, "$type": "ArrangementSession"})
        for duplicate in (copy.copy, copy.deepcopy, pickle.dumps):
            with pytest.raises(TypeError, match="cannot be copied or pickled"):
                duplicate(session)
        assert core.released == []

    def test_a_reference_of_another_runtime_is_not_used(self) -> None:
        rt, _ = fake_runtime()
        other, other_core = fake_runtime()
        score = make_score(rt)
        rt.call("Score#secondsAt", [score, 0])
        other.call("Score#secondsAt", [score, 0])
        assert other_core.ops() == ["Score#secondsAt"]
        assert other_core.calls[0][1] == '[{"$class":"Score","notes":[0]},0]'


class TestStableHandleProperties:
    def handle(self, rt: _codec.Runtime) -> Any:
        return rt._decode({"$h": 7, "$type": "ArrangementSession"})

    def test_a_stable_property_is_read_once(self) -> None:
        rt, core = fake_runtime()
        core.replies["ArrangementSession#tracks"] = b'[{"role":"melody"}]'
        session = self.handle(rt)
        assert session.tracks is session.tracks
        assert core.ops() == ["ArrangementSession#tracks"]
        assert session.tracks == [{"role": "melody"}]

    def test_other_members_still_call_the_core(self) -> None:
        rt, core = fake_runtime()
        session = self.handle(rt)
        session.update([])
        session.update([])
        assert core.ops() == ["ArrangementSession#update"] * 2

    def test_a_released_handle_still_raises(self) -> None:
        rt, core = fake_runtime()
        core.replies["ArrangementSession#tracks"] = b"[]"
        session = self.handle(rt)
        assert session.tracks == []
        session.close()
        with pytest.raises(libcantus.CantusError) as info:
            _ = session.tracks
        assert info.value.code is ErrorCode.RELEASED_HANDLE

    def test_a_failed_read_is_not_cached(self) -> None:
        rt, core = fake_runtime()
        core.replies["ArrangementSession#analysis"] = b"[1]"
        session = self.handle(rt)
        original = core.transport
        failing = [True]

        def transport(op: bytes, body: bytes, cb: Any) -> tuple[int, bytes]:
            if failing[0]:
                failing[0] = False
                return ErrorCode.INTERNAL, b'{"code":"INTERNAL","message":"boom"}'
            return original(op, body, cb)

        rt._transport = transport
        with pytest.raises(libcantus.CantusError):
            _ = session.analysis
        assert session.analysis == [1]


class TestRetainedWithTheCore:
    """The same behaviour against the native library."""

    NOTES: ClassVar[list[dict[str, int]]] = [
        {"pitch": p, "startBeat": 0, "durationBeat": 4} for p in (60, 64, 67)
    ]

    @pytest.fixture
    def recorded(self, monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
        calls: list[tuple[str, str]] = []

        def transport(op: bytes, body: bytes, cb: Any) -> tuple[int, bytes]:
            calls.append((op.decode(), body.decode("ascii")))
            return _ffi.call(op, body, cb)

        monkeypatch.setattr(runtime, "_transport", transport)
        return calls

    def test_a_retained_score_answers_like_its_data(self, recorded: list[tuple[str, str]]) -> None:
        score = libcantus.Score.of(self.NOTES)
        first = score.seconds_at(1.5)
        second = score.seconds_at(1.5)
        assert first == second
        assert [op for op, _ in recorded] == [
            "Score.of",
            "$retain",
            "Score#secondsAt",
            "Score#secondsAt",
        ]
        assert recorded[3][1].startswith('[{"$class":"Score","$ref":')
        assert "notes" not in recorded[3][1]

    def test_the_live_count_follows_the_instance(self) -> None:
        before = live()
        score = libcantus.Score.of(self.NOTES)
        score.seconds_at(0)
        assert live() == before + 1
        del score
        gc.collect()
        assert live() == before

    def test_the_cap_evicts_and_the_evicted_instance_still_answers(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(runtime, "_max_refs", 2)
        before = live()
        scores = [libcantus.Score.of(self.NOTES) for _ in range(4)]
        answers = [score.seconds_at(1.5) for score in scores]
        assert live() == before + 2
        assert scores[0].seconds_at(1.5) == answers[0]
        assert live() == before + 2

    def test_threads_share_retained_values_and_agree_with_the_plain_path(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        notes = [
            {"pitch": 48 + i % 24, "startBeat": i * 0.5, "durationBeat": 0.5} for i in range(200)
        ]
        lead = [{"pitch": 72 + i % 5, "startBeat": i, "durationBeat": 1} for i in range(16)]
        tracks = [
            {"name": "keys", "role": "harmony", "notes": notes[:64]},
            {"name": "lead", "role": "melody", "notes": lead},
        ]

        def edit(pitch: int) -> list[dict[str, Any]]:
            moved = [dict(n, pitch=pitch) if i == 3 else n for i, n in enumerate(lead)]
            return [{"trackIndex": 1, "notes": moved}]

        beats = [i * 2.5 for i in range(20)]
        pitches = [70, 71, 73, 74]
        with monkeypatch.context() as plain:
            plain.setattr(runtime, "_by_reference", frozenset())
            plain_score = libcantus.Score.of(notes)
            seconds = [plain_score.seconds_at(b) for b in beats]
            bars = [plain_score.bar_at(b) for b in beats]
            base = libcantus.Arrangement.of(tracks)
            conflicts = {p: base.update(edit(p)).conflicts for p in pitches}
            again = {p: base.update(edit(p)).update(edit(pitches[0])).tracks for p in pitches}
        del plain_score, base
        gc.collect()

        monkeypatch.setattr(runtime, "_max_refs", 2)
        before = live()
        score = libcantus.Score.of(notes)
        arrangement = libcantus.Arrangement.of(tracks)
        errors: list[str] = []

        def work(t: int, score: Any, arrangement: Any) -> None:
            try:
                for round in range(4):
                    for i, b in enumerate(beats):
                        if score.seconds_at(b) != seconds[i] or score.bar_at(b) != bars[i]:
                            errors.append(f"score {t} {i}")
                    pitch = pitches[(t + round) % len(pitches)]
                    updated = arrangement.update(edit(pitch))
                    if updated.conflicts != conflicts[pitch]:
                        errors.append(f"conflicts {t} {pitch}")
                    if updated.update(edit(pitches[0])).tracks != again[pitch]:
                        errors.append(f"chain {t} {pitch}")
            except BaseException as error:
                errors.append(repr(error))

        threads = [threading.Thread(target=work, args=(t, score, arrangement)) for t in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert errors == []
        assert runtime.retained_refs <= 2
        del score, arrangement
        gc.collect()
        assert live() == before

    def test_a_raw_request_naming_one_value_many_times(self) -> None:
        score = libcantus.Score.of(
            [{"pitch": 40 + i % 40, "startBeat": i, "durationBeat": 1} for i in range(2000)]
        )
        beats = score.total_beats
        ref = score._ref
        assert ref is not None
        tag = f'{{"$class":"Score","$ref":{ref[1]}}}'
        status, body = _ffi.call(
            b"Score#totalBeats", f"[{tag},[{','.join([tag] * 20000)}]]".encode()
        )
        assert status == 0
        assert json.loads(body) == beats

    def test_core_errors_for_bad_references(self) -> None:
        score = libcantus.Score.of(self.NOTES)
        score.seconds_at(0)
        ref = score._ref
        assert ref is not None

        def message(op: bytes, arg: str) -> str:
            status, body = _ffi.call(op, f"[{arg},1]".encode())
            assert status != 0
            return str(json.loads(body)["message"])

        assert message(b"Score#secondsAt", '{"$class":"Score","$ref":999999}') == (
            "unknown handle 999999"
        )
        assert message(b"Score#secondsAt", f'{{"$class":"Score","$ref":{ref[1]},"notes":[]}}') == (
            'malformed "$class" tag'
        )
        assert message(b"Timeline#at", f'{{"$class":"Timeline","$ref":{ref[1]}}}') == (
            'expected a "Timeline" instance'
        )
