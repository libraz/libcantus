import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { functionParams, recordFields } from './support/signatures.js';
import { filesUnder, SRC } from './support/source-files.js';

/** The parameter and option-field names by which the library names a meter. */
const METER_NAMES = new Set(['ts', 'meter', 'meters']);

/**
 * Type names by which the library names a record of caller input.
 *
 * A meter field on one of these is an entry point's argument and so takes every
 * form a meter is written in; a meter field anywhere else — a meter map entry, a
 * groove template, a vocabulary entry — is data the library hands out or reads
 * back, and stays the plain shape it is documented as.
 */
const INPUT_RECORD = /(?:Options|Query|Settings|Input)$/;

/**
 * The files a caller's own meter can reach.
 *
 * Internal modules are excluded by path rather than by name: they are the
 * library's own reads, taken after the boundary has already resolved the
 * caller's value, and are not a surface anyone passes a signature name to.
 */
const PUBLIC_SOURCES = filesUnder(SRC, '.ts').filter((file) => !file.endsWith('internal.ts'));

/**
 * Whether a function is one of the guards or copiers that work in the resolved
 * plain shape by definition — a validator of a time signature cannot take the
 * text form it exists to reject.
 */
function definesPlainShape(name: string): boolean {
  return name.startsWith('assert') || name.startsWith('copy');
}

/**
 * Every meter-shaped declaration the public surface asks a caller to fill.
 *
 * The walk is the shared one, so the parameters read here are the same set the
 * entry-contract check reads — free functions and public class members alike —
 * rather than a second walk that drifts from it.
 */
function meterDeclarations(): { site: string; declared: string }[] {
  const fromParameters = functionParams(PUBLIC_SOURCES)
    .filter((param) => param.exported && param.type !== '')
    .filter((param) => METER_NAMES.has(param.param) && !definesPlainShape(param.fn))
    .map((param) => ({
      site: `${param.file}:${param.line} ${param.fn}(${param.param})`,
      declared: param.type,
    }));
  const fromFields = recordFields(PUBLIC_SOURCES)
    .filter((field) => field.exported && INPUT_RECORD.test(field.record))
    .filter((field) => METER_NAMES.has(field.field))
    .map((field) => ({
      site: `${field.file}:${field.line} ${field.record}.${field.field}`,
      declared: field.type,
    }));
  return [...fromParameters, ...fromFields];
}

describe('meter argument contract', () => {
  it('declares every meter a caller names as MeterLike', () => {
    // Derived from the sources rather than listed: an entry point added with a
    // narrower meter parameter is exactly the split acceptance domain this
    // guards against, and a list would only ever describe the entry points
    // somebody remembered.
    const declarations = meterDeclarations();
    expect(declarations.length).toBeGreaterThan(10);
    const narrower = declarations
      .filter((declaration) => !/\bMeterLike\b/.test(declaration.declared))
      .map((declaration) => `${declaration.site}: ${declaration.declared}`)
      .sort();
    expect(narrower).toEqual([]);
  });
});

/**
 * The model layer resolves a meter argument through the one function that does
 * it, rather than each class through a private copy of the mapping.
 *
 * `Score`, `Composer` and `Arrangement` each held their own `metersFrom`, all
 * three equivalent to `resolveMeters` and all three a place a later edit could
 * make one class wrap, default, copy or label a meter differently from its
 * siblings. The check reads the tree so a fourth copy cannot be added quietly,
 * and asserts the three answer alike so removing the copies cannot be undone by
 * reintroducing one under another name.
 */
describe('a meter argument is resolved in one place across the model layer', () => {
  it('holds no private meter mapping in the model layer', () => {
    // The mapping lives in `core/meter`; a model file that rebuilt it locally is
    // a second answer to how a caller's meter becomes the map a class holds.
    const offenders = filesUnder(path.join(SRC, 'model'), '.ts')
      .filter((file) => /function\s+metersFrom\b/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(path.dirname(SRC), file));

    expect(offenders).toEqual([]);
  });
});
