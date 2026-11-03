/**
 * A backend that answers every op with the pure TS package, for testing the
 * facade's marshalling on its own (`CANTUS_IMPL=facade-ts`).
 *
 * Arguments are decoded the way the core decodes them: `$class` through
 * `Class.fromData`, `$cb` into a function that calls back into the facade.
 * Hybrids and handles are pure TS objects kept in one handle table: a result
 * carries `$ref` (hybrid) or a handle id, and an argument naming either gets
 * the very same object back; releasing the id drops it. `$retain` stores a
 * model-class instance or hybrid in the same table, and `{"$class": T, "$ref": id}`
 * names it again. The builtin `$` ops are emulated to the C++
 * semantics, so the boundary tests run against this backend too.
 *
 * With `CANTUS_RECORD=1` every call is handed to the corpus recorder, a retained value in its
 * arguments written out as the full data it was retained from.
 */
import * as Pure from '../../../../ts/src/index.js';
import type { Backend, CallReply, HostCallback } from '../backend.js';
import { ERROR_CODES, ERROR_NAMES, type ErrorCodeName } from '../errors.js';
import { CLASS_WIRE, CLASSES, TYPES } from '../generated/meta.js';
import { escapeKey, isTagKey, numberText, setOwn, unescapeKey } from '../runtime.js';

const PURE = Pure as unknown as Record<string, unknown>;

/** The library version `$version` reports. */
const VERSION = '1.4.1';
/** CANTUS_ABI_VERSION of the C ABI this backend stands in for. */
const ABI_VERSION = 1;
/** Path segment `resolveContext` puts between a part name and the algorithm version. */
const VERSION_SEGMENT = 'v';
/** 2^53 - 1: the largest id a JS number holds exactly. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

type Wire = null | boolean | number | string | Wire[] | { [key: string]: Wire };
type WireObject = { [key: string]: Wire };

/** A failure carrying the boundary code it maps to. */
class BoundaryFailure extends Error {
  constructor(
    readonly code: ErrorCodeName,
    message: string,
  ) {
    super(message);
  }
}

/** Raised inside pure code when a host callback reported failure. */
class CallbackFailure extends Error {}

/** Wire text that is already encoded, for payload fields the pure object does not expose. */
class WireText {
  constructor(readonly text: string) {}
}

const badRequest = (message: string) => new BoundaryFailure('BAD_REQUEST', message);
const quote = (s: string) => JSON.stringify(s);

