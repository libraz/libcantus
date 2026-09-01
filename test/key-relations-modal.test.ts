import { describe, expect, it } from 'vitest';
import type { KeyScale, SpelledKey } from '../src/index.js';
import {
  formatNote,
  keyRelationBetween,
  majorKey,
  minorKey,
  NAMED_SCALES,
  parseNote,
  relatedKeysOf,
  relativeKeyOf,
  scaleByName,
  spelledKeyOf,
} from '../src/index.js';

/** The relation each entry of `relatedKeysOf` reports back from the far side. */
const INVERSE_RELATION: Record<string, string> = {
  relative: 'relative',
  parallel: 'parallel',
  dominant: 'subdominant',
  subdominant: 'dominant',
  relativeOfDominant: 'relativeOfSubdominant',
  relativeOfSubdominant: 'relativeOfDominant',
};

/** The scale names whose keys these relations accept, as `KeyMode` reads them. */
const MODE_NAMES = [
  'major',
  'naturalMinor',
  'harmonicMinor',
  'melodicMinor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'locrian',
] as const;

/** How a related key is compared for duplicates: it is the sounding key. */
function soundingId(key: KeyScale): string {
  return `${key.rootPc % 12}:${key.modeMask12}`;
}

describe('relativeKeyOf counts fifths from the same origin as its siblings', () => {
  it('reads a mode through the plain key its third names', () => {
    const dDorian = scaleByName('dorian', 2);
    const relative = relativeKeyOf('D', dDorian);
    expect(formatNote(relative.tonic)).toBe('F');
    expect(relative.key).toEqual(majorKey(5));
  });

  it('leaves the plain major and minor keys where they were', () => {
    expect(formatNote(relativeKeyOf(parseNote('C'), majorKey(0)).tonic)).toBe('A');
    expect(formatNote(relativeKeyOf('Db', majorKey(1)).tonic)).toBe('Bb');
    expect(formatNote(relativeKeyOf(parseNote('A'), minorKey(9)).tonic)).toBe('C');
  });
});

describe('the six closely related keys', () => {
  it.each(MODE_NAMES)('names six distinct sounding keys in every %s key', (name) => {
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      const key = scaleByName(name, rootPc);
      const tonic = spelledKeyOf(key).tonic;
      const related = relatedKeysOf(tonic, key);
      const distinct = new Set(related.map((entry) => soundingId(entry.key)));
      expect(distinct.size, `${formatNote(tonic)} ${name}`).toBe(related.length);
    }
  });

  it.each(MODE_NAMES)('reports every relation from both sides in every %s key', (name) => {
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      const key = scaleByName(name, rootPc);
      const self: SpelledKey = { tonic: spelledKeyOf(key).tonic, key };
      for (const entry of relatedKeysOf(self.tonic, key)) {
        const far: SpelledKey = { tonic: entry.tonic, key: entry.key };
        const where = `${formatNote(self.tonic)} ${name} -> ${formatNote(entry.tonic)}`;
        expect(keyRelationBetween(self, far), where).toBe(entry.relation);
        expect(keyRelationBetween(far, self), `${where} reversed`).toBe(
          INVERSE_RELATION[entry.relation],
        );
      }
    }
  });

  it('names D dorian its own relation from C major and F major', () => {
    const dDorian: SpelledKey = { tonic: parseNote('D'), key: scaleByName('dorian', 2) };
    const cMajor: SpelledKey = { tonic: parseNote('C'), key: majorKey(0) };
    const fMajor: SpelledKey = { tonic: parseNote('F'), key: majorKey(5) };
    expect(keyRelationBetween(dDorian, fMajor)).toBe('relative');
    expect(keyRelationBetween(fMajor, dDorian)).toBe('relative');
    // C major is the relative of D dorian's dominant, and only that.
    expect(keyRelationBetween(dDorian, cMajor)).toBe('relativeOfDominant');
    expect(keyRelationBetween(cMajor, dDorian)).toBe('relativeOfSubdominant');
  });

  it('exercises only scales the library actually names', () => {
    for (const name of MODE_NAMES) {
      expect(Object.keys(NAMED_SCALES)).toContain(name);
    }
  });
});
