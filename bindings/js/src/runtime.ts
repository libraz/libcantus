/**
 * The facade's side of the op boundary: argument encoding, result decoding,
 * callback frames, hybrids, handles and identity tokens.
 *
 * Every value crosses as wire JSON (D4 tags). A decoded model-class instance or
 * hybrid keeps the wire node it arrived as in a side table (WeakMaps, so frozen
 * values need no extra properties), and passing it back re-sends exactly what
 * the core produced. The `$ref` key a backend may add to a hybrid tag is opaque
 * here: it stays in the kept node and goes back with it.
 *
 * An instance of a by-reference type (see `RuntimeOptions`) is retained in the core on its first
 * use as a receiver (`$retain`); later calls send `{"$class": T, "$ref": id}` instead of its data.
 * The reference is released when the instance is collected, and at most `maxRefs` are live at
 * once: the least recently used is released when a call returns, and that instance sends its
 * data again from then on.
 *
 * Freezing follows the pure package, which hands out mutable results: decoded
 * results are left writable, except what the pure package freezes: the entries
 * of `FROZEN_RESULTS`, and the consts it freezes. `freezeAt` is the one place a
 * value is frozen.
 */
import type { Backend, CallReply, HostCallback } from './backend.js';
import {
  BudgetExceededError,
  ERROR_CODES,
  type ErrorReply,
  errorFromReply,
  InvalidInputError,
  NoSolutionError,
} from './errors.js';

/** A parsed wire value. */
export type Wire = null | boolean | number | string | Wire[] | { [key: string]: Wire };

/** A wire object. */
export type WireObject = { [key: string]: Wire };

/** Members of a hybrid or handle type, as the manifest lists them. */
export type TypeMeta = {
  kind: 'hybrid' | 'handle';
  /** Function members, each an op `Type#name`. */
  methods: readonly string[];
  /** Data members; on a handle each read is an op `Type#name`. */
  properties: readonly string[];
  /** Every member in declaration order, which is the order the object's own keys take. */
  order?: readonly string[];
  /** Properties of a handle that never change while it lives, so one read is kept. */
  stable?: readonly string[];
};

/** The most references to retained values one runtime holds at a time. */
export const MAX_LIVE_REFS = 1024;

/** How a runtime treats the values it sends. */
export type RuntimeOptions = {
  /** Types whose instances are retained in the core on first use as a receiver. */
  byReference?: readonly string[];
  /** The most live references; `MAX_LIVE_REFS` when absent. */
  maxRefs?: number;
};

/** `Function.length` of a generated class's constructor and members, as the pure class has them. */
export type ClassLengths = {
  constructor: number;
  static: Readonly<Record<string, number>>;
  prototype: Readonly<Record<string, number>>;
};

/** A constructor the runtime instantiates for `$class` results. */
type ClassLike = { prototype: object; name: string };

/** A user function registered for one call, behind `{"$cb": id}`. */
type Callable = (...args: unknown[]) => unknown;

/** The callbacks of one call, and what the first failing one threw. */
type Frame = {
  fns: Callable[];
  failed: boolean;
  error: unknown;
  /** Hybrid arguments by wire text, so a result naming one returns the caller's object. */
  hybrids: Map<string, object>;
  /** Whether the reply names hybrid references, which the objects decoded from it then hold. */
  refs: boolean;
};

/** How one result is decoded. */
type DecodeContext = {
  hybrids: ReadonlyMap<string, object> | null;
  /** The callbacks of the call that produced the result, which a `$cb` in a payload names. */
  fns?: readonly Callable[];
  /** Whether the result names hybrid references. */
  refs?: boolean;
};

/** What the runtime keeps about a hybrid object or a model-class instance. */
type WireEntry = {
  wire: WireObject;
  text?: string;
  /** The callbacks a `$cb` in the wire names, kept so a later call can register them again. */
  fns?: readonly Callable[];
  /** The core's retained copy of the value, when it has one on this runtime's backend. */
  ref?: { backend: Backend; id: number };
};

/** The `$counter` builtin handle, described like a manifest handle type. */
const BUILTIN_TYPES: Record<string, TypeMeta> = {
  $counter: { kind: 'handle', methods: ['next'], properties: ['value'] },
};

const ERROR_CLASSES: Record<string, (wire: WireObject) => Error> = {
  InvalidInputError: (w) => new InvalidInputError(String(w.message)),
  NoSolutionError: (w) =>
    new NoSolutionError(String(w.message), typeof w.at === 'number' ? { at: w.at } : {}),
  BudgetExceededError: (w) => new BudgetExceededError(String(w.message)),
};

