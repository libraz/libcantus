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
 * number becomes 1, a union of string literals its first member, a record or an
 * intersection its required fields filled the same way, a type parameter a
 * value of its constraint, a callback a function returning a synthesized
 * result.
 *
 * One kind of value does not follow from its type: a bare `string`. A note
 * name, a chord symbol, a time signature and a roman numeral are all spelled
 * `string`, so the type says nothing about which of them a position wants.
 * Rather than tabulate that per function, the sweep tries each member of a
 * short list of domain spellings and keeps whichever one the entrance accepts.
 *
 * The baseline is what makes all of this honest: an entrance is swept only if
 * the call with every position valid succeeds. A synthesized shape that is
 * wrong, or a seed that names the wrong domain, drops the entrance from the
 * sweep instead of producing a verdict from a call that never worked. The
 * counts of what the sweep reaches are asserted, so a synthesizer that lost a
 * rule fails here rather than quietly sweeping less.
 */

import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isLibcantusError } from '../src/core/errors/index.js';
import * as api from '../src/index.js';

const ROOT = resolve(__dirname, '..');
const ENTRY = resolve(ROOT, 'src/index.ts');

/**
 * Depth at which the synthesizer stops descending into a nested record.
 *
 * A type that contains itself would otherwise never bottom out. The bound is
 * deep enough for the deepest required chain the package publishes — a timeline
 * holds segments, a segment holds a chord, a chord holds a quality, and each of
 * those is reached through an array or a union that costs a level of its own.
 */
const MAX_DEPTH = 8;

/** What a position was filled with when no rule could produce a valid value. */
const UNFILLABLE = Symbol('unfillable');

/**
 * The spellings tried for a position declared as a bare `string`.
 *
 * These are the domains the package parses text in: a note name, a time
 * signature, an interval, a roman numeral, a figured-bass figure. An
 * entrance is filled with the first of them it accepts, which is why the list
 * can be short and shared rather than written out per function — and why a
 * wrong guess costs nothing, since the baseline drops any entrance that no seed
 * satisfies. A seed no entrance needs is a stale entry, and is asserted against.
 */
const SEEDS = ['C', '4/4', 'M3', 'I', '6'] as const;

/**
 * Shapes the package is asked to build, for positions whose fields have to
 * agree with one another.
 *
 * Filling a record field by field is only sound when the fields are
 * independent, and several of these are not: a spelled key's tonic has to spell
 * its root, so `{ rootPc: 1, tonic: C }` is a contradiction rather than a key;
 * a spelled interval's quality has to match its span; a note that is going to
 * become a MIDI pitch needs the octave that a note name may leave out. No rule
 * that writes one field at a time can avoid writing a value like that.
 *
 * The way out is not to invent the value but to ask the package for one. Each
 * seed is a call to a published entrance, and the type it stands for is read
 * from that entrance's own signature, so a seed cannot drift from the shape it
 * fills. A position takes a seed when the seed's declared type is assignable to
 * the position's — which is the type checker deciding, not this list.
 *
 * Seeds are a fallback: an entrance whose synthesized arguments already work is
 * left alone, so a seed only ever rescues a position no rule could fill
 * correctly. One that rescues nothing is a stale entry, and is asserted against.
 */
const TYPED_SEEDS: Readonly<Record<string, () => unknown>> = {
  majorKey: () => api.majorKey(0),
  resolveKey: () => api.resolveKey('C'),
  parseInterval: () => api.parseInterval('M3'),
  parseNote: () => api.parseNote('C4'),
  parseChordSymbol: () => api.parseChordSymbol('C'),
  chordSpecOf: () => api.chordSpecOf(api.parseChordSymbol('C')),
};

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

/** One of the spellings a bare `string` is tried with. */
type Seed = (typeof SEEDS)[number];

/** One of {@link TYPED_SEEDS}, with the type its entrance declares it returns. */
type TypedSeed = { name: string; type: ts.Type; make: () => unknown };

/**
 * The seeds of the current pass, and what the pass actually needed from them.
 *
 * An entrance that never reaches a bare `string` synthesizes the same argument
 * list under every seed, so recording the use lets the sweep try the rest only
 * where trying them can change the answer. The typed seeds are recorded the
 * same way and for the same reason.
 */
