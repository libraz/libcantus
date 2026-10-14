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
 * Freezing follows the pure package, which hands out mutable results: decoded
 * results are left writable, except what a handle op returns (state shared
 * across calls, `$id` results included), which is deep-frozen; consts mirror
 * the pure value.
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
};

/** How one result is decoded. */
type DecodeContext = {
  freeze: boolean;
  hybrids: ReadonlyMap<string, object> | null;
  /** The callbacks of the call that produced the result, which a `$cb` in a payload names. */
  fns?: readonly Callable[];
};

/** What the runtime keeps about a hybrid object or a model-class instance. */
type WireEntry = {
  wire: WireObject;
  text?: string;
  /** The callbacks a `$cb` in the wire names, kept so a later call can register them again. */
  fns?: readonly Callable[];
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

const NO_FREEZE: DecodeContext = { freeze: false, hybrids: null };
const FREEZE: DecodeContext = { freeze: true, hybrids: null };

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
 * The `$class` side table, one per realm: an instance decoded by a second copy of the facade (a
 * bundle that emits the module twice) still encodes as its data when handed to the first.
 */
function sharedClassWire(): WeakMap<object, WireEntry> {
  const slot = Symbol.for('@libraz/libcantus-facade/class-wire');
  const global = globalThis as unknown as Record<symbol, WeakMap<object, WireEntry> | undefined>;
  global[slot] ??= new WeakMap();
  return global[slot];
}

/** The facade runtime over one backend. */
export class Runtime {
  readonly #backend: Backend;
  readonly #types: Record<string, TypeMeta>;
  readonly #classes = new Map<string, ClassLike>();
  readonly #classWire = sharedClassWire();
  readonly #hybrids = new WeakMap<object, WireEntry>();
  readonly #hybridMethods = new WeakMap<object, { entry: WireEntry; method: string }>();
  readonly #handleOf = new WeakMap<object, { id: number; type: string }>();
  readonly #handles = new Map<number, WeakRef<object>>();
  readonly #identities = new Map<number, WeakRef<object>>();
  readonly #frames: Frame[] = [];
  readonly #handleRegistry: FinalizationRegistry<number>;
  readonly #identityRegistry: FinalizationRegistry<number>;

  /**
   * @param backend The core every op goes to.
   * @param types The hybrid and handle types the results may carry.
   */
  constructor(backend: Backend, types: Record<string, TypeMeta> = {}) {
    this.#backend = backend;
    this.#types = { ...BUILTIN_TYPES, ...types };
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
    const frame = this.#newFrame();
    const wire = this.#run(op, args, frame);
    const hash = op.indexOf('#');
    const freeze = hash > 0 && this.#types[op.slice(0, hash)]?.kind === 'handle';
    return this.#decode(wire, {
      freeze,
      hybrids: frame.hybrids.size > 0 ? frame.hybrids : null,
      fns: frame.fns,
    });
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
    return this.#decode(wire as Wire, frozen ? FREEZE : NO_FREEZE);
  }

  /** Run a constructor op and attach the `$class` it returns to `self`. */
  construct(self: object, op: string, args: readonly unknown[]): void {
    const wire = this.#run(op, args, this.#newFrame());
    if (typeof wire !== 'object' || wire === null || Array.isArray(wire) || !('$class' in wire)) {
      throw Object.assign(new Error(`${op} did not return a class instance`), {
        code: 'INTERNAL',
      });
    }
    this.#classWire.set(self, { wire });
  }

  /** Release a handle now (`[Symbol.dispose]`); later calls on it fail with RELEASED_HANDLE. */
  release(handle: object): void {
    const info = this.#handleOf.get(handle);
    if (info === undefined) return;
    this.#handleRegistry.unregister(handle);
    this.#backend.release(info.id);
  }

  #newFrame(): Frame {
    return { fns: [], failed: false, error: undefined, hybrids: new Map() };
  }

  #run(op: string, args: readonly unknown[], frame: Frame): Wire {
    this.#frames.push(frame);
    let reply: CallReply;
    try {
      let argsJson = '[';
      for (let i = 0; i < args.length; i += 1) {
        if (i > 0) argsJson += ',';
        argsJson += this.#encode(args[i], frame, []);
      }
      argsJson += ']';
      reply = this.#backend.call(op, argsJson, frame.fns.length > 0 ? this.#host(frame) : null);
    } finally {
      this.#frames.pop();
    }
    if (reply.status === 0) return JSON.parse(reply.json) as Wire;
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
        const args = this.#decode(JSON.parse(argsJson) as Wire, NO_FREEZE) as unknown[];
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
      cls.text ??= JSON.stringify(cls.wire);
      return cls.text;
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
      const ref = wire.$ref;
      if (ref === undefined) return this.#entryText(method.entry, frame);
      return JSON.stringify({ ...wire, $ref: `${String(ref)}#${method.method}` });
    }
    frame.fns.push(fn);
    return `{"$cb":${frame.fns.length - 1}}`;
  }

  #decode(node: Wire, ctx: DecodeContext): unknown {
    if (typeof node !== 'object' || node === null) return node;
    if (Array.isArray(node)) {
      const out = node.map((e) => this.#decode(e, ctx));
      return ctx.freeze ? Object.freeze(out) : out;
    }
    for (const key in node) {
      if (isTagKey(key)) return this.#decodeTag(node, key, ctx);
    }
    const out = this.#decodePlain(node, ctx);
    return ctx.freeze ? Object.freeze(out) : out;
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
    if ('$class' in node) return this.#decodeClass(node);
    if ('$hy' in node) return this.#decodeHybrid(node, ctx);
    if ('$h' in node) return this.#decodeHandle(node);
    if ('$id' in node) return this.#decodeIdentity(node);
    throw Object.assign(new Error(`unexpected wire tag ${JSON.stringify(key)} in a result`), {
      code: 'BAD_REQUEST',
    });
  }

  #decodeClass(node: WireObject): unknown {
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
    this.#classWire.set(instance, { wire: node });
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
    const entry: WireEntry = { wire: node, text };
    if (ctx.fns !== undefined && ctx.fns.length > 0 && text.includes('"$cb"')) entry.fns = ctx.fns;
    const object: Record<string, unknown> = {};
    const methods = new Set(meta.methods);
    // Members in declaration order, so the object's own keys read like the pure one's.
    for (const name of meta.order ?? [...meta.properties, ...meta.methods]) {
      if (methods.has(name)) {
        const op = `${type}#${name}`;
        const fn = (...args: unknown[]): unknown => this.call(op, [object, ...args]);
        Object.defineProperty(fn, 'name', { value: name });
        this.#hybridMethods.set(fn, { entry, method: name });
        object[name] = fn;
      } else {
        const field = node[escapeKey(name)];
        object[name] = field === undefined ? undefined : this.#decode(field, ctx);
      }
    }
    this.#hybrids.set(object, entry);
    return ctx.freeze ? Object.freeze(object) : object;
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
    const read = (key: string) => this.call(`${type}#${key}`, [proxy]);
    proxy = new Proxy(target, {
      get: (t, key, receiver) =>
        typeof key === 'string' && properties.has(key) ? read(key) : Reflect.get(t, key, receiver),
      getOwnPropertyDescriptor: (t, key) => {
        if (typeof key === 'string' && properties.has(key)) {
          return { value: read(key), writable: true, enumerable: true, configurable: true };
        }
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
    });
    this.#handleOf.set(proxy, { id, type });
    this.#handles.set(id, new WeakRef(proxy));
    this.#handleRegistry.register(proxy, id, proxy);
    return proxy;
  }

  /** A `$id` object: the one already handed out under this token, or a new frozen one. */
  #decodeIdentity(node: WireObject): unknown {
    const token = Number(node.$id);
    const live = this.#identities.get(token)?.deref();
    if (live !== undefined) return live;
    const object = Object.freeze(this.#decodePlain(node, FREEZE));
    this.#identities.set(token, new WeakRef(object));
    this.#identityRegistry.register(object, token);
    return object;
  }
}