const DISPOSE: symbol = (Symbol as { dispose?: symbol }).dispose ?? Symbol.for('Symbol.dispose');

const PLAIN: DecodeContext = { hybrids: null };
const WITH_REFS: DecodeContext = { hybrids: null, refs: true };

/** Whether a reply's text can name a hybrid reference. */
function mayNameRefs(json: string): boolean {
  return json.includes('"$ref"') && json.includes('"$hy"');
}

/** Every reference a hybrid tag in `node` names, itself and the ones nested in it. */
function collectHybridRefs(node: Wire, out: Set<number>): void {
  if (typeof node !== 'object' || node === null) return;
  if (Array.isArray(node)) {
    for (const element of node) collectHybridRefs(element, out);
    return;
  }
  if (typeof node.$hy === 'string' && typeof node.$ref === 'number') out.add(node.$ref);
  for (const key in node) collectHybridRefs(node[key] as Wire, out);
}

/** The whole result. */
const WHOLE: readonly string[] = [];

/** Where the pure analysis freezes the chords it shares between readings (`*` is each element). */
const SHARED_CHORDS: readonly string[] = ['timeline', 'segments', '*', 'chord'];

/** Ops whose result the pure package freezes, as the path below the result that is. */
const FROZEN_RESULTS: Readonly<Record<string, readonly string[]>> = {
  chordTimelineFromNotes: SHARED_CHORDS,
  analyzeArrangement: SHARED_CHORDS,
  'ArrangementSession#analysis': SHARED_CHORDS,
  'NoteEventIndex#notes': WHOLE,
  'NoteEventIndex#at': WHOLE,
  '$counter#value': WHOLE,
};

/** Ops answering one of the receiver's own segment chords, frozen when the receiver's are. */
const SEGMENT_CHORD_OPS: ReadonlySet<string> = new Set(['ChordTimeline#at']);

/**
 * The single policy for freezing a decoded value: everything at `path` below `value`, deeply
 * (`*` steps into each element, no path freezes `value` itself). Class instances and handles are
 * left alone.
 */
function freezeAt<T>(value: T, path: readonly string[]): T {
  if (typeof value !== 'object' || value === null) return value;
  const [head, ...rest] = path;
  if (head === undefined) {
    if (Array.isArray(value) || isPlainPrototype(value)) {
      for (const child of Object.values(value)) freezeAt(child, path);
      Object.freeze(value);
    }
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const child of head === '*' ? Object.values(record) : [record[head]]) freezeAt(child, rest);
  return value;
}

/** Whether `chords` is a non-empty segment list whose chords the pure analysis froze. */
function sharesFrozenChords(segments: unknown): boolean {
  return (
    Array.isArray(segments) &&
    segments.length > 0 &&
    segments.every((s: { chord?: unknown }) => Object.isFrozen(s?.chord))
  );
}

/** Whether an object key is a wire tag (one `$`) rather than an escaped user key (`$$`). */
function isTagKey(key: string): boolean {
  return key.charCodeAt(0) === 36 && key.charCodeAt(1) !== 36;
}

function escapeKey(key: string): string {
  return key.charCodeAt(0) === 36 ? `$${key}` : key;
}

function unescapeKey(key: string): string {
  return key.charCodeAt(0) === 36 && key.charCodeAt(1) === 36 ? key.slice(1) : key;
}

function numberText(n: number): string {
  if (Number.isNaN(n)) return '{"$n":"NaN"}';
  if (n === Number.POSITIVE_INFINITY) return '{"$n":"Infinity"}';
  if (n === Number.NEGATIVE_INFINITY) return '{"$n":"-Infinity"}';
  if (n === 0 && 1 / n < 0) return '{"$n":"-0"}';
  return String(n);
}

