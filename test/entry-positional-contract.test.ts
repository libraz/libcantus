/**
 * A public entrance refuses a malformed argument in any position, not only the
 * first one that happens to be read.
 *
 * The sibling sweep fills every position with a malformed value at once, which
 * is enough to prove the error class but not enough to reach past the first
 * argument an entrance checks: an options bag given as `null` behind a valid
 * first argument, a tempo given as `null` behind a valid figure, a grid step
 * given as `null` behind a valid meter — none of those is ever reached while
 * the earlier position is refusing the call. Those are exactly the arguments a
 * host fills in from a form or a project file, one at a time.
 *
 * Reaching them needs a valid value in every other position, and the valid
 * values are synthesized from the declared types rather than tabulated: a
 * number becomes 1, a union of string literals its first member, a record its
 * required fields filled the same way, a callback a function returning a
 * synthesized result. An entrance whose signature cannot be filled that way —
 * one taking a note name, say, which no rule can guess — is left out of the
 * sweep rather than guessed at, and the count of entrances that are reached is
 * asserted so that a synthesizer which stopped working would fail rather than
 * quietly sweep nothing.
 *
 * The baseline is what makes this honest: an entrance is swept only if the call
 * with every position valid succeeds. That is the sweep checking its own
 * synthesis before it draws a conclusion from it.
 */

import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isLibcantusError } from '../src/core/errors/index.js';
import * as api from '../src/index.js';

const ROOT = resolve(__dirname, '..');
const ENTRY = resolve(ROOT, 'src/index.ts');

/** Depth at which the synthesizer stops descending into a nested record. */
const MAX_DEPTH = 4;

/** What a position was filled with when no rule could produce a valid value. */
const UNFILLABLE = Symbol('unfillable');

/** The constituents of a type, with `null` and `undefined` set aside. */
function constituents(type: ts.Type): ts.Type[] {
  const all = type.isUnion() ? type.types : [type];
  return all.filter((part) => (part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) === 0);
}

/**
 * A position this sweep does not probe, because `null` is one of the values the
 * position declares it takes.
 *
 * Three kinds: a parameter typed `unknown`, which a type guard is written to
 * take anything in; a parameter whose type names `null` itself, where `null` is
 * an ordinary value with a documented meaning; and a bare `string`, which is
 * how the message label an assertion words its error with is declared.
 */
function declaresAnything(type: ts.Type): boolean {
  const all = type.isUnion() ? type.types : [type];
  if (all.some((part) => part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) {
    return true;
  }
  if (all.some((part) => part.flags & ts.TypeFlags.Null)) {
    return true;
  }
  return constituents(type).every((part) => (part.flags & ts.TypeFlags.String) !== 0);
}

/** A value of the declared type, or {@link UNFILLABLE}. */
function synthesize(checker: ts.TypeChecker, type: ts.Type, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return UNFILLABLE;
  }
  const flags = type.flags;
  if (flags & ts.TypeFlags.BooleanLike) {
    return false;
  }
  if (type.isStringLiteral() || type.isNumberLiteral()) {
    return type.value;
  }
  if (flags & (ts.TypeFlags.Number | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    // Valid as a MIDI pitch, a pitch class, a scale degree, a bar and a beat
    // alike, which is what lets one number fill a position of any of them.
    return 1;
  }
  if (type.isUnion()) {
    for (const part of constituents(type)) {
      // A bare string is skipped in favour of a shape that can be built: the
      // union of a note name and note data is filled with the data.
      if (part.flags & ts.TypeFlags.String) {
        continue;
      }
      const value = synthesize(checker, part, depth + 1);
      if (value !== UNFILLABLE) {
        return value;
      }
    }
    return UNFILLABLE;
  }
  if (flags & ts.TypeFlags.String) {
    return UNFILLABLE;
  }
  const [signature] = type.getCallSignatures();
  if (signature !== undefined) {
    const returned = checker.getReturnTypeOfSignature(signature);
    // A callback that may answer "nothing here" is filled with one that does,
    // which is the answer every caller of it is already written to handle.
    const nothing = (returned.isUnion() ? returned.types : [returned]).some(
      (part) => part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined),
    );
    const value = nothing ? null : synthesize(checker, returned, depth + 1);
    return value === UNFILLABLE ? UNFILLABLE : () => value;
  }
  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    if (element === undefined) {
      return UNFILLABLE;
    }
    const value = synthesize(checker, element, depth + 1);
    return value === UNFILLABLE ? UNFILLABLE : [value];
  }
  if (checker.isTupleType(type)) {
    const out: unknown[] = [];
    for (const element of checker.getTypeArguments(type as ts.TypeReference)) {
      const value = synthesize(checker, element, depth + 1);
      if (value === UNFILLABLE) {
        return UNFILLABLE;
      }
      out.push(value);
    }
    return out;
  }
  if (flags & ts.TypeFlags.Object) {
    const out: Record<string, unknown> = {};
    for (const property of type.getProperties()) {
      if (property.flags & ts.SymbolFlags.Optional) {
        continue;
      }
      const declared = checker.getTypeOfSymbolAtLocation(
        property,
        property.valueDeclaration ?? (property.declarations?.[0] as ts.Declaration),
      );
      const value = synthesize(checker, declared, depth + 1);
      if (value === UNFILLABLE) {
        return UNFILLABLE;
      }
      out[property.getName()] = value;
    }
    return out;
  }
  return UNFILLABLE;
}

