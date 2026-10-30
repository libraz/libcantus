"""The Python side of the op boundary: argument encoding, result decoding and callback frames.

Every value crosses as wire JSON. A decoded model-class instance or hybrid keeps the wire node it
arrived as, so passing it back re-sends exactly what the core produced. Python has no ``undefined``:
``None`` is JSON ``null`` wherever it is a positional argument or sits inside a list or dict, the
keyword options treat ``None`` as absent, and ``UNSET`` stands for an absent optional positional
argument (a list element that is ``UNSET`` crosses as ``{"$u": 1}``, a dict value is left out).
Results turn ``{"$u": 1}`` into ``None``.

An instance of a by-reference type (``Runtime.by_reference``) is retained in the core on its first
use as a receiver (``$retain``); later calls send ``{"$class": T, "$ref": id}`` instead of its data
(a hybrid only as the receiver of its own methods). The reference is released when the instance is
collected, and at most ``MAX_LIVE_REFS`` are live per runtime: whenever a call returns, the least
recently used beyond the cap are released, except those a call still running has sent. An evicted
instance sends its data and is retained again on its next use as a receiver. The reference belongs
to the one instance: a copy or an unpickled instance sends its data until it is retained itself.
"""

from __future__ import annotations

import contextlib
import ctypes
import json
import math
import threading
import weakref
from collections.abc import Callable, Mapping, Sequence
from typing import Any, ClassVar, TypeVar

from . import _ffi
from ._errors import (
    BudgetExceededError,
    CantusError,
    ErrorCode,
    InvalidInputError,
    NoSolutionError,
    error_from_reply,
)

# One call of the C ABI: (op, args_json, callback) -> (status, output_json).
Transport = Callable[[bytes, bytes, Any], tuple[int, bytes]]

_H = TypeVar("_H", bound="Handle")

# The most references to retained values one runtime holds at a time.
MAX_LIVE_REFS = 1024


class _Unset:
    """Type of ``UNSET``."""

    def __repr__(self) -> str:
        return "UNSET"

    def __bool__(self) -> bool:
        return False


UNSET: Any = _Unset()


def _without_ref(instance: Model | Hybrid) -> dict[str, Any]:
    """The state a copy or a pickle of ``instance`` carries: everything but its reference."""
    return {k: v for k, v in instance.__dict__.items() if k != "_ref"}


class Model:
    """A model-class instance: an immutable value that keeps the wire node it came from."""

    _wire: dict[str, Any]
    # The runtime and id of the core's retained copy of this value, once it has one.
    _ref: tuple[Runtime, int] | None = None

    def __getstate__(self) -> dict[str, Any]:
        return _without_ref(self)

    def __repr__(self) -> str:
        return f"{type(self).__name__}({json.dumps(self._wire, ensure_ascii=True)})"


class Hybrid:
    """A value whose data fields are plain attributes and whose methods are ops."""

    _wire: dict[str, Any]
    _ref: tuple[Runtime, int] | None = None
    # (wire field name, attribute name) of every data member, in declaration order.
    _FIELDS: ClassVar[tuple[tuple[str, str], ...]] = ()

    def __getstate__(self) -> dict[str, Any]:
        return _without_ref(self)

    def __repr__(self) -> str:
        return f"{type(self).__name__}({json.dumps(self._wire, ensure_ascii=True)})"


class StaticGetter:
    """A class-level getter: reading it from the class (or an instance) runs its op."""

    def __init__(self, op: str) -> None:
        self._op = op

    def __get__(self, instance: object, owner: type | None = None) -> Any:
        return runtime.call(self._op, [])


def _read_only(*names: str) -> Callable[[type], type]:
    """Class decorator: make the named mutators raise ``TypeError``."""

    def refuse(self: object, *args: object, **kwargs: object) -> None:
        raise TypeError(f"{type(self).__name__} is read-only")

    def decorate(cls: type) -> type:
        for name in names:
            setattr(cls, name, refuse)
        return cls

    return decorate


@_read_only(
    "__setitem__", "__delitem__", "__ior__", "clear", "pop", "popitem", "setdefault", "update"
)
class FrozenDict(dict[str, Any]):
    """A dict that refuses writes, for values shared between calls."""


@_read_only(
    "__setitem__", "__delitem__", "__iadd__", "__imul__", "append", "clear", "extend", "insert",
    "pop", "remove", "reverse", "sort",
)  # fmt: skip
class FrozenList(list[Any]):
    """A list that refuses writes, for values shared between calls."""


