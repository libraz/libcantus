import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CADENCE_TYPES } from '../src/analyze/functional/cadence.js';
import { HARMONIC_FUNCTIONS } from '../src/analyze/functional/function.js';
import { MELODIC_CONTOUR_SHAPES } from '../src/analyze/melody/contour.js';
import { MOTIF_RELATION_KINDS } from '../src/analyze/melody/relation.js';
import { REDUCTION_LEVELS } from '../src/analyze/reduction/index.js';
import { unionMembers } from './support/signatures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A runtime enum table, and the file/union type it is declared to derive. */
type TableCase = { table: readonly string[]; file: string; type: string };

const CASES: Record<string, TableCase> = {
  MELODIC_CONTOUR_SHAPES: {
    table: MELODIC_CONTOUR_SHAPES,
    file: 'src/analyze/melody/contour.ts',
    type: 'MelodicContourShape',
  },
  CADENCE_TYPES: {
    table: CADENCE_TYPES,
    file: 'src/analyze/functional/cadence.ts',
    type: 'CadenceType',
  },
  HARMONIC_FUNCTIONS: {
    table: HARMONIC_FUNCTIONS,
    file: 'src/analyze/functional/function.ts',
    type: 'HarmonicFunction',
  },
  REDUCTION_LEVELS: {
    table: REDUCTION_LEVELS,
    file: 'src/analyze/reduction/index.ts',
    type: 'ReductionLevel',
  },
  MOTIF_RELATION_KINDS: {
    table: MOTIF_RELATION_KINDS,
    file: 'src/analyze/melody/relation.ts',
    type: 'MotifRelationKind',
  },
};

describe('runtime enum tables match the union types they derive', () => {
  for (const [name, { table, file, type }] of Object.entries(CASES)) {
    it(`${name} lists exactly the members of ${type}`, () => {
      expect([...table]).toEqual(unionMembers(path.join(ROOT, file), type));
    });

    it(`${name} has no duplicate entries`, () => {
      expect(new Set(table).size).toBe(table.length);
    });
  }
});