function isPlainPrototype(object: object): boolean {
  const proto = Object.getPrototypeOf(object) as object | null;
  return proto === Object.prototype || proto === null;
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

function setLength(fn: unknown, length: number | undefined): void {
  if (typeof fn === 'function' && length !== undefined) {
    Object.defineProperty(fn, 'length', { value: length });
  }
}

/**
 * The methods an instance of a user class inherits, bound to it: what a structural interface
 * (`{ at(beat): number }`) reads off the object. Built-in prototypes contribute nothing.
 */
function inheritedMethods(record: object, own: readonly string[]): [string, Callable][] {
  const found = new Map<string, Callable>();
  let proto = Object.getPrototypeOf(record) as object | null;
  while (proto !== null && proto !== Object.prototype) {
    const ctor = (proto as { constructor?: unknown }).constructor;
    if (
      typeof ctor !== 'function' ||
      Function.prototype.toString.call(ctor).includes('[native code]')
    ) {
      break;
    }
    for (const name of Object.getOwnPropertyNames(proto)) {
      const fn = Object.getOwnPropertyDescriptor(proto, name)?.value;
      if (name === 'constructor' || typeof fn !== 'function') continue;
      if (!own.includes(name) && !found.has(name)) {
        found.set(name, (...args: unknown[]) => (fn as Callable).apply(record, args));
      }
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return [...found];
}

/**
 * The `$class` side table, one per realm: an instance decoded by a second copy of the facade (a
 * bundle that emits the module twice) still encodes as its data when handed to the first.
 */
function sharedClassWire(): WeakMap<object, WireEntry> {
  const slot = Symbol.for('@libraz/libcantus-facade/class-wire');
  const global = globalThis as unknown as Record<symbol, WeakMap<object, WireEntry> | undefined>;
  global[slot] ??= new WeakMap();
  return global[slot];
}

/**
 * What the runtime keeps of a decoded hybrid or class instance: its wire, and the callbacks of
 * the call that produced it when a `$cb` in the wire names one, so a later call can register
 * them again.
 */
function keptEntry(
  wire: WireObject,
  fns: readonly Callable[] | undefined,
  text?: string,
): WireEntry {
  const entry: WireEntry = text === undefined ? { wire } : { wire, text };
  if (fns !== undefined && fns.length > 0 && (text ?? JSON.stringify(wire)).includes('"$cb"')) {
    entry.fns = fns;
  }
  return entry;
}

/** The facade runtime over one backend. */
export class Runtime {
  readonly #backend: Backend;
  readonly #types: Record<string, TypeMeta>;
  readonly #classes = new Map<string, ClassLike>();
  readonly #classWire = sharedClassWire();
  readonly #hybrids = new WeakMap<object, WireEntry>();
  readonly #hybridMethods = new WeakMap<object, { entry: WireEntry; method: string }>();
  readonly #handleOf = new WeakMap<
    object,
    { id: number; type: string; cache: Map<string, unknown> }
  >();
  readonly #handles = new Map<number, WeakRef<object>>();
  readonly #identities = new Map<number, WeakRef<object>>();
  readonly #frames: Frame[] = [];
  readonly #handleRegistry: FinalizationRegistry<number>;
  readonly #identityRegistry: FinalizationRegistry<number>;
  readonly #byReference: ReadonlySet<string>;
  readonly #maxRefs: number;
  /** Retained values by reference id, least recently used first. */
  readonly #liveRefs = new Map<number, WeakRef<WireEntry>>();
  readonly #refRegistry: FinalizationRegistry<number>;
  /** How many live objects hold each hybrid reference a backend issued. */
  readonly #hybridRefCounts = new Map<number, number>();
  readonly #hybridRefRegistry: FinalizationRegistry<readonly number[]>;
  #retainUnsupported = false;

  /**
   * @param backend The core every op goes to.
   * @param types The hybrid and handle types the results may carry.
   * @param options Which types are held in the core by reference, and how many at most.
   */
  constructor(
    backend: Backend,
    types: Record<string, TypeMeta> = {},
    options: RuntimeOptions = {},
  ) {
    this.#backend = backend;
    this.#types = { ...BUILTIN_TYPES, ...types };
    this.#byReference = new Set(options.byReference ?? []);
    this.#maxRefs = options.maxRefs ?? MAX_LIVE_REFS;
    this.#refRegistry = new FinalizationRegistry((id) => this.#dropRef(id));
    this.#hybridRefRegistry = new FinalizationRegistry((ids) => {
      for (const id of ids) {
        const left = (this.#hybridRefCounts.get(id) ?? 0) - 1;
        if (left > 0) {
          this.#hybridRefCounts.set(id, left);
        } else {
          this.#hybridRefCounts.delete(id);
          this.#backend.release(id);
        }
      }
    });
    this.#handleRegistry = new FinalizationRegistry((id) => {
      if (this.#handles.get(id)?.deref() === undefined) {
        this.#handles.delete(id);
        this.#backend.release(id);
      }
    });
    this.#identityRegistry = new FinalizationRegistry((token) => {
      if (this.#identities.get(token)?.deref() === undefined) this.#identities.delete(token);
    });
  }

  /** Make `$class` results named `name` instances of `cls`, with the pure class's lengths. */
  registerClass(name: string, cls: ClassLike, lengths?: ClassLengths): void {
    this.#classes.set(name, cls);
    if (lengths === undefined) return;
    setLength(cls, lengths.constructor);
    for (const [member, length] of Object.entries(lengths.static)) {
      setLength((cls as unknown as Record<string, unknown>)[member], length);
    }
    for (const [member, length] of Object.entries(lengths.prototype)) {
      setLength(Object.getOwnPropertyDescriptor(cls.prototype, member)?.value, length);
    }
  }

  /** Run op `op` on `args` and return its decoded result. */
  call(op: string, args: readonly unknown[]): unknown {
    try {
      this.#retainReceiver(op, args[0]);
      const frame = this.#newFrame();
      const wire = this.#run(op, args, frame);
      const result = this.#decode(wire, {
        hybrids: frame.hybrids.size > 0 ? frame.hybrids : null,
        fns: frame.fns,
        refs: frame.refs,
      });
      const frozen = FROZEN_RESULTS[op];
      if (frozen !== undefined) freezeAt(result, frozen);
      else if (SEGMENT_CHORD_OPS.has(op) && sharesFrozenChords((args[0] as WireObject)?.segments)) {
        freezeAt(result, []);
      }
      return result;
    } finally {
      // A reference an enclosing call has already sent stays valid until that call returns.
      if (this.#frames.length === 0) this.#evict();
    }
  }

  /** A function export: calls op `op` with its arguments; `length` is the pure function's. */
  fn(op: string, length: number): (...args: unknown[]) => unknown {
    const f = (...args: unknown[]): unknown => this.call(op, args);
    Object.defineProperty(f, 'name', { value: op });
    setLength(f, length);
    return f;
  }

  /** A const export from its wire form; `frozen` mirrors whether the pure value is. */
  constant(wire: unknown, frozen: boolean): unknown {
    const value = this.#decode(wire as Wire, PLAIN);
    return frozen ? freezeAt(value, []) : value;
  }

  /** Run a constructor op and attach the `$class` it returns to `self`. */
  construct(self: object, op: string, args: readonly unknown[]): void {
    const frame = this.#newFrame();
    const wire = this.#run(op, args, frame);
    if (typeof wire !== 'object' || wire === null || Array.isArray(wire) || !('$class' in wire)) {
      throw Object.assign(new Error(`${op} did not return a class instance`), {
        code: 'INTERNAL',
      });
    }
    this.#classWire.set(self, keptEntry(wire, frame.fns));
    if (frame.refs) this.#holdHybridRefs([self], wire);
  }

  /** Release a handle now (`[Symbol.dispose]`); later calls on it fail with RELEASED_HANDLE. */
  release(handle: object): void {
    const info = this.#handleOf.get(handle);
    if (info === undefined) return;
    this.#handleRegistry.unregister(handle);
    info.cache.clear();
    this.#handles.delete(info.id);
    this.#backend.release(info.id);
  }

  /** How many handle ids the runtime still tracks, for tests. */
  get trackedHandles(): number {
    return this.#handles.size;
  }

  /** How many retained values the runtime holds a reference to, for tests. */
  get retainedRefs(): number {
    return this.#liveRefs.size;
  }

  #newFrame(): Frame {
    return { fns: [], failed: false, error: undefined, hybrids: new Map(), refs: false };
  }

  /** The id of the core's copy of `entry`'s value, when this runtime's backend holds one. */
  #refOf(entry: WireEntry): number | undefined {
    return entry.ref?.backend === this.#backend ? entry.ref.id : undefined;
  }

  #touchRef(id: number): void {
    const weak = this.#liveRefs.get(id);
    if (weak === undefined) return;
    this.#liveRefs.delete(id);
    this.#liveRefs.set(id, weak);
  }

  /** Remember that the core holds `entry`'s value under `id` for as long as `owner` lives. */
  #adoptRef(owner: object, entry: WireEntry, id: number): void {
    entry.ref = { backend: this.#backend, id };
    this.#liveRefs.set(id, new WeakRef(entry));
    this.#refRegistry.register(owner, id, entry);
  }

  /** Forget a reference and release it in the core. */
  #dropRef(id: number): void {
    const entry = this.#liveRefs.get(id)?.deref();
    this.#liveRefs.delete(id);
    if (entry !== undefined) entry.ref = undefined;
    this.#backend.release(id);
  }

  /** Release the least recently used references beyond the cap. */
  #evict(): void {
    for (const [id, weak] of this.#liveRefs) {
      if (this.#liveRefs.size <= this.#maxRefs) break;
      const entry = weak.deref();
      if (entry === undefined) continue;
      this.#refRegistry.unregister(entry);
      this.#dropRef(id);
    }
  }

  /**
   * Retain the receiver of a `Type#member` op in the core the first time it is used, when its
   * type is by-reference. A refusal is left to the op itself, which fails the same way.
   */
  #retainReceiver(op: string, self: unknown): void {
    const hash = op.indexOf('#');
    if (hash <= 0 || this.#retainUnsupported || typeof self !== 'object' || self === null) return;
    if (!this.#byReference.has(op.slice(0, hash))) return;
    const entry = this.#classWire.get(self) ?? this.#hybrids.get(self);
    if (entry === undefined || entry.fns !== undefined) return;
    const id = this.#refOf(entry);
    if (id !== undefined) {
      this.#touchRef(id);
      return;
    }
    if (entry.ref !== undefined) return;
    const type = entry.wire.$class ?? entry.wire.$hy;
    if (type !== op.slice(0, hash)) return;
    entry.text ??= JSON.stringify(entry.wire);
    const reply = this.#backend.call('$retain', `[${entry.text}]`, null);
    if (reply.status === ERROR_CODES.UNKNOWN_OP) this.#retainUnsupported = true;
    if (reply.status !== 0) return;
    const ref = (JSON.parse(reply.json) as WireObject).$ref;
    if (typeof ref === 'number') this.#adoptRef(self, entry, ref);
  }

  /** `{"$hy": T, "$ref": id}` when `value` is a retained hybrid receiving one of its own methods. */
  #receiverRef(op: string, value: unknown): string | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const entry = this.#hybrids.get(value);
    const id = entry === undefined ? undefined : this.#refOf(entry);
    if (entry === undefined || id === undefined) return undefined;
    const type = String(entry.wire.$hy);
    if (!op.startsWith(`${type}#`)) return undefined;
    this.#touchRef(id);
    return `{"$hy":${JSON.stringify(type)},"$ref":${id}}`;
  }

  /** Count the hybrid references in `wire` against each of `owners`, released with the last. */
  #holdHybridRefs(owners: readonly object[], wire: Wire): void {
    const found = new Set<number>();
    collectHybridRefs(wire, found);
    if (found.size === 0) return;
    const ids = [...found];
    for (const owner of owners) {
      for (const id of ids) this.#hybridRefCounts.set(id, (this.#hybridRefCounts.get(id) ?? 0) + 1);
      this.#hybridRefRegistry.register(owner, ids);
    }
  }

  #run(op: string, args: readonly unknown[], frame: Frame): Wire {
    this.#frames.push(frame);
    let reply: CallReply;
    try {
      let argsJson = '[';
      for (let i = 0; i < args.length; i += 1) {
        if (i > 0) argsJson += ',';
        argsJson +=
          (i === 0 ? this.#receiverRef(op, args[0]) : undefined) ??
          this.#encode(args[i], frame, []);
      }
      argsJson += ']';
      reply = this.#backend.call(op, argsJson, frame.fns.length > 0 ? this.#host(frame) : null);
    } finally {
      this.#frames.pop();
    }
    if (reply.status === 0) {
      frame.refs = mayNameRefs(reply.json);
      return JSON.parse(reply.json) as Wire;
    }
    if (reply.status === ERROR_CODES.CALLBACK_FAILED && frame.failed) throw frame.error;
    let parsed: ErrorReply;
    try {
      parsed = JSON.parse(reply.json) as ErrorReply;
    } catch {
      parsed = { code: 'INTERNAL', name: 'Error', message: reply.json };
    }
    throw errorFromReply(parsed);
  }

  #host(frame: Frame): HostCallback {
    return (id, argsJson) => {
      const fn = frame.fns[id];
      try {
        if (fn === undefined) throw new Error(`no callback ${id}`);
        const args = this.#decode(
          JSON.parse(argsJson) as Wire,
          mayNameRefs(argsJson) ? WITH_REFS : PLAIN,
        ) as unknown[];
        return this.#encode(fn(...args), frame, []);
      } catch (error) {
        if (!frame.failed) {
          frame.failed = true;
          frame.error = error;
        }
        return undefined;
      }
    };
  }

  #encode(value: unknown, frame: Frame, stack: object[]): string {
    switch (typeof value) {
      case 'undefined':
        return '{"$u":1}';
      case 'number':
        return numberText(value);
      case 'string':
        return JSON.stringify(value);
      case 'boolean':
        return value ? 'true' : 'false';
      case 'bigint':
        return `{"$big":"${value.toString()}"}`;
      case 'symbol':
        return `{"$sym":${JSON.stringify(value.description ?? '')}}`;
      case 'function':
        return this.#encodeFunction(value as Callable, frame);
      default:
        break;
    }
    if (value === null) return 'null';
    const object = value as object;
    const cls = this.#classWire.get(object);
    if (cls !== undefined) {
      const id = this.#refOf(cls);
      if (id === undefined) return this.#entryText(cls, frame);
      this.#touchRef(id);
      return `{"$class":${JSON.stringify(cls.wire.$class)},"$ref":${id}}`;
    }
    const hybrid = this.#hybrids.get(object);
    if (hybrid !== undefined) {
      const text = this.#encodeHybrid(object as Record<string, unknown>, hybrid, frame);
      frame.hybrids.set(text, object);
      return text;
    }
    const handle = this.#handleOf.get(object);
    if (handle !== undefined) return `{"$h":${handle.id},"$type":${JSON.stringify(handle.type)}}`;
    // JSON holds no cycle: a value that contains itself crosses with the repeat cut to an
    // empty object or array, which reads as `[object Object]` wherever it is described.
    if (stack.includes(object)) return Array.isArray(object) ? '[]' : '{}';
    stack.push(object);
    try {
      if (Array.isArray(object)) {
        let out = '[';
        for (let i = 0; i < object.length; i += 1) {
          if (i > 0) out += ',';
          out += this.#encode(object[i], frame, stack);
        }
        return `${out}]`;
      }
      const record = object as Record<string, unknown>;
      const keys = Object.keys(record);
      if (typeof record.toJSON === 'function' && this.#crossesAsToJson(record, keys)) {
        let repr: string;
        try {
          repr = String(object);
        } catch {
          repr = '[object Object]';
        }
        const payload = this.#encode(record.toJSON(), frame, stack);
        return `{"$tojson":${payload},"$repr":${JSON.stringify(repr)}}`;
      }
      let out = '{';
      let first = true;
      for (const key of keys) {
        const field = record[key];
        if (field === undefined) continue;
        out += `${first ? '' : ','}${JSON.stringify(escapeKey(key))}:${this.#encode(field, frame, stack)}`;
        first = false;
      }
      for (const [key, method] of inheritedMethods(record, keys)) {
        out += `${first ? '' : ','}${JSON.stringify(escapeKey(key))}:${this.#encodeFunction(method, frame)}`;
        first = false;
      }
      return `${out}}`;
    } finally {
      stack.pop();
    }
  }

  /**
   * A hybrid's wire: the kept node, with each payload field the object shows re-read from it,
   * since a caller may have written to a visible field (a timeline's segments) after decoding.
   */
  #encodeHybrid(object: Record<string, unknown>, entry: WireEntry, frame: Frame): string {
    const visible = this.#types[String(entry.wire.$hy)]?.properties ?? [];
    if (visible.length === 0) return this.#entryText(entry, frame);
    let out = '{';
    let first = true;
    for (const key of Object.keys(entry.wire)) {
      const name = unescapeKey(key);
      const value =
        !isTagKey(key) && visible.includes(name)
          ? this.#encode(object[name], frame, [])
          : this.#nodeText(entry.wire[key] as Wire, entry.fns, frame);
      out += `${first ? '' : ','}${JSON.stringify(key)}:${value}`;
      first = false;
    }
    return `${out}}`;
  }

  /** A kept node as wire text; the callbacks it names are registered with `frame` again. */
  #entryText(entry: WireEntry, frame: Frame): string {
    if (entry.fns === undefined) {
      entry.text ??= JSON.stringify(entry.wire);
      return entry.text;
    }
    return this.#nodeText(entry.wire, entry.fns, frame);
  }

  #nodeText(node: Wire, fns: readonly Callable[] | undefined, frame: Frame): string {
    return JSON.stringify(fns === undefined ? node : this.#reseat(node, fns, frame));
  }

  /** `node` with every `{"$cb": id}` pointing at a callback registered with `frame`. */
  #reseat(node: Wire, fns: readonly Callable[], frame: Frame): Wire {
    if (typeof node !== 'object' || node === null) return node;
    if (Array.isArray(node)) return node.map((element) => this.#reseat(element, fns, frame));
    const fn = typeof node.$cb === 'number' ? fns[node.$cb] : undefined;
    if (fn !== undefined) {
      frame.fns.push(fn);
      return { $cb: frame.fns.length - 1 };
    }
    const out: WireObject = {};
    for (const key of Object.keys(node)) out[key] = this.#reseat(node[key] as Wire, fns, frame);
    return out;
  }

  /**
   * Whether an object with a `toJSON` crosses as `$tojson`: one that is not plain (its state
   * is private to it), or a plain one carrying nothing but functions. A plain object with data
   * fields crosses as itself, its functions as callbacks.
   */
  #crossesAsToJson(record: Record<string, unknown>, keys: readonly string[]): boolean {
    if (!isPlainPrototype(record)) return true;
    return keys.every((k) => typeof record[k] === 'function' || record[k] === undefined);
  }

  #encodeFunction(fn: Callable, frame: Frame): string {
    const method = this.#hybridMethods.get(fn);
    if (method !== undefined) {
      const { wire } = method.entry;
      // A hybrid the backend can resolve by reference goes as that; otherwise the method is
      // an ordinary callback.
      if (wire.$ref !== undefined) {
        return JSON.stringify({ ...wire, $ref: `${String(wire.$ref)}#${method.method}` });
      }
    }
    frame.fns.push(fn);
    return `{"$cb":${frame.fns.length - 1}}`;
  }

  #decode(node: Wire, ctx: DecodeContext): unknown {
    if (typeof node !== 'object' || node === null) return node;
    if (Array.isArray(node)) {
      return node.map((e) => this.#decode(e, ctx));
    }
    for (const key in node) {
      if (isTagKey(key)) return this.#decodeTag(node, key, ctx);
    }
    return this.#decodePlain(node, ctx);
  }

  #decodePlain(node: WireObject, ctx: DecodeContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      if (isTagKey(key)) continue;
      setOwn(out, unescapeKey(key), this.#decode(node[key] as Wire, ctx));
    }
    return out;
  }

  #decodeTag(node: WireObject, key: string, ctx: DecodeContext): unknown {
    if ('$n' in node) {
      const n = node.$n;
      if (n === 'NaN') return Number.NaN;
      if (n === 'Infinity') return Number.POSITIVE_INFINITY;
      if (n === '-Infinity') return Number.NEGATIVE_INFINITY;
      return -0;
    }
    if ('$u' in node) return undefined;
    if ('$big' in node) return BigInt(String(node.$big));
    if ('$sym' in node) return Symbol(String(node.$sym));
    if ('$tojson' in node) {
      const payload = this.#decode(node.$tojson as Wire, ctx);
      const repr = String(node.$repr);
      return { toJSON: () => payload, toString: () => repr };
    }
    if ('$class' in node) return this.#decodeClass(node, ctx);
    if ('$hy' in node) return this.#decodeHybrid(node, ctx);
    if ('$h' in node) return this.#decodeHandle(node);
    if ('$id' in node) return this.#decodeIdentity(node);
    throw Object.assign(new Error(`unexpected wire tag ${JSON.stringify(key)} in a result`), {
      code: 'BAD_REQUEST',
    });
  }

  #decodeClass(node: WireObject, ctx: DecodeContext): unknown {
    const name = String(node.$class);
    const error = ERROR_CLASSES[name];
    if (error !== undefined) return error(node);
    const cls = this.#classes.get(name);
    if (cls === undefined) {
      throw Object.assign(new Error(`unknown class ${JSON.stringify(name)} in a result`), {
        code: 'BAD_REQUEST',
      });
    }
    const instance = Object.create(cls.prototype) as object;
    // A `$ref` beside the data is the core's retained copy of this very value.
    const id = node.$ref;
    if (typeof id === 'number') {
      const { $ref: _ref, ...wire } = node;
      const entry = keptEntry(wire, ctx.fns);
      this.#classWire.set(instance, entry);
      this.#adoptRef(instance, entry, id);
    } else {
      this.#classWire.set(instance, keptEntry(node, ctx.fns));
    }
    if (ctx.refs) this.#holdHybridRefs([instance], node);
    return instance;
  }

  #meta(type: string, kind: TypeMeta['kind']): TypeMeta {
    const meta = this.#types[type];
    if (meta === undefined || meta.kind !== kind) {
      throw Object.assign(new Error(`unknown ${kind} type ${JSON.stringify(type)} in a result`), {
        code: 'BAD_REQUEST',
      });
    }
    return meta;
  }

  #decodeHybrid(node: WireObject, ctx: DecodeContext): unknown {
    const type = String(node.$hy);
    const meta = this.#meta(type, 'hybrid');
    const text = JSON.stringify(node);
    // A result that is the very hybrid passed in (an assertion returning its argument).
    const passed = ctx.hybrids?.get(text);
    if (passed !== undefined) return passed;
    const entry = keptEntry(node, ctx.fns, text);
    const object: Record<string, unknown> = {};
    const methods = new Set(meta.methods);
    const owners: object[] = [object];
    // Members in declaration order, so the object's own keys read like the pure one's.
    for (const name of meta.order ?? [...meta.properties, ...meta.methods]) {
      if (methods.has(name)) {
        const op = `${type}#${name}`;
        const fn = (...args: unknown[]): unknown => this.call(op, [object, ...args]);
        Object.defineProperty(fn, 'name', { value: name });
        this.#hybridMethods.set(fn, { entry, method: name });
        owners.push(fn);
        object[name] = fn;
      } else {
        const field = node[escapeKey(name)];
        object[name] = field === undefined ? undefined : this.#decode(field, ctx);
      }
    }
    this.#hybrids.set(object, entry);
    if (ctx.refs) this.#holdHybridRefs(owners, node);
    return object;
  }

  #decodeHandle(node: WireObject): unknown {
    const id = Number(node.$h);
    const type = String(node.$type);
    const live = this.#handles.get(id)?.deref();
    if (live !== undefined) return live;
    const meta = this.#meta(type, 'handle');
    const target: Record<string | symbol, unknown> = {};
    const properties = new Set(meta.properties);
    let proxy: object;
    for (const name of meta.order ?? [...meta.properties, ...meta.methods]) {
      if (properties.has(name)) {
        target[name] = undefined;
      } else {
        const op = `${type}#${name}`;
        const fn = (...args: unknown[]): unknown => this.call(op, [proxy, ...args]);
        Object.defineProperty(fn, 'name', { value: name });
        target[name] = fn;
      }
    }
    target[DISPOSE] = () => this.release(proxy);
    const stable = new Set(meta.stable);
    const cache = new Map<string, unknown>();
    const read = (key: string): unknown => {
      if (!stable.has(key)) return this.call(`${type}#${key}`, [proxy]);
      if (!cache.has(key)) cache.set(key, this.call(`${type}#${key}`, [proxy]));
      return cache.get(key);
    };
    // A property the caller wrote or deleted is theirs from then on; the others read the core.
    const written = new Set<string>();
    const reads = (key: string | symbol): key is string =>
      typeof key === 'string' && properties.has(key) && !written.has(key);
    const own = (key: string | symbol) => {
      if (typeof key === 'string') written.add(key);
    };
    proxy = new Proxy(target, {
      get: (t, key, receiver) => (reads(key) ? read(key) : Reflect.get(t, key, receiver)),
      getOwnPropertyDescriptor: (t, key) => {
        if (reads(key)) {
          return { value: read(key), writable: true, enumerable: true, configurable: true };
        }
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
      set: (t, key, value) => {
        own(key);
        return Reflect.set(t, key, value);
      },
      defineProperty: (t, key, descriptor) => {
        own(key);
        return Reflect.defineProperty(t, key, descriptor);
      },
      deleteProperty: (t, key) => {
        own(key);
        return Reflect.deleteProperty(t, key);
      },
    });
    this.#handleOf.set(proxy, { id, type, cache });
    this.#handles.set(id, new WeakRef(proxy));
    this.#handleRegistry.register(proxy, id, proxy);
    return proxy;
  }

  /** A `$id` object: the one already handed out under this token, or a new one. */
  #decodeIdentity(node: WireObject): unknown {
    const token = Number(node.$id);
    const live = this.#identities.get(token)?.deref();
    if (live !== undefined) return live;
    const object = this.#decodePlain(node, PLAIN);
    this.#identities.set(token, new WeakRef(object));
    this.#identityRegistry.register(object, token);
    return object;
  }
}
