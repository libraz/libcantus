import { describe, expect, it } from 'vitest';
import { formatNote, noteToPitchClass } from '../src/core/pitch/index.js';
import { Key } from '../src/model/index.js';
import {
  type KeyRelation,
  keySignatureFifths,
  majorKey,
  minorKey,
  relatedKeysOf,
  type SpelledKey,
  scaleByName,
  spelledKeyOf,
} from '../src/theory/scale/index.js';

/**
 * The reasoning `relatedKeysOf` and {@link Key.relatedKeys} give for their set,
 * asserted as behaviour rather than as prose.
 *
 * Both surfaces explain membership by naming the teaching tradition and then
 * saying what separates the parallel key from the other five: five are written
 * within one accidental of this key's own signature, while the parallel stands
 * three away and belongs for the tonic it shares. Those are measurable facts,
 * so a doc that drifts back to explaining the whole set by signature distance
 * is contradicted here instead of only reading wrongly.
 */

/** Every key the relations are defined for, diatonic modes and minor forms alike. */
function everyKey(): SpelledKey[] {
  const keys: SpelledKey[] = [];
  for (let rootPc = 0; rootPc < 12; rootPc += 1) {
    for (const key of [
      majorKey(rootPc),
      minorKey(rootPc),
      scaleByName('harmonicMinor', rootPc),
      scaleByName('melodicMinor', rootPc),
    ]) {
      keys.push(spelledKeyOf(key));
    }
  }
  return keys;
}

/** How far a relation's signature stands from the key's own, in accidentals. */
const SIGNATURE_DISTANCE: Readonly<Record<KeyRelation, number | undefined>> = {
  same: 0,
  relative: 0,
  parallel: 3,
  dominant: 1,
  subdominant: 1,
  relativeOfDominant: 1,
  relativeOfSubdominant: 1,
  enharmonic: undefined,
};

describe('the closely related keys are what the docs say they are', () => {
  it('places five of the six within one accidental and the parallel three away', () => {
    let checked = 0;
    for (const { tonic, key } of everyKey()) {
      const own = keySignatureFifths(tonic, key);
      const where = `${formatNote(tonic)} ${key.modeMask12}`;
      for (const related of relatedKeysOf(tonic, key)) {
        const distance = Math.abs(keySignatureFifths(related.tonic, related.key) - own);
        expect(distance, `${where} -> ${related.relation}`).toBe(
          SIGNATURE_DISTANCE[related.relation],
        );
        checked += 1;
      }
    }
    expect(checked).toBe(everyKey().length * 6);
  });

  it('makes a shared tonic the mark of the parallel key alone', () => {
    for (const { tonic, key } of everyKey()) {
      const where = `${formatNote(tonic)} ${key.modeMask12}`;
      for (const related of relatedKeysOf(tonic, key)) {
        const shares = noteToPitchClass(related.tonic) === noteToPitchClass(tonic);
        expect(shares, `${where} -> ${related.relation}`).toBe(related.relation === 'parallel');
      }
    }
  });

  it('says the same thing through the class API', () => {
    for (const { key } of everyKey()) {
      // No tonic is passed: the class spells one the same way `spelledKeyOf`
      // does, so both surfaces are asked about the same key.
      const wrapped = Key.of(key);
      const own = wrapped.fifths;
      for (const related of wrapped.relatedKeys()) {
        const distance = Math.abs(related.key.fifths - own);
        expect(distance, `${wrapped} -> ${related.relation}`).toBe(
          SIGNATURE_DISTANCE[related.relation],
        );
        expect(related.key.rootPc === wrapped.rootPc, `${wrapped} -> ${related.relation}`).toBe(
          related.relation === 'parallel',
        );
      }
    }
  });
});
