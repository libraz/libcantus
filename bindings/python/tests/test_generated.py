"""The generated surface: names, signatures, option handling and constants."""

from __future__ import annotations

import inspect
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

import libcantus
from libcantus import _codec, _generated

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = json.loads((ROOT / "api/manifest.json").read_text(encoding="utf-8"))


def snake(name: str) -> str:
    s = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s).lower()


ANNOTATIONS = json.loads((ROOT / "api/annotations.json").read_text(encoding="utf-8"))


def exports(kind: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = [e for e in MANIFEST["exports"] if e["kind"] == kind]
    assert found
    return found


def test_every_function_is_exported() -> None:
    local = {e["id"] for e in ANNOTATIONS["facade_local"]}
    for entry in (e for e in exports("function") if e["id"] not in local):
        function = getattr(libcantus, snake(entry["id"]))
        assert callable(function)
        assert function.__name__ == snake(entry["id"])


def test_every_class_and_type_is_exported() -> None:
    for entry in exports("class"):
        assert inspect.isclass(getattr(libcantus, entry["id"]))
    for entry in MANIFEST["types"]:
        assert inspect.isclass(getattr(libcantus, entry["id"]))


def test_exported_name_count() -> None:
    local = {e["id"] for e in ANNOTATIONS["facade_local"]}
    functions = [e for e in exports("function") if e["id"] not in local]
    expected = len(functions) + len(exports("class")) + len(MANIFEST["types"])
    assert len(_generated.__all__) == expected
    assert {e["id"] for e in [*exports("const"), *exports("enum")]} == _generated.CONSTANTS


def test_errors_are_the_library_classes() -> None:
    for entry in exports("error"):
        assert issubclass(getattr(libcantus, entry["id"]), libcantus.CantusError)


def test_options_are_keyword_only_and_default_to_none() -> None:
    signature = inspect.signature(libcantus.analyze_arrangement)
    parameters = list(signature.parameters.values())
    assert parameters[0].kind is inspect.Parameter.POSITIONAL_ONLY
    options = parameters[1:]
    assert len(options) == 11
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY and p.default is None for p in options)
    assert {p.name for p in options} >= {"min_severity", "harmonic_rhythm", "pickup_beats"}


def test_unknown_keyword_is_a_type_error() -> None:
    with pytest.raises(TypeError):
        libcantus.analyze_arrangement([], nope=1)  # type: ignore[call-arg]


def test_options_reach_the_core_under_their_wire_names(stub_replies: list[tuple[str, str]]) -> None:
    libcantus.analyze_arrangement([1], min_severity=2, harmonic_rhythm=None, pickup_beats=0)
    assert stub_replies == [("analyzeArrangement", '[[1],{"minSeverity":2,"pickupBeats":0}]')]


def test_no_options_means_no_bag(stub_replies: list[tuple[str, str]]) -> None:
    libcantus.analyze_arrangement([1])
    assert stub_replies == [("analyzeArrangement", "[[1]]")]


def test_optional_positionals_default_to_unset() -> None:
    optional = [
        p
        for entry in exports("function")
        if entry["id"] not in {e["id"] for e in ANNOTATIONS["facade_local"]}
        for p in inspect.signature(getattr(libcantus, snake(entry["id"]))).parameters.values()
        if p.kind is inspect.Parameter.POSITIONAL_ONLY and p.default is not inspect.Parameter.empty
    ]
    assert optional
    assert all(p.default is libcantus.UNSET for p in optional)


def test_python_keywords_get_a_trailing_underscore() -> None:
    assert callable(libcantus.Composer.with_)


def test_class_methods_getters_and_statics(stub_replies: list[tuple[str, str]]) -> None:
    assert isinstance(inspect.getattr_static(libcantus.Chord, "from_data"), staticmethod)
    assert isinstance(inspect.getattr_static(libcantus.Voicing, "satb_ranges"), _codec.StaticGetter)
    chord = libcantus.Chord.__new__(libcantus.Chord)
    chord._wire = {"$class": "Chord", "root": 0}
    chord.transpose(2)
    assert stub_replies == [("Chord#transpose", '[{"$class":"Chord","root":0},2]')]


def test_constructor_adopts_the_class_node(monkeypatch: pytest.MonkeyPatch) -> None:
    node = {"$class": "Chord", "root": 1}

    def transport(op: bytes, body: bytes, _cb: Any) -> tuple[int, bytes]:
        assert op == b"Chord.constructor"
        assert json.loads(body) == [{"root": 1}]
        return 0, json.dumps(node).encode()

    monkeypatch.setattr(_codec.runtime, "_transport", transport)
    assert libcantus.Chord({"root": 1})._wire == node


def test_iterable_classes_iterate_their_getter(monkeypatch: pytest.MonkeyPatch) -> None:
    ops: list[str] = []

    def transport(op: bytes, _body: bytes, _cb: Any) -> tuple[int, bytes]:
        ops.append(op.decode())
        return 0, b"[1,2]"

    monkeypatch.setattr(_codec.runtime, "_transport", transport)
    progression = libcantus.Progression.__new__(libcantus.Progression)
    progression._wire = {"$class": "Progression"}
    assert list(progression) == [1, 2]
    assert ops == ["Progression#chords"]


def test_constants_are_read_on_first_access(monkeypatch: pytest.MonkeyPatch) -> None:
    ops: list[str] = []

    def transport(op: bytes, _body: bytes, _cb: Any) -> tuple[int, bytes]:
        ops.append(op.decode())
        return 0, b"4"

    monkeypatch.setattr(_codec.runtime, "_transport", transport)
    monkeypatch.setattr(_generated, "_constants", {})
    assert libcantus.ALGORITHM_VERSION == 4
    assert libcantus.ALGORITHM_VERSION == 4
    assert ops == ["$const:ALGORITHM_VERSION"]
    with pytest.raises(AttributeError):
        libcantus.NOT_A_CONSTANT  # noqa: B018


def test_importing_needs_no_library() -> None:
    env = {**os.environ, "CANTUS_LIB": str(ROOT / "no-such-library")}
    result = subprocess.run(
        [sys.executable, "-c", "import libcantus"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