type Fill = { seed: Seed; used: boolean; typed: readonly TypedSeed[]; usedTyped: Set<string> };

/** A value of the declared type, or {@link UNFILLABLE}. */
function synthesize(checker: ts.TypeChecker, type: ts.Type, depth: number, fill: Fill): unknown {
  if (depth > MAX_DEPTH) {
    return UNFILLABLE;
  }
  for (const seed of fill.typed) {
    if (checker.isTypeAssignableTo(seed.type, type)) {
      fill.usedTyped.add(seed.name);
      return seed.make();
    }
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
  if (flags & ts.TypeFlags.TypeParameter) {
    // What a generic position takes is what its constraint takes: the rhythm
    // transforms are written over `T extends GridEvent`, so a grid event fills
    // them. An unconstrained parameter says nothing, and stays unfillable.
    const constraint = checker.getBaseConstraintOfType(type);
    return constraint === undefined ? UNFILLABLE : synthesize(checker, constraint, depth + 1, fill);
  }
  if (type.isUnion()) {
    for (const part of constituents(type)) {
      // A bare string is skipped in favour of a shape that can be built: the
      // union of a note name and note data is filled with the data.
      if (part.flags & ts.TypeFlags.String) {
        continue;
      }
      const value = synthesize(checker, part, depth + 1, fill);
      if (value !== UNFILLABLE) {
        return value;
      }
    }
    return UNFILLABLE;
  }
  if (flags & ts.TypeFlags.String) {
    fill.used = true;
    return fill.seed;
  }
  const [signature] = type.getCallSignatures();
  if (signature !== undefined) {
    const returned = checker.getReturnTypeOfSignature(signature);
    // A callback that may answer "nothing here" is filled with one that does,
    // which is the answer every caller of it is already written to handle.
    const nothing = (returned.isUnion() ? returned.types : [returned]).some(
      (part) => part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined),
    );
    const value = nothing ? null : synthesize(checker, returned, depth + 1, fill);
    return value === UNFILLABLE ? UNFILLABLE : () => value;
  }
  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    if (element === undefined) {
      return UNFILLABLE;
    }
    const value = synthesize(checker, element, depth + 1, fill);
    return value === UNFILLABLE ? UNFILLABLE : [value];
  }
  if (checker.isTupleType(type)) {
    const out: unknown[] = [];
    for (const element of checker.getTypeArguments(type as ts.TypeReference)) {
      const value = synthesize(checker, element, depth + 1, fill);
      if (value === UNFILLABLE) {
        return UNFILLABLE;
      }
      out.push(value);
    }
    return out;
  }
  // An intersection is read the same way as a record: it is the fields of all
  // of its members, which is how the options bags extend a shared one.
  if (flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) {
    const out: Record<string, unknown> = {};
    for (const property of type.getProperties()) {
      if (property.flags & ts.SymbolFlags.Optional) {
        continue;
      }
      const declared = checker.getTypeOfSymbolAtLocation(
        property,
        property.valueDeclaration ?? (property.declarations?.[0] as ts.Declaration),
      );
      const value = synthesize(checker, declared, depth + 1, fill);
      if (value === UNFILLABLE) {
        return UNFILLABLE;
      }
      out[property.getName()] = value;
    }
    return out;
  }
  return UNFILLABLE;
}

/** One published function, the argument lists to try, and which positions to probe. */
type Entrance = {
  name: string;
  fills: { seed: Seed; valid: unknown[]; usedTyped: string[] }[];
  /** Whether any position was filled from a seed, so which seed won says something. */
  seeded: boolean;
  probe: number[];
};

/**
 * What one parameter declares it takes, as a value the caller writes.
 *
 * A rest parameter declares an array, but a caller fills it one argument at a
 * time, so the position stands for one element of it. Reading the element type
 * here is what keeps a position meaning the same thing on both sides: the
 * value it is filled with, and the `null` it is probed with.
 */