def freeze(value: Any) -> Any:
    """``value`` with every list and dict inside it made read-only."""
    if isinstance(value, list):
        return FrozenList(freeze(item) for item in value)
    if isinstance(value, dict):
        return FrozenDict({k: freeze(v) for k, v in value.items()})
    return value


class Identified(FrozenDict):
    """A handle getter's result: read-only; one token yields one object while it is alive."""


class Handle:
    """State held by the core. Release it with ``close()``, a ``with`` block or by dropping it."""

    _TYPE: ClassVar[str] = ""

    _id: int
    _closed: bool
    _lock: Any
    _runtime: Runtime
    _cache: dict[str, Any]

    @property
    def closed(self) -> bool:
        """Whether the handle has been released."""
        return self._closed

    def close(self) -> None:
        """Release the handle now; later calls on it raise ``CantusError`` (RELEASED_HANDLE)."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._cache.clear()
            self._runtime.forget(self._id)

    def __enter__(self: _H) -> _H:
        return self

    def __reduce_ex__(self, protocol: Any) -> Any:
        # A copy would share the core state and release it under the original.
        raise TypeError(f"a {type(self).__name__} handle cannot be copied or pickled")

    def __exit__(self, *exc: object) -> None:
        self.close()

    def __del__(self) -> None:
        # Interpreter shutdown may have torn the library down already.
        with contextlib.suppress(Exception):
            self.close()

    def _call(self, op: str, args: Sequence[Any], bag: Mapping[str, Any] | None = None) -> Any:
        with self._lock:
            return self._runtime.call(op, args, bag)

    def _stable(self, name: str, op: str) -> Any:
        """A property that never changes while the handle lives: read once, then kept."""
        with self._lock:
            # A released handle goes to the core, which refuses it.
            if self._closed:
                return self._runtime.call(op, [self])
            if name not in self._cache:
                self._cache[name] = freeze(self._runtime.call(op, [self]))
            return self._cache[name]

    def __repr__(self) -> str:
        return f"{type(self).__name__}(id={self._id}{', closed' if self._closed else ''})"


class _Counter(Handle):
    """The ``$counter`` builtin handle, used to test the boundary."""

    _TYPE = "$counter"

    def next(self) -> Any:
        """Advance the counter and return its new value."""
        return self._call("$counter#next", [self])

    @property
    def value(self) -> Any:
        """The counter state, as an identity-tagged object."""
        return self._call("$counter#value", [self])


class _Frame:
    """The callbacks of one call, and the first exception one of them raised."""

    def __init__(self) -> None:
        self.fns: list[Callable[..., Any]] = []
        self.error: BaseException | None = None
        self.keep: list[Any] = []
        # The reference ids this call sent, held from eviction until it returns.
        self.pins: list[int] = []


_ERROR_CLASSES: dict[str, Callable[[Mapping[str, Any]], Exception]] = {
    "InvalidInputError": lambda w: InvalidInputError(str(w.get("message"))),
    "NoSolutionError": lambda w: NoSolutionError(
        str(w.get("message")), w["at"] if isinstance(w.get("at"), int) else None
    ),
    "BudgetExceededError": lambda w: BudgetExceededError(str(w.get("message"))),
}


def _is_tag(key: str) -> bool:
    return key.startswith("$") and not key.startswith("$$")


def _escape(key: str) -> str:
    return "$" + key if key.startswith("$") else key


def _unescape(key: str) -> str:
    return key[1:] if key.startswith("$$") else key


def _dumps(wire: Any) -> bytes:
    return json.dumps(wire, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode(
        "ascii"
    )


def _bad_request(message: str) -> CantusError:
    return CantusError(message, ErrorCode.BAD_REQUEST)


class Runtime:
    """Encodes arguments, calls the transport and decodes the result."""

    def __init__(self, transport: Transport, release: Callable[[int], None]) -> None:
        self._transport = transport
        self._release = release
        self._models: dict[str, type[Model]] = {}
        self._hybrids: dict[str, type[Hybrid]] = {}
        self._handle_types: dict[str, type[Handle]] = {_Counter._TYPE: _Counter}
        self._handles: weakref.WeakValueDictionary[int, Handle] = weakref.WeakValueDictionary()
        self._identities: weakref.WeakValueDictionary[int, Identified] = (
            weakref.WeakValueDictionary()
        )
        self._by_reference: frozenset[str] = frozenset()
        self._max_refs = MAX_LIVE_REFS
        self._retain_unsupported = False
        self._lock = threading.RLock()
        # Retained values by reference id, least recently used first.
        self._live: dict[int, tuple[weakref.ref[Model | Hybrid], Any]] = {}
        # How many calls still running have sent each reference id.
        self._pins: dict[int, int] = {}

    def register(self, *types: type) -> None:
        """Make results naming these classes decode to them."""
        for cls in types:
            if issubclass(cls, Model):
                self._models[cls.__name__] = cls
            elif issubclass(cls, Hybrid):
                self._hybrids[cls.__name__] = cls
            elif issubclass(cls, Handle):
                self._handle_types[cls._TYPE] = cls
            else:
                raise TypeError(f"{cls!r} is not a model, hybrid or handle class")

    def by_reference(self, *names: str) -> None:
        """Retain instances of these classes and hybrids in the core on their first use."""
        self._by_reference = frozenset(names)

    @property
    def retained_refs(self) -> int:
        """How many retained values the runtime holds a reference to."""
        return len(self._live)

    def forget(self, handle_id: int) -> None:
        """Drop a handle from the live table and release it in the core."""
        self._handles.pop(handle_id, None)
        self._release(handle_id)

    def call(self, op: str, args: Sequence[Any], bag: Mapping[str, Any] | None = None) -> Any:
        """Run op ``op`` and return its decoded result.

        Args:
            op: The op name.
            args: The positional arguments; trailing ``UNSET`` ones are left out.
            bag: The keyword options as ``{wire name: value}``; ``None`` values are absent.
        """
        try:
            self._retain_receiver(op, args)
            frame = _Frame()
            return self._decode(self._run(op, args, bag, frame), frame.fns)
        finally:
            self._evict()

    def construct(
        self, target: Model, op: str, args: Sequence[Any], bag: Mapping[str, Any] | None = None
    ) -> None:
        """Run a constructor op and attach the ``$class`` node it returns to ``target``."""
        try:
            wire = self._run(op, args, bag)
        finally:
            self._evict()
        if not isinstance(wire, dict) or "$class" not in wire:
            raise CantusError(f"{op} did not return a class instance", ErrorCode.INTERNAL)
        target._wire = wire

    def _touch(self, ref_id: int) -> None:
        with self._lock:
            entry = self._live.pop(ref_id, None)
            if entry is not None:
                self._live[ref_id] = entry

    def _adopt(self, instance: Model | Hybrid, ref_id: int) -> None:
        """Record that the core holds ``instance``'s value under ``ref_id`` while it lives."""
        with self._lock:
            if instance._ref is not None:
                # Another thread retained it first: this id has no owner.
                self._release(ref_id)
                return
            finalizer = weakref.finalize(instance, self._drop_ref, ref_id)
            finalizer.atexit = False
            self._live[ref_id] = (weakref.ref(instance), finalizer)
            instance._ref = (self, ref_id)

    def _drop_ref(self, ref_id: int) -> None:
        """The finalizer of a retained instance: release its reference."""
        with self._lock:
            if self._live.pop(ref_id, None) is None:
                return
        self._release(ref_id)

    def _evict(self) -> None:
        """Release the least recently used references beyond the cap that no running call sent."""
        with self._lock:
            excess = len(self._live) - self._max_refs
            if excess <= 0:
                return
            doomed = [ref_id for ref_id in self._live if ref_id not in self._pins][:excess]
            for ref_id in doomed:
                weak, finalizer = self._live.pop(ref_id)
                finalizer.detach()
                instance = weak()
                if instance is not None:
                    instance._ref = None
                self._release(ref_id)

    def _send_ref(self, value: Model | Hybrid, frame: _Frame) -> int | None:
        """The reference id to send for ``value``, held by ``frame`` until its call returns."""
        with self._lock:
            ref = value._ref
            if ref is None or ref[0] is not self:
                return None
            ref_id = ref[1]
            self._touch(ref_id)
            self._pins[ref_id] = self._pins.get(ref_id, 0) + 1
            frame.pins.append(ref_id)
            return ref_id

    def _unpin(self, frame: _Frame) -> None:
        with self._lock:
            for ref_id in frame.pins:
                left = self._pins[ref_id] - 1
                if left > 0:
                    self._pins[ref_id] = left
                else:
                    del self._pins[ref_id]
            frame.pins.clear()

    def _retain_receiver(self, op: str, args: Sequence[Any]) -> None:
        """Retain the receiver of a ``Type#member`` op the first time it is used.

        A refusal is left to the op itself, which fails the same way.
        """
        hash_at = op.find("#")
        if hash_at <= 0 or self._retain_unsupported or not args:
            return
        type_name = op[:hash_at]
        value = args[0]
        if type_name not in self._by_reference or not isinstance(value, (Model, Hybrid)):
            return
        ref = value._ref
        if ref is not None:
            if ref[0] is self:
                self._touch(ref[1])
            return
        wire = value._wire
        if (wire.get("$class") or wire.get("$hy")) != type_name:
            return
        text = _dumps([wire])
        if b'"$cb"' in text:
            return
        status, body = self._transport(b"$retain", text, None)
        if status == ErrorCode.UNKNOWN_OP:
            self._retain_unsupported = True
        if status != 0:
            return
        reply = json.loads(body.decode("utf-8", "surrogatepass"))
        ref_id = reply.get("$ref") if isinstance(reply, dict) else None
        if isinstance(ref_id, int):
            self._adopt(value, ref_id)

    def _hybrid_receiver(self, op: str, value: Any, frame: _Frame) -> dict[str, Any] | None:
        """``{"$hy": T, "$ref": id}`` for a retained hybrid receiving one of its own methods."""
        if not isinstance(value, Hybrid):
            return None
        name = str(value._wire.get("$hy"))
        if not op.startswith(f"{name}#"):
            return None
        ref_id = self._send_ref(value, frame)
        return None if ref_id is None else {"$hy": name, "$ref": ref_id}

    def _run(
        self,
        op: str,
        args: Sequence[Any],
        bag: Mapping[str, Any] | None,
        frame: _Frame | None = None,
    ) -> Any:
        frame = _Frame() if frame is None else frame
        items = list(args)
        if bag is not None:
            options = {k: v for k, v in bag.items() if v is not None}
            if options:
                items.append(options)
        while items and items[-1] is UNSET:
            items.pop()
        try:
            wire: list[Any] = []
            for index, item in enumerate(items):
                receiver = self._hybrid_receiver(op, item, frame) if index == 0 else None
                wire.append(receiver or self._encode(item, frame, ()))
            text = _dumps(wire)
            callback = self._host(frame) if frame.fns else None
            status, body = self._transport(op.encode("utf-8", "surrogatepass"), text, callback)
        finally:
            self._unpin(frame)
        if status == 0:
            return json.loads(body.decode("utf-8", "surrogatepass"))
        if status == ErrorCode.CALLBACK_FAILED and frame.error is not None:
            raise frame.error
        raise error_from_reply(status, body)

    def _host(self, frame: _Frame) -> Any:
        def host(
            _ctx: int | None,
            callback_id: int,
            args_ptr: int | None,
            args_len: int,
            out_ptr: Any,
            out_len: Any,
        ) -> int:
            try:
                raw = ctypes.string_at(args_ptr, args_len) if args_ptr and args_len else b"[]"
                values = [self._decode(v) for v in json.loads(raw.decode("utf-8", "surrogatepass"))]
                data = _dumps(self._encode(frame.fns[callback_id](*values), frame, ()))
            except BaseException as error:  # noqa: BLE001 - re-raised by the enclosing call
                if frame.error is None:
                    frame.error = error
                return 1
            buffer = ctypes.create_string_buffer(data, len(data))
            frame.keep.append(buffer)
            out_ptr[0] = ctypes.addressof(buffer)
            out_len[0] = len(data)
            return 0

        return _ffi.CallbackFn(host)

    def _encode(self, value: Any, frame: _Frame, stack: tuple[int, ...]) -> Any:
        if value is None or isinstance(value, (bool, str)):
            return value
        if value is UNSET:
            return {"$u": 1}
        if isinstance(value, int):
            return int(value)
        if isinstance(value, float):
            return _encode_float(float(value))
        if isinstance(value, Model):
            ref_id = self._send_ref(value, frame)
            if ref_id is not None:
                return {"$class": value._wire["$class"], "$ref": ref_id}
            return value._wire
        if isinstance(value, Handle):
            return {"$h": value._id, "$type": value._TYPE}
        if isinstance(value, Hybrid):
            return self._encode_hybrid(value, frame)
        if callable(value):
            frame.fns.append(value)
            return {"$cb": len(frame.fns) - 1}
        if id(value) in stack:
            # JSON holds no cycle: the repeat is cut to an empty container.
            return [] if isinstance(value, (list, tuple)) else {}
        inner = (*stack, id(value))
        if isinstance(value, (list, tuple)):
            return [self._encode(item, frame, inner) for item in value]
        if isinstance(value, Mapping):
            out: dict[str, Any] = {}
            for key, field in value.items():
                if not isinstance(key, str):
                    raise TypeError(f"object keys must be strings, not {type(key).__name__}")
                if field is not UNSET:
                    out[_escape(key)] = self._encode(field, frame, inner)
            return out
        methods = {
            name: attr
            for name in dir(value)
            if not name.startswith("_") and callable(attr := getattr(value, name, None))
        }
        if methods:
            # An instance of a user class stands for the methods it offers, like a dict of them.
            return self._encode(methods, frame, inner)
        raise TypeError(f"cannot pass a {type(value).__name__} to libcantus")

    def _encode_hybrid(self, obj: Hybrid, frame: _Frame) -> dict[str, Any]:
        # A caller may have written to a data field after decoding, so those are re-read.
        visible = dict(obj._FIELDS)
        out: dict[str, Any] = {}
        for key, node in obj._wire.items():
            name = None if _is_tag(key) else visible.get(_unescape(key))
            out[key] = node if name is None else self._encode(getattr(obj, name), frame, ())
        return out

    def _decode(self, node: Any, fns: Sequence[Callable[..., Any]] = ()) -> Any:
        if isinstance(node, list):
            return [self._decode(item, fns) for item in node]
        if isinstance(node, dict):
            for key in node:
                if _is_tag(key):
                    return self._decode_tag(node, key, fns)
            return {_unescape(k): self._decode(v, fns) for k, v in node.items()}
        return node

    def _decode_tag(self, node: dict[str, Any], key: str, fns: Sequence[Callable[..., Any]]) -> Any:
        if "$n" in node:
            return {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}.get(
                node["$n"], -0.0
            )
        if "$u" in node:
            return None
        if "$big" in node:
            return int(node["$big"])
        if "$sym" in node:
            return str(node["$sym"])
        if "$tojson" in node:
            return self._decode(node["$tojson"], fns)
        if "$class" in node:
            return self._decode_class(node)
        if "$hy" in node:
            return self._decode_hybrid(node, fns)
        if "$h" in node:
            return self._decode_handle(node)
        if "$id" in node:
            return self._decode_identity(node, fns)
        # A result echoing a callback argument hands back the caller's own function.
        callback_id = node.get("$cb")
        if isinstance(callback_id, int) and 0 <= callback_id < len(fns):
            return fns[callback_id]
        raise _bad_request(f"unexpected wire tag {json.dumps(key)} in a result")

    def _decode_class(self, node: dict[str, Any]) -> Any:
        name = str(node["$class"])
        error = _ERROR_CLASSES.get(name)
        if error is not None:
            return error(node)
        cls = self._models.get(name)
        if cls is None:
            raise _bad_request(f"unknown class {json.dumps(name)} in a result")
        instance = cls.__new__(cls)
        # A ``$ref`` beside the data is the core's retained copy of this very value.
        ref_id = node.get("$ref")
        if isinstance(ref_id, int):
            instance._wire = {k: v for k, v in node.items() if k != "$ref"}
            self._adopt(instance, ref_id)
        else:
            instance._wire = node
        return instance

    def _decode_hybrid(self, node: dict[str, Any], fns: Sequence[Callable[..., Any]] = ()) -> Any:
        name = str(node["$hy"])
        cls = self._hybrids.get(name)
        if cls is None:
            raise _bad_request(f"unknown hybrid type {json.dumps(name)} in a result")
        instance = cls.__new__(cls)
        instance._wire = node
        for wire_name, attr in cls._FIELDS:
            field = node.get(_escape(wire_name))
            setattr(instance, attr, None if field is None else self._decode(field, fns))
        return instance

    def _decode_handle(self, node: dict[str, Any]) -> Any:
        handle_id = int(node["$h"])
        live = self._handles.get(handle_id)
        if live is not None:
            return live
        type_name = str(node.get("$type"))
        cls = self._handle_types.get(type_name)
        if cls is None:
            raise _bad_request(f"unknown handle type {json.dumps(type_name)} in a result")
        handle = cls.__new__(cls)
        handle._id = handle_id
        handle._closed = False
        handle._lock = threading.RLock()
        handle._runtime = self
        handle._cache = {}
        self._handles[handle_id] = handle
        return handle

    def _decode_identity(self, node: dict[str, Any], fns: Sequence[Callable[..., Any]] = ()) -> Any:
        token = int(node["$id"])
        live = self._identities.get(token)
        if live is not None:
            return live
        obj = Identified(
            {_unescape(k): freeze(self._decode(v, fns)) for k, v in node.items() if not _is_tag(k)}
        )
        self._identities[token] = obj
        return obj


def _encode_float(value: float) -> Any:
    if math.isnan(value):
        return {"$n": "NaN"}
    if math.isinf(value):
        return {"$n": "Infinity" if value > 0 else "-Infinity"}
    if value == 0.0 and math.copysign(1.0, value) < 0:
        return {"$n": "-0"}
    return value


runtime = Runtime(_ffi.call, _ffi.release)