/** One published function, with a valid argument list and which positions to probe. */
type Entrance = { name: string; valid: unknown[]; probe: number[] };

/** Every published function whose whole argument list can be synthesized. */
function entrances(): Entrance[] {
  const config = ts.readConfigFile(resolve(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const program = ts.createProgram([ENTRY], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const entry = program.getSourceFile(ENTRY);
  if (entry === undefined) {
    throw new Error('the root barrel is missing from the program');
  }
  const barrel = checker.getSymbolAtLocation(entry);
  if (barrel === undefined) {
    throw new Error('the root barrel exports nothing');
  }
  const found: Entrance[] = [];
  for (const symbol of checker.getExportsOfModule(barrel)) {
    const name = symbol.getName();
    // A capital initial is a class or a type; both are covered elsewhere.
    if (/^[A-Z]/.test(name)) {
      continue;
    }
    const [signature] = checker.getTypeOfSymbolAtLocation(symbol, entry).getCallSignatures();
    if (signature === undefined) {
      continue;
    }
    const declared = signature
      .getParameters()
      .map((param) => checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration ?? entry));
    if (declared.length === 0) {
      continue;
    }
    const valid = declared.map((type) => synthesize(checker, type, 0));
    if (valid.includes(UNFILLABLE)) {
      continue;
    }
    found.push({
      name,
      valid,
      probe: declared.flatMap((type, index) => (declaresAnything(type) ? [] : [index])),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Positions the sweep cannot judge, with the reason each one is exempt.
 *
 * An entry here is a claim about the position, not a note that it fails.
 */
const ANSWERS_BY_DESIGN: Readonly<Record<string, string>> = {};

describe('a public entrance refuses a malformed argument in any position', () => {
  const all = entrances();
  const table = api as Record<string, unknown>;

  /** The entrances whose all-valid call succeeds, so a probe of one position means something. */
  const baselined = all.filter(({ name, valid }) => {
    const entrance = table[name];
    if (typeof entrance !== 'function') {
      return false;
    }
    try {
      (entrance as (...given: unknown[]) => unknown)(...valid);
      return true;
    } catch {
      return false;
    }
  });

  it('synthesizes a working call for the entrances it sweeps', () => {
    // Derived on both sides: the synthesizer losing a rule shows up as a drop
    // here rather than as a sweep that silently stopped reaching anything.
    expect(all.length).toBeGreaterThan(200);
    expect(baselined.length).toBeGreaterThan(150);
    expect(baselined.reduce((count, { probe }) => count + probe.length, 0)).toBeGreaterThan(300);
  });

  it('refuses a null in every position that does not declare one', () => {
    const answered: string[] = [];
    for (const { name, valid, probe } of baselined) {
      const entrance = table[name] as (...given: unknown[]) => unknown;
      for (const index of probe) {
        if (`${name}#${index}` in ANSWERS_BY_DESIGN) {
          continue;
        }
        const args = [...valid];
        args[index] = null;
        try {
          const value = entrance(...args);
          answered.push(`${name}#${index} answered ${JSON.stringify(value)?.slice(0, 60)}`);
        } catch (error) {
          if (!isLibcantusError(error)) {
            answered.push(`${name}#${index}: ${(error as Error).constructor.name}`);
          }
        }
      }
    }
    expect(answered).toEqual([]);
  });

  it('lists nothing as exempt that the sweep no longer reaches', () => {
    const reached = new Set(
      baselined.flatMap(({ name, probe }) => probe.map((index) => `${name}#${index}`)),
    );
    expect(Object.keys(ANSWERS_BY_DESIGN).filter((key) => !reached.has(key))).toEqual([]);
  });
});