function positionType(checker: ts.TypeChecker, param: ts.Symbol, entry: ts.SourceFile): ts.Type {
  const declared = checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration ?? entry);
  const declaration = param.valueDeclaration;
  if (
    declaration !== undefined &&
    ts.isParameter(declaration) &&
    declaration.dotDotDotToken !== undefined &&
    checker.isArrayType(declared)
  ) {
    return checker.getTypeArguments(declared as ts.TypeReference)[0] ?? declared;
  }
  return declared;
}

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
  const exported = checker.getExportsOfModule(barrel);
  const returnTypeOf = (name: string): ts.Type => {
    const symbol = exported.find((one) => one.getName() === name);
    const [signature] = symbol
      ? checker.getTypeOfSymbolAtLocation(symbol, entry).getCallSignatures()
      : [];
    if (signature === undefined) {
      throw new Error(`the seed ${name} names no published function`);
    }
    return checker.getNonNullableType(checker.getReturnTypeOfSignature(signature));
  };
  const typed: TypedSeed[] = Object.entries(TYPED_SEEDS).map(([name, make]) => ({
    name,
    type: returnTypeOf(name),
    make,
  }));

  const found: Entrance[] = [];
  for (const symbol of exported) {
    const name = symbol.getName();
    // A capital initial is a class or a type; both are covered elsewhere.
    if (/^[A-Z]/.test(name)) {
      continue;
    }
    const [signature] = checker.getTypeOfSymbolAtLocation(symbol, entry).getCallSignatures();
    if (signature === undefined) {
      continue;
    }
    const declared = signature.getParameters().map((param) => positionType(checker, param, entry));
    if (declared.length === 0) {
      continue;
    }
    const fills: Entrance['fills'] = [];
    let seeded = false;
    // The structural round first, so a seed is only ever what rescues a
    // position no rule could fill: an entrance whose own shapes work is filled
    // with them, and its verdict does not depend on this list at all.
    for (const round of [[], typed]) {
      for (const seed of SEEDS) {
        const fill: Fill = { seed, used: false, typed: round, usedTyped: new Set() };
        const valid = declared.map((type) => synthesize(checker, type, 0, fill));
        if (!valid.includes(UNFILLABLE)) {
          fills.push({ seed, valid, usedTyped: [...fill.usedTyped] });
        }
        seeded ||= fill.used;
        if (!fill.used) {
          // The seed made no difference here, so the other seeds cannot either.
          break;
        }
      }
    }
    if (fills.length === 0) {
      continue;
    }
    found.push({
      name,
      fills,
      seeded,
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

  /** The entrances whose all-valid call succeeds, with the fill that made it succeed. */
  const baselined = all.flatMap(({ name, fills, seeded, probe }) => {
    const entrance = table[name];
    if (typeof entrance !== 'function') {
      return [];
    }
    for (const { seed, valid, usedTyped } of fills) {
      try {
        (entrance as (...given: unknown[]) => unknown)(...valid);
        return [{ name, seed, seeded, usedTyped, valid, probe }];
      } catch {
        // Not this domain; the next fill is tried.
      }
    }
    return [];
  });

  it('synthesizes a working call for the entrances it sweeps', () => {
    // Derived on both sides: the synthesizer losing a rule shows up as a drop
    // here rather than as a sweep that silently stopped reaching anything.
    expect(all.length).toBeGreaterThan(280);
    expect(baselined.length).toBeGreaterThan(275);
    expect(baselined.reduce((count, { probe }) => count + probe.length, 0)).toBeGreaterThan(525);
  });

  it('needs every seed it lists', () => {
    // A seed no entrance is filled from is a spelling the package no longer
    // parses, or a shape no position needs any more — either way the list
    // should lose it rather than keep standing for a domain nothing asks about.
    const winners = new Set(baselined.filter((one) => one.seeded).map(({ seed }) => seed));
    expect(SEEDS.filter((seed) => !winners.has(seed))).toEqual([]);
    const rescued = new Set(baselined.flatMap(({ usedTyped }) => usedTyped));
    expect(Object.keys(TYPED_SEEDS).filter((name) => !rescued.has(name))).toEqual([]);
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
