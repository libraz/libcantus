/**
 * A public entrance answers from what it was given, or refuses.
 *
 * The rejection contract says that whatever comes back out of an entrance is
 * one of this library's error classes rather than a raw `TypeError`. It says
 * nothing about an entrance that does not throw at all, and that is the other
 * half: JavaScript coerces on the way into arithmetic, so `Math.abs(null)` is
 * zero, `null >> 3` is zero, and a switch that ends in a default answers
 * whatever the last case says. An entrance reading a value that way returns a
 * musical claim — a unison, a modal key, an off-pulse weight — about input it
 * never read, and the caller has no way to tell that answer from a real one.
 *
 * The subject is derived from the declared parameter types rather than listed.
 * A parameter says what it takes, so what does not belong in it follows: a
 * `number` is offered a `null`, a `number[]` an array holding one, a union of
 * string literals a name that is in no union, and a record with a required
 * field an object without it. That is what removes the need for a table of
 * valid arguments — the malformed value for each position comes from the
 * position's own type, and an entrance whose signature changes is probed under
 * the new signature on the run that changes it.
 */

import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isLibcantusError } from '../src/core/errors/index.js';
import * as api from '../src/index.js';

const ROOT = resolve(__dirname, '..');
const ENTRY = resolve(ROOT, 'src/index.ts');

/**
 * What kind of value a parameter takes, as far as this sweep can tell.
 *
 * `'.'` is everything the sweep has no malformed value for — a union of several
 * shapes, a callback, an options record with nothing required. Those positions
 * are still filled, with `null`, so an entrance is called with every argument
 * it declares; they just do not decide whether it is swept.
 */
type Kind = 'number' | 'numbers' | 'name' | 'record' | '.';

/** The malformed value offered to a position of each kind. */
const MALFORMED: Readonly<Record<Kind, unknown>> = {
  number: null,
  numbers: [null],
  name: 'not a name this library defines',
  record: {},
  '.': null,
};

/** The constituents of a type, with `null` and `undefined` set aside. */
function constituents(type: ts.Type): ts.Type[] {
  const all = type.isUnion() ? type.types : [type];
  return all.filter((part) => (part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) === 0);
}

/** Which kind of value a parameter's declared type takes. */
function kindOf(checker: ts.TypeChecker, type: ts.Type): Kind {
  const parts = constituents(type);
  const only = parts[0];
  if (only === undefined) {
    return '.';
  }
  if (parts.every((part) => (part.flags & ts.TypeFlags.Number) !== 0)) {
    return 'number';
  }
  if (parts.every((part) => part.isStringLiteral())) {
    return 'name';
  }
  if (parts.length > 1) {
    return '.';
  }
  if (/^(readonly )?number\[\]$/.test(checker.typeToString(only))) {
    return 'numbers';
  }
  // A record is only offered an empty object where the empty object is not one
  // of its own values: an options bag whose every field is optional is answered
  // by `{}` because `{}` is a lawful way to ask for the defaults.
  if (
    (only.flags & ts.TypeFlags.Object) !== 0 &&
    only.getCallSignatures().length === 0 &&
    !checker.isArrayType(only) &&
    only.getProperties().some((prop) => (prop.flags & ts.SymbolFlags.Optional) === 0)
  ) {
    return 'record';
  }
  return '.';
}

/** Every published function, with the kind of value each parameter takes. */
function entrances(): { name: string; kinds: Kind[] }[] {
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
  const found: { name: string; kinds: Kind[] }[] = [];
  for (const symbol of checker.getExportsOfModule(barrel)) {
    const name = symbol.getName();
    // A capital initial is a class or a type; both are covered elsewhere.
    if (/^[A-Z]/.test(name)) {
      continue;
    }
    const signature = checker.getTypeOfSymbolAtLocation(symbol, entry).getCallSignatures()[0];
    if (signature === undefined) {
      continue;
    }
    found.push({
      name,
      kinds: signature
        .getParameters()
        .map((param) =>
          kindOf(
            checker,
            checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration ?? entry),
          ),
        ),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Entrances the sweep cannot judge, with the reason each one is exempt.
 *
 * An entry here is a claim that answering is what the entrance says it does,
 * which the sweep has no way to read off a signature.
 */
const ANSWERS_BY_DESIGN: Readonly<Record<string, string>> = {};

describe('a public entrance does not answer from a value it never read', () => {
  const all = entrances();
  const swept = all.filter(({ kinds }) => kinds.some((kind) => kind !== '.'));

  it('finds the entrances to sweep', () => {
    // Both counts are derived, so a classifier that stopped recognising a kind
    // would shrink the sweep rather than fail it, and the check below would
    // pass over less and less without anyone noticing.
    expect(all.length).toBeGreaterThan(250);
    expect(swept.length).toBeGreaterThan(150);
  });

  it('refuses the malformed value each declared parameter names', () => {
    const table = api as Record<string, unknown>;
    const answered: string[] = [];
    for (const { name, kinds } of swept) {
      if (name in ANSWERS_BY_DESIGN) {
        continue;
      }
      const entrance = table[name];
      if (typeof entrance !== 'function') {
        continue;
      }
      const args = kinds.map((kind) => MALFORMED[kind]);
      try {
        const value = (entrance as (...given: unknown[]) => unknown)(...args);
        answered.push(`${name}(${kinds.join(', ')}) answered ${JSON.stringify(value)}`);
      } catch (error) {
        if (!isLibcantusError(error)) {
          answered.push(`${name}: ${(error as Error).constructor.name}`);
        }
      }
    }
    expect(answered).toEqual([]);
  });

  it('lists nothing as exempt that the sweep no longer reaches', () => {
    const reached = new Set(swept.map(({ name }) => name));
    expect(Object.keys(ANSWERS_BY_DESIGN).filter((name) => !reached.has(name))).toEqual([]);
  });
});
