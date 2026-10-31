"""Option bags and constructors of the generated surface follow the manifest."""

from __future__ import annotations

import inspect
import json
import keyword
import re
from pathlib import Path
from typing import Any

import pytest

import libcantus

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = json.loads((ROOT / "api/manifest.json").read_text(encoding="utf-8"))
LOCAL = {
    e["id"]
    for e in json.loads((ROOT / "api/annotations.json").read_text(encoding="utf-8"))["facade_local"]
}
PARAMETER = inspect.Parameter


def snake(name: str) -> str:
    s = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s).lower()
    return f"{s}_" if keyword.iskeyword(s) or s in {"match", "case", "type"} else s


def callables() -> list[tuple[str, Any, list[dict[str, Any]]]]:
    """Every generated function and method with its manifest parameters."""
    found: list[tuple[str, Any, list[dict[str, Any]]]] = []
    for e in MANIFEST["exports"]:
        if e["kind"] == "function" and e["id"] not in LOCAL:
            found.append((e["id"], getattr(libcantus, snake(e["id"]), None), e["params"]))
        if e["kind"] == "class":
            for m in e["members"]:
                if m["kind"] == "method":
                    found.append(
                        (f"{e['id']}.{m['name']}", getattr(libcantus, e["id"]), m["params"])
                    )
    for t in MANIFEST["types"]:
        for m in t["members"]:
            if m["kind"] == "method":
                found.append((f"{t['id']}.{m['name']}", getattr(libcantus, t["id"]), m["params"]))
    return found


def resolve(label: str, owner: Any) -> Any:
    if "." not in label:
        return owner
    return getattr(owner, snake(label.split(".", 1)[1]))


def test_every_marked_bag_is_keyword_only_and_every_other_parameter_positional() -> None:
    checked = 0
    for label, owner, params in callables():
        function = resolve(label, owner)
        signature = inspect.signature(function)
        names = {p.name for p in signature.parameters.values()}
        for param in params:
            if param.get("bag"):
                checked += 1
                fields = {snake(f) for f in param["bag"]}
                keyword_only = {
                    p.name
                    for p in signature.parameters.values()
                    if p.kind is PARAMETER.KEYWORD_ONLY
                }
                assert keyword_only == fields, label
                assert param["name"] not in names, label
            elif not param["rest"]:
                assert snake(param["name"]) in names, label
    assert checked > 100


def test_required_option_dicts_stay_positional() -> None:
    for name in ("resolve_meters", "generate_progression"):
        first = next(iter(inspect.signature(getattr(libcantus, name)).parameters.values()))
        assert first.kind is PARAMETER.POSITIONAL_ONLY
        assert first.name in {"opts", "options", "ts"}


def test_intersection_options_are_keyword_only() -> None:
    parameters = inspect.signature(libcantus.format_chord_symbol).parameters
    assert {"system", "flats"} <= {
        n for n, p in parameters.items() if p.kind is PARAMETER.KEYWORD_ONLY
    }


def test_a_bag_before_other_parameters_is_packed_in_place(
    stub_replies: list[tuple[str, str]],
) -> None:
    rhythm = libcantus.Rhythm.__new__(libcantus.Rhythm)
    rhythm._wire = {"$class": "Rhythm", "steps": 1}
    receiver = '{"$class":"Rhythm","steps":1}'
    rhythm.deform(rate=0.5)
    rhythm.deform({"seed": 1}, rate=0.5)
    rhythm.deform()
    assert stub_replies == [
        ("Rhythm#deform", f'[{receiver},{{"rate":0.5}}]'),
        ("Rhythm#deform", f'[{receiver},{{"rate":0.5}},{{"seed":1}}]'),
        ("Rhythm#deform", f"[{receiver}]"),
    ]


def test_a_missing_option_before_a_given_parameter_crosses_as_absent(
    stub_replies: list[tuple[str, str]],
) -> None:
    rhythm = libcantus.Rhythm.__new__(libcantus.Rhythm)
    rhythm._wire = {"$class": "Rhythm", "steps": 1}
    rhythm.deform({"seed": 1})
    assert stub_replies == [
        ("Rhythm#deform", '[{"$class":"Rhythm","steps":1},{"$u":1},{"seed":1}]')
    ]


def test_constructors_exist_only_where_an_op_is_registered() -> None:
    ops = {entry["name"] for entry in libcantus.list_ops()}
    for e in MANIFEST["exports"]:
        if e["kind"] != "class":
            continue
        cls = getattr(libcantus, e["id"])
        if e["constructor"].get("private"):
            assert f"{e['id']}.constructor" not in ops
            with pytest.raises(TypeError, match=rf"{e['id']}\.\w+"):
                cls()
        else:
            assert f"{e['id']}.constructor" in ops