function isInteger(v: Wire | undefined, lo: number, hi: number): v is number {
  return typeof v === 'number' && v >= lo && v <= hi && Math.floor(v) === v;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// ---------------------------------------------------------------------------
// Wire validation: the rules of src/ops/codec.cpp, plus the `$ref` this backend issues.

function validateValue(v: Wire, undefinedAllowed: boolean, stats: { callbacks: number }): void {
  if (Array.isArray(v)) {
    for (const e of v) validateValue(e, true, stats);
    return;
  }
  if (!isObject(v)) return;
  const o = v as WireObject;
  const tags = Object.keys(o).filter(isTagKey);
  if (tags.length === 0) {
    for (const [k, x] of Object.entries(o)) if (!isTagKey(k)) validateValue(x, false, stats);
    return;
  }
  const keys = Object.keys(o).length;
  const only = (n: number, tag: string) => {
    if (keys !== n) throw badRequest(`malformed ${quote(tag)} tag`);
  };
  if ('$n' in o) {
    only(1, '$n');
    if (!['-0', 'NaN', 'Infinity', '-Infinity'].includes(o.$n as string)) {
      throw badRequest('malformed "$n" tag');
    }
    return;
  }
  if ('$u' in o) {
    only(1, '$u');
    if (o.$u !== 1) throw badRequest('malformed "$u" tag');
    if (!undefinedAllowed) throw badRequest('"$u" is only valid as an array element');
    return;
  }
  if ('$big' in o) {
    only(1, '$big');
    if (typeof o.$big !== 'string' || !/^(0|-?[1-9][0-9]*)$/.test(o.$big)) {
      throw badRequest('malformed "$big" tag');
    }
    return;
  }
  if ('$sym' in o) {
    only(1, '$sym');
    if (typeof o.$sym !== 'string') throw badRequest('malformed "$sym" tag');
    return;
  }
  if ('$tojson' in o || '$repr' in o) {
    if (!('$tojson' in o) || typeof o.$repr !== 'string' || keys !== 2) {
      throw badRequest('malformed "$tojson" tag');
    }
    validateValue(o.$tojson as Wire, true, stats);
    return;
  }
  if ('$class' in o || '$hy' in o) {
    const primary = '$class' in o ? '$class' : '$hy';
    for (const k of tags) {
      if (k === '$class' || k === '$hy') {
        if (typeof o[k] !== 'string') throw badRequest(`malformed ${quote(k)} tag`);
      } else if (k === '$id') {
        if (!isInteger(o.$id, 0, MAX_SAFE)) throw badRequest('malformed "$id" tag');
      } else if (k === '$ref' && primary === '$class') {
        if (keys !== 2 || !isInteger(o.$ref, 1, MAX_SAFE))
          throw badRequest('malformed "$class" tag');
      } else if (k !== '$ref') {
        throw badRequest(`malformed ${quote(primary)} tag`);
      }
    }
    if ('$class' in o && '$hy' in o) throw badRequest('malformed "$class" tag');
    for (const [k, x] of Object.entries(o)) if (!isTagKey(k)) validateValue(x, false, stats);
    return;
  }
  if ('$h' in o) {
    if (keys !== 2 || typeof o.$type !== 'string' || !isInteger(o.$h, 1, MAX_SAFE)) {
      throw badRequest('malformed "$h" tag');
    }
    return;
  }
  if ('$cb' in o) {
    only(1, '$cb');
    if (!isInteger(o.$cb, 0, 0xffffffff)) throw badRequest('malformed "$cb" tag');
    stats.callbacks += 1;
    return;
  }
  if ('$id' in o) {
    for (const k of tags) if (k !== '$id') throw badRequest('malformed "$id" tag');
    if (!isInteger(o.$id, 0, MAX_SAFE)) throw badRequest('malformed "$id" tag');
    for (const [k, x] of Object.entries(o)) if (!isTagKey(k)) validateValue(x, false, stats);
    return;
  }
  throw badRequest(`unknown wire tag ${quote(tags[0] as string)}`);
}

/** Serialize a parsed wire value the way ops::stringify does. */
function stringifyWire(v: Wire | undefined): string {
  if (v === undefined) return '{"$u":1}';
  if (typeof v === 'number') return numberText(v);
  if (Array.isArray(v)) return `[${v.map(stringifyWire).join(',')}]`;
  if (isObject(v)) {
    const parts = Object.keys(v).map((k) => `${quote(k)}:${stringifyWire(v[k])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(v);
}

function numberOf(v: Wire | undefined): number | undefined {
  if (typeof v === 'number') return v;
  if (!isObject(v) || Array.isArray(v) || typeof v.$n !== 'string') return undefined;
  return { NaN: Number.NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0 }[v.$n];
}

function isUndefinedTag(v: Wire | undefined): boolean {
  return v === undefined || (isObject(v) && !Array.isArray(v) && v.$u === 1);
}

// ---------------------------------------------------------------------------
// Reference tables.

/**
 * `kind` is absent on a handle; `hybrid` marks a hybrid object a result named by `$ref`, and
 * `value` a model-class instance or hybrid held by `$retain` (with `wire`, its data, when recording).
 */
type HandleEntry = {
  object: object;
  type: string;
  counter?: { count: number; token: number };
  kind?: 'hybrid' | 'value';
  wire?: Wire;
};

/** Live handles, hybrid references and retained values by id; ids are never reused. */
const handles = new Map<number, HandleEntry>();
const handleIds = new WeakMap<object, number>();
let lastHandle = 0;
/** References whose payload could not be read in full; a call passing one back is not replayable. */
const incompleteRefs = new Set<number>();

/** Ops whose result adopts the receiver's state, so a receiver sent by reference returns by reference. */
const RETAINING_RESULTS: ReadonlySet<string> = new Set(['Arrangement#update']);

/** Identity tokens of handle getter results. */
const tokens = new WeakMap<object, number>();
let lastToken = 0;

/** Payload fields a hybrid captured in a closure, recorded when the op that made it ran. */
const provenance = new WeakMap<object, Record<string, unknown>>();

/** Wire nodes of `$tojson` arguments, so they go back out unchanged. */
const toJsonWire = new WeakMap<object, Wire>();

function nextToken(): number {
  lastToken += 1;
  return lastToken;
}

function tokenOf(object: object): number {
  let token = tokens.get(object);
  if (token === undefined) {
    token = nextToken();
    tokens.set(object, token);
  }
  return token;
}

function newHandle(
  object: object,
  type: string,
  counter?: HandleEntry['counter'],
  kind?: HandleEntry['kind'],
): number {
  const known = handleIds.get(object);
  if (known !== undefined && handles.has(known)) return known;
  lastHandle += 1;
  handles.set(lastHandle, {
    object,
    type,
    ...(counter ? { counter } : {}),
    ...(kind ? { kind } : {}),
  });
  handleIds.set(object, lastHandle);
  return lastHandle;
}

/** Hold `object` under a new id of its own, apart from any id it has as a handle or hybrid. */
function retainValue(object: object, type: string, wire: Wire | undefined): number {
  lastHandle += 1;
  handles.set(lastHandle, { object, type, kind: 'value', ...(wire === undefined ? {} : { wire }) });
  return lastHandle;
}

/** The failure for an id that names nothing live: released once, or never issued. */
function missingHandle(id: number, type: string): BoundaryFailure {
  if (id >= 1 && id <= lastHandle) {
    return new BoundaryFailure('RELEASED_HANDLE', `${type} handle ${id} has been released`);
  }
  return badRequest(`unknown handle ${id}`);
}

function resolveHandle(tag: Wire | undefined, type: string): HandleEntry {
  if (!isObject(tag) || Array.isArray(tag) || !('$h' in tag)) {
    throw badRequest(`expected a ${quote(type)} handle`);
  }
  const id = tag.$h as number;
  const entry = handles.get(id);
  if (entry === undefined) throw missingHandle(id, String(tag.$type));
  if (entry.kind !== undefined || entry.type !== type || tag.$type !== type) {
    throw badRequest(`handle ${id} is a ${quote(entry.type)}, not a ${quote(type)}`);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Pure values <-> wire.

const classProtos = new Map<object, string>();
for (const name of CLASSES) {
  const cls = PURE[name] as { prototype: object };
  classProtos.set(cls.prototype, name);
}
const errorProtos = new Map<object, string>([
  [Pure.InvalidInputError.prototype, 'InvalidInputError'],
  [Pure.NoSolutionError.prototype, 'NoSolutionError'],
  [Pure.BudgetExceededError.prototype, 'BudgetExceededError'],
]);

/** Member key set of each hybrid and handle type, for recognising a returned object. */
const typeKeys = Object.entries(TYPES).map(([name, meta]) => ({
  name,
  meta,
  keys: [...meta.properties, ...meta.methods].sort().join('\0'),
}));

/** What an encoding met that keeps the call out of the corpus. */
type EncodeState = {
  incomplete: boolean;
  /** Tag every plain object with its `$id` (handle getter results, whose parts are shared). */
  identity?: boolean;
  /** An argument named a retained value by reference. */
  referenced?: boolean;
  /** The arguments with each retained value written out, for the recorder. */
  recorded?: string;
};

function encodeValue(v: unknown, state: EncodeState): string {
  switch (typeof v) {
    case 'undefined':
      return '{"$u":1}';
    case 'number':
      return numberText(v);
    case 'string':
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'bigint':
      return `{"$big":"${v.toString()}"}`;
    case 'symbol':
      return `{"$sym":${quote(v.description ?? '')}}`;
    case 'function':
      throw new BoundaryFailure('INTERNAL', 'a function result has no wire form');
    default:
      break;
  }
  if (v === null) return 'null';
  if (v instanceof WireText) return v.text;
  const object = v as object;
  const proto = Object.getPrototypeOf(object) as object | null;
  const cls = proto === null ? undefined : classProtos.get(proto);
  if (cls !== undefined)
    return `{"$class":${quote(cls)}${encodeFields(classData(cls, object), state)}}`;
  const error = proto === null ? undefined : errorProtos.get(proto);
  if (error !== undefined) {
    const e = object as Error & { at?: number };
    const at = e.at === undefined ? '' : `,"at":${numberText(e.at)}`;
    return `{"$class":${quote(error)},"message":${quote(e.message)}${at}}`;
  }
  const kept = toJsonWire.get(object);
  if (kept !== undefined) return stringifyWire(kept);
  // Array.from visits holes, which cross as undefined.
  if (Array.isArray(object))
    return `[${Array.from(object, (e) => encodeValue(e, state)).join(',')}]`;
  const record = object as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((k) => typeof record[k] === 'function')) return encodeTyped(record, keys, state);
  const fields = encodeFields(record, state);
  if (state.identity && Object.getPrototypeOf(record) === Object.prototype) {
    return `{"$id":${tokenOf(record)}${fields}}`;
  }
  return `{${fields.slice(1)}}`;
}

/** The value at a dotted getter path. */
function read(object: unknown, getterPath: string): unknown {
  let value = object;
  for (const part of getterPath.split('.')) value = isObject(value) ? value[part] : undefined;
  return value;
}

/** The fields a model-class instance crosses as (see CLASS_WIRE). */
function classData(cls: string, object: object): Record<string, unknown> {
  const wire = CLASS_WIRE[cls];
  const instance = object as Record<string, unknown> & { toJSON(): unknown };
  if (wire?.fields !== undefined) {
    return Object.fromEntries(
      Object.entries(wire.fields).map(([f, getter]) => [f, read(instance, getter)]),
    );
  }
  const json = instance.toJSON();
  if (wire?.array !== undefined) return { [wire.array]: json };
  const data = { ...(json as Record<string, unknown>) };
  for (const [f, getter] of Object.entries({ ...wire?.extra, ...wire?.context })) {
    data[f] = read(instance, getter);
  }
  return data;
}

/** `,"k":v` for each defined field. */
function encodeFields(record: Record<string, unknown>, state: EncodeState): string {
  let out = '';
  for (const key of Object.keys(record)) {
    const field = record[key];
    if (field === undefined) continue;
    out += `,${quote(escapeKey(key))}:${encodeValue(field, state)}`;
  }
  return out;
}

/** A pure object carrying functions: a hybrid or a handle, recognised by its members. */
function encodeTyped(record: Record<string, unknown>, keys: string[], state: EncodeState): string {
  const signature = [...keys].sort().join('\0');
  const match = typeKeys.find((t) => t.keys === signature);
  if (match === undefined) {
    throw new BoundaryFailure(
      'INTERNAL',
      `no wire form for an object with members ${keys.join(', ')}`,
    );
  }
  if (match.meta.kind === 'handle') {
    state.incomplete = true;
    return `{"$h":${newHandle(record, match.name)},"$type":${quote(match.name)}}`;
  }
  const ref = newHandle(record, match.name, undefined, 'hybrid');
  const captured = provenance.get(record) ?? {};
  const inner: EncodeState = { incomplete: false, identity: state.identity };
  let out = `{"$hy":${quote(match.name)}`;
  for (const field of match.meta.payload) {
    const own = Object.hasOwn(record, field) ? record[field] : captured[field];
    if (own === undefined) {
      if (!Object.hasOwn(record, field) && !Object.hasOwn(captured, field)) inner.incomplete = true;
      continue;
    }
    if (typeof own === 'function' && !handleIds.has(own)) {
      inner.incomplete = true;
      continue;
    }
    out += `,${quote(escapeKey(field))}:${encodeValue(own, inner)}`;
  }
  if (inner.incomplete) {
    incompleteRefs.add(ref);
    state.incomplete = true;
  }
  return `${out},"$ref":${ref}}`;
}

/** Decode one wire value of an argument into the pure value it stands for. */
function decodeValue(v: Wire, host: HostCallback | null, state: EncodeState): unknown {
  if (Array.isArray(v)) return v.map((e) => decodeValue(e, host, state));
  if (!isObject(v)) return v;
  const o = v as WireObject;
  let tagged = false;
  for (const k in o) {
    if (isTagKey(k)) {
      tagged = true;
      break;
    }
  }
  if (!tagged) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      const value = decodeValue(o[k] as Wire, host, state);
      setOwn(out, unescapeKey(k), value);
    }
    return out;
  }
  if ('$n' in o || '$u' in o) return numberOf(o);
  if ('$big' in o) return BigInt(o.$big as string);
  if ('$sym' in o) return Symbol(o.$sym as string);
  if ('$tojson' in o) {
    const payload = decodeValue(o.$tojson as Wire, host, state);
    const repr = o.$repr as string;
    const object = { toJSON: () => payload, toString: () => repr };
    toJsonWire.set(object, o);
    return object;
  }
  if ('$class' in o) {
    if (!('$ref' in o)) return decodeClass(o, host, state);
    state.referenced = true;
    return referencedValue(o.$ref as number, String(o.$class)).object;
  }
  if ('$hy' in o) {
    const ref = o.$ref;
    if (ref === undefined)
      throw badRequest(`a ${quote(String(o.$hy))} hybrid needs a reference here`);
    const [id, method] = String(ref).split('#');
    const type = String(o.$hy);
    // A bare numeric reference names a retained value; with data or a member it names a hybrid.
    const bare = typeof ref === 'number' && Object.keys(o).length === 2;
    if (bare) state.referenced = true;
    if (incompleteRefs.has(Number(id))) state.incomplete = true;
    const entry = handles.get(Number(id));
    if (entry === undefined) {
      if (bare) throw missingHandle(Number(id), type);
      throw badRequest(`unknown hybrid reference ${String(ref)}`);
    }
    if (entry.kind === undefined || entry.type !== type) {
      throw badRequest(`expected a ${quote(type)} instance`);
    }
    const object = entry.object;
    if (method !== undefined) return (object as Record<string, unknown>)[method];
    return withVisibleFields(object as Record<string, unknown>, o, host, state);
  }
  if ('$h' in o) return resolveHandle(o, String(o.$type)).object;
  if ('$cb' in o) return callbackFunction(o.$cb as number, host);
  if ('$id' in o) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o))
      if (!isTagKey(k)) out[unescapeKey(k)] = decodeValue(o[k] as Wire, host, state);
    return out;
  }
  throw badRequest(`unknown wire tag ${quote(Object.keys(o).find(isTagKey) as string)}`);
}

/** The value `$retain` holds under `id`, which must be an instance of the class `name`. */
function referencedValue(id: number, name: string): HandleEntry {
  const entry = handles.get(id);
  if (entry === undefined) throw missingHandle(id, name);
  if (entry.kind !== 'value' || entry.type !== name) {
    throw badRequest(`expected a ${quote(name)} instance`);
  }
  return entry;
}

/** `v` with every retained value named by reference written out as the data it was held from. */
function expandRefs(v: Wire, state: EncodeState): Wire {
  if (Array.isArray(v)) return v.map((e) => expandRefs(e, state));
  if (!isObject(v)) return v;
  const o = v as WireObject;
  if (typeof o.$ref === 'number' && Object.keys(o).length === 2 && ('$class' in o || '$hy' in o)) {
    const wire = handles.get(o.$ref)?.wire;
    if (wire !== undefined) return expandRefs(wire, state);
    state.incomplete = true;
    return o;
  }
  const out: WireObject = {};
  for (const k of Object.keys(o)) out[k] = expandRefs(o[k] as Wire, state);
  return out;
}

/**
 * The referenced hybrid, or a copy carrying the wire's values where a field the object shows
 * differs from it: the caller wrote to the decoded object, as it may to the pure one.
 */
function withVisibleFields(
  object: Record<string, unknown>,
  o: WireObject,
  host: HostCallback | null,
  state: EncodeState,
): unknown {
  const type = TYPES[o.$hy as string];
  let copy: Record<string, unknown> | undefined;
  for (const field of type?.properties ?? []) {
    const key = escapeKey(field);
    if (!(key in o)) continue;
    if (stringifyWire(o[key]) === encodeValue(object[field], { incomplete: false })) continue;
    copy ??= { ...object };
    copy[field] = decodeValue(o[key] as Wire, host, state);
  }
  return copy ?? object;
}

function decodeClass(o: WireObject, host: HostCallback | null, state: EncodeState): unknown {
  const name = o.$class as string;
  const data: Record<string, unknown> = {};
  for (const k of Object.keys(o))
    if (!isTagKey(k)) data[unescapeKey(k)] = decodeValue(o[k] as Wire, host, state);
  switch (name) {
    case 'InvalidInputError':
      return new Pure.InvalidInputError(String(data.message));
    case 'NoSolutionError':
      return new Pure.NoSolutionError(
        String(data.message),
        typeof data.at === 'number' ? { at: data.at } : {},
      );
    case 'BudgetExceededError':
      return new Pure.BudgetExceededError(String(data.message));
    default:
      break;
  }
  if (!CLASSES.includes(name)) throw badRequest(`unknown class ${quote(name)}`);
  const wire = CLASS_WIRE[name];
  const cls = PURE[name] as (new (
    ...args: unknown[]
  ) => unknown) & { fromData(data: unknown): unknown };
  if (wire?.fields !== undefined) return new cls(...Object.keys(wire.fields).map((f) => data[f]));
  if (wire?.array !== undefined) return cls.fromData(data[wire.array]);
  const context = Object.keys(wire?.context ?? {});
  if (context.length === 0) return cls.fromData(data);
  const values = context.map((f) => data[f]);
  for (const f of context) delete data[f];
  return values.every((v) => v === undefined) ? cls.fromData(data) : new cls(data, ...values);
}

function callbackFunction(id: number, host: HostCallback | null): (...args: unknown[]) => unknown {
  if (host === null) throw badRequest('callback arguments need a host callback function');
  return (...args: unknown[]) => {
    const state: EncodeState = { incomplete: false };
    const text = `[${args.map((a) => encodeValue(a, state)).join(',')}]`;
    const out = host(id, text);
    if (out === undefined) throw new CallbackFailure(`callback ${id} failed`);
    if (out === '') return undefined;
    const parsed = parseWire(out, 'invalid callback result JSON: ');
    validateValue(parsed, true, { callbacks: 0 });
    return decodeValue(parsed, host, { incomplete: false });
  };
}

function parseWire(text: string, prefix: string): Wire {
  try {
    return JSON.parse(text) as Wire;
  } catch (error) {
    throw badRequest(`${prefix}${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Ops.

/** What an op returned, plus whether its result carries an identity token. */
type Outcome = { value: unknown; identity: boolean };

function member(owner: unknown, name: string): PropertyDescriptor | undefined {
  let o = owner as object | null;
  while (o !== null) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d !== undefined) return d;
    o = Object.getPrototypeOf(o) as object | null;
  }
  return undefined;
}

function unknownOp(op: string): BoundaryFailure {
  return new BoundaryFailure('UNKNOWN_OP', `unknown op ${quote(op)}`);
}

function invoke(op: string, args: unknown[]): Outcome {
  if (op.startsWith('$const:')) {
    const name = op.slice('$const:'.length);
    if (!Object.hasOwn(PURE, name)) throw unknownOp(op);
    return { value: PURE[name], identity: false };
  }
  const hash = op.indexOf('#');
  if (hash > 0) {
    const owner = op.slice(0, hash);
    const name = op.slice(hash + 1);
    const self = args[0];
    const type = TYPES[owner];
    if (CLASSES.includes(owner)) {
      const cls = PURE[owner] as { prototype: object };
      if (!(self instanceof (cls as unknown as new () => object))) {
        throw badRequest(`expected a ${quote(owner)} instance`);
      }
      const d = member(cls.prototype, name);
      if (d === undefined) throw unknownOp(op);
      if (d.get) return { value: d.get.call(self), identity: false };
      return {
        value: (d.value as (...a: unknown[]) => unknown).apply(self, args.slice(1)),
        identity: false,
      };
    }
    if (type === undefined || !isObject(self)) throw unknownOp(op);
    const value = self[name];
    if (type.methods.includes(name)) {
      return { value: (value as (...a: unknown[]) => unknown)(...args.slice(1)), identity: false };
    }
    if (!type.properties.includes(name)) throw unknownOp(op);
    return { value, identity: type.kind === 'handle' };
  }
  const dot = op.indexOf('.');
  if (dot > 0) {
    const owner = op.slice(0, dot);
    const name = op.slice(dot + 1);
    if (!CLASSES.includes(owner)) throw unknownOp(op);
    const cls = PURE[owner] as new (...a: unknown[]) => unknown;
    if (name === 'constructor') return { value: new cls(...args), identity: false };
    const d = Object.getOwnPropertyDescriptor(cls, name);
    if (d === undefined) throw unknownOp(op);
    if (d.get) return { value: d.get.call(cls), identity: false };
    return { value: (d.value as (...a: unknown[]) => unknown).apply(cls, args), identity: false };
  }
  const fn = PURE[op];
  if (typeof fn !== 'function' || CLASSES.includes(op) || !Object.hasOwn(PURE, op))
    throw unknownOp(op);
  return { value: (fn as (...a: unknown[]) => unknown)(...args), identity: false };
}

/** Remember what a hybrid captured, for the ops that make one. */
function noteProvenance(op: string, args: unknown[], value: unknown): void {
  if (!isObject(value)) return;
  if (op === 'createPositionalRng') {
    provenance.set(value, { seed: args[0] });
  } else if (op === 'resolveContext' || op === 'resolveContextWith') {
    const input = args[0];
    provenance.set(value, {
      instruments: isObject(input) ? input.instruments : undefined,
      rng: isObject(input) ? input.rng : undefined,
    });
  } else if (op === 'ResolvedContext#part' && isObject(args[0])) {
    const ctx = args[0];
    const supplied = provenance.get(ctx)?.rng;
    const version = ctx.algorithmVersion as number;
    const name = args[1] as string;
    // `supplied ? drawsFrom(supplied, ...) : ...`: a falsy source draws from the seed.
    if (supplied) {
      provenance.set(value, { rng: supplied, path: [name, VERSION_SEGMENT, version] });
    } else {
      const seed = Pure.deriveSeed(ctx.seed as number, name, VERSION_SEGMENT, version);
      provenance.set(value, {
        rng: new WireText(`{"$hy":"PositionalRng","seed":${seed}}`),
        path: [],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Builtin ops, emulating src/ops/builtins.cpp.

function stringField(o: WireObject, key: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw badRequest(`$throw needs a string "${key}"`);
  return v;
}

function throwRequested(spec: Wire | undefined): never {
  if (!isObject(spec) || Array.isArray(spec)) throw badRequest('$throw needs {code, message, at?}');
  const name = stringField(spec, 'code');
  const message = stringField(spec, 'message');
  if (!Object.hasOwn(ERROR_CODES, name))
    throw badRequest(`$throw: unknown error code ${quote(name)}`);
  const code = name as ErrorCodeName;
  const at = spec.at;
  if (at !== undefined && code !== 'NO_SOLUTION')
    throw badRequest('$throw: only NO_SOLUTION carries "at"');
  if (at !== undefined && !isInteger(at, 0, MAX_SAFE)) {
    throw badRequest('$throw: "at" must be a non-negative integer');
  }
  throw Object.assign(new BoundaryFailure(code, message), at === undefined ? {} : { at });
}

function containsCallback(v: Wire): boolean {
  if (Array.isArray(v)) return v.some(containsCallback);
  if (!isObject(v)) return false;
  return '$cb' in v || Object.values(v).some((x) => containsCallback(x as Wire));
}

/** `$retain`: hold a model-class instance or hybrid and answer the reference naming it. */
function retain(args: Wire[], host: HostCallback | null): string {
  const value = args[0];
  const tag =
    isObject(value) && !Array.isArray(value) ? ('$class' in value ? '$class' : '$hy') : '';
  if (!isObject(value) || Array.isArray(value) || !(tag in value)) {
    throw badRequest('$retain needs a "$class" or "$hy" value');
  }
  const type = String(value[tag]);
  if (tag === '$class' && !CLASSES.includes(type)) {
    throw badRequest(`$retain: ${quote(type)} is not a model class`);
  }
  if (containsCallback(value))
    throw badRequest('$retain: a value holding callbacks cannot be held');
  const object = decodeValue(value, host, { incomplete: false });
  const id = retainValue(object as object, type, recorder === null ? undefined : value);
  return `{"${tag}":${quote(type)},"$ref":${id}}`;
}

function builtin(op: string, args: Wire[], host: HostCallback | null): string {
  switch (op) {
    case '$echo':
      return stringifyWire(args[0]);
    case '$throw':
      return throwRequested(args[0]);
    case '$counter': {
      let start = 0;
      if (!isUndefinedTag(args[0])) {
        const n = numberOf(args[0]);
        if (n === undefined) throw badRequest('$counter: start must be a number');
        start = n;
      }
      const id = newHandle({}, '$counter', { count: start, token: 0 });
      return `{"$h":${id},"$type":"$counter"}`;
    }
    case '$counter#next': {
      const counter = resolveHandle(args[0], '$counter').counter as {
        count: number;
        token: number;
      };
      counter.count += 1;
      counter.token = 0;
      return numberText(counter.count);
    }
    case '$counter#value': {
      const counter = resolveHandle(args[0], '$counter').counter as {
        count: number;
        token: number;
      };
      if (counter.token === 0) counter.token = nextToken();
      return `{"$id":${counter.token},"count":${numberText(counter.count)}}`;
    }
    case '$call': {
      const cb = args[0];
      if (!isObject(cb) || Array.isArray(cb) || !('$cb' in cb))
        throw badRequest('expected a callback');
      if (host === null) throw badRequest('callback arguments need a host callback function');
      const id = cb.$cb as number;
      const out = host(id, `[${args.slice(1).map(stringifyWire).join(',')}]`);
      if (out === undefined) throw new BoundaryFailure('CALLBACK_FAILED', `callback ${id} failed`);
      if (out === '') return '{"$u":1}';
      const result = parseWire(out, 'invalid callback result JSON: ');
      validateValue(result, true, { callbacks: 0 });
      return stringifyWire(result);
    }
    case '$retain':
      return retain(args, host);
    case '$live':
      return String(handles.size);
    case '$version':
      return `{"version":${quote(VERSION)},"algorithmVersion":${Pure.ALGORITHM_VERSION},"abiVersion":${ABI_VERSION}}`;
    default:
      throw unknownOp(op);
  }
}

// ---------------------------------------------------------------------------
// Errors.

function errorText(code: ErrorCodeName, message: string, at?: number): string {
  const tail = at === undefined ? '' : `,"at":${numberText(at)}`;
  return `{"code":"${code}","name":${quote(ERROR_NAMES[code])},"message":${quote(message)}${tail}}`;
}

function failure(error: unknown): CallReply {
  let code: ErrorCodeName = 'INTERNAL';
  let message = 'unknown exception';
  let at: number | undefined;
  if (error instanceof BoundaryFailure) {
    code = error.code;
    message = error.message;
    at = (error as { at?: number }).at;
  } else if (error instanceof CallbackFailure) {
    code = 'CALLBACK_FAILED';
    message = error.message;
  } else if (error instanceof Pure.InvalidInputError) {
    code = 'INVALID_INPUT';
    message = error.message;
  } else if (error instanceof Pure.NoSolutionError) {
    code = 'NO_SOLUTION';
    message = error.message;
    at = error.at;
  } else if (error instanceof Pure.BudgetExceededError) {
    code = 'BUDGET_EXCEEDED';
    message = error.message;
  } else if (error instanceof TypeError) {
    code = 'HOST_TYPE_ERROR';
    message = error.message;
  } else if (error instanceof Error) {
    message = error.message;
  }
  return { status: ERROR_CODES[code], json: errorText(code, message, at) };
}

// ---------------------------------------------------------------------------
// The backend.

/** One call as the corpus recorder sees it. */
export type RecordedCall = {
  op: string;
  argsJson: string;
  reply: CallReply;
  /** Whether a hybrid's payload could not be read in full, so a core could not replay it. */
  incomplete: boolean;
};

/** Receives every call when recording. */
export type Recorder = (call: RecordedCall) => void;

const recorder: Recorder | null =
  typeof process !== 'undefined' && process.env.CANTUS_RECORD === '1'
    ? (await import('../../../../tools/corpus/record.mjs')).createRecorder()
    : null;

function run(
  op: string,
  argsJson: string,
  host: HostCallback | null,
  state: EncodeState,
): CallReply {
  try {
    const parsed = argsJson === '' ? [] : parseWire(argsJson, 'invalid args JSON: ');
    if (!Array.isArray(parsed)) throw badRequest('args must be a JSON array');
    const stats = { callbacks: 0 };
    validateValue(parsed, false, stats);
    if (stats.callbacks > 0 && host === null) {
      throw badRequest('callback arguments need a host callback function');
    }
    if (op.startsWith('$') && !op.startsWith('$const:')) {
      return { status: 0, json: builtin(op, parsed, host) };
    }
    const args = parsed.map((a) => decodeValue(a, host, state));
    if (state.referenced && recorder !== null) {
      state.recorded = stringifyWire(expandRefs(parsed, state));
    }
    const { value, identity } = invoke(op, args);
    noteProvenance(op, args, value);
    state.identity = identity;
    let json = encodeValue(value, state);
    const receiver = parsed[0];
    if (
      RETAINING_RESULTS.has(op) &&
      isObject(receiver) &&
      !Array.isArray(receiver) &&
      '$ref' in receiver &&
      '$class' in receiver
    ) {
      const wire = recorder === null ? undefined : (JSON.parse(json) as Wire);
      json = `${json.slice(0, -1)},"$ref":${retainValue(value as object, String(receiver.$class), wire)}}`;
    }
    return { status: 0, json };
  } catch (error) {
    return failure(error);
  }
}

/** The pure TS backend. */
export const backend: Backend = {
  call(op: string, argsJson: string, cb: HostCallback | null): CallReply {
    const state: EncodeState = { incomplete: false };
    const reply = run(op, argsJson, cb, state);
    recorder?.({ op, argsJson: state.recorded ?? argsJson, reply, incomplete: state.incomplete });
    return reply;
  },
  release(handle: number): void {
    const entry = handles.get(handle);
    if (entry === undefined) return;
    handles.delete(handle);
    incompleteRefs.delete(handle);
  },
};
