import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resolveContext } from '../src/generate/context/index.js';
import { selectFillType } from '../src/generate/drums/fills.js';
import { getKickPattern } from '../src/generate/drums/kick.js';

/** Digest of every fill selection across the transition contexts. */
function fillDigest(): string {
  const hash = createHash('sha256');
  const froms: Parameters<typeof selectFillType>[0][] = ['intro', 'a', 'b', 'chorus', 'bridge'];
  const tos: Parameters<typeof selectFillType>[1][] = ['chorus', 'a', 'outro', 'b'];
  const styles: Parameters<typeof selectFillType>[2][] = [
    'sparse',
    'standard',
    'rock',
    'fourOnFloor',
    'upbeat',
    'synth',
    'trap',
    'latin',
  ];
  const energies: Parameters<typeof selectFillType>[3][] = ['low', 'medium', 'high', 'peak'];
  for (const from of froms) {
    for (const to of tos) {
      for (const style of styles) {
        for (const energy of energies) {
          for (let seed = 0; seed < 32; seed += 1) {
            const fill = selectFillType(
              from,
              to,
              style,
              energy,
              resolveContext(seed).part('drums'),
              seed % 4,
            );
            hash.update(fill ?? '');
            hash.update('|');
          }
        }
      }
    }
  }
  return hash.digest('hex');
}

describe('moving the drum vocabulary into data', () => {
  it('leaves every fill selection exactly as it was', () => {
    expect(fillDigest()).toBe('64a71488600be2a90ca0e16d209b44ece77a02fdec1cb4675a97bbf9bbb508fd');
  });
});

describe('the sixteenth kick grid', () => {
  const draw = resolveContext(3).part('drums');

  it('is sixteen steps wide', () => {
    expect(getKickPattern('chorus', 'rock', 0, draw, 0.5)).toHaveLength(16);
  });

  it('puts the eighth-note patterns on the even steps', () => {
    const pattern = getKickPattern('a', 'standard', 0, draw, 0.5);
    expect(pattern[0]).toBe(true);
    expect(pattern[8]).toBe(true);
    // Nothing lands on an odd sixteenth: the inherited figures are eighth-note
    // figures, and moving the grid under them did not move them.
    expect(pattern.filter((on, step) => on && step % 2 === 1)).toEqual([]);
  });
});

describe('a caller-supplied drum dictionary', () => {
  it('gives a caller fill that reuses a built-in id the built-in weight, not both', () => {
    // Reusing an id is a replacement everywhere else in the vocabulary model:
    // the material is read through the caller's map wherever the table names
    // it, so offering it again as an extra candidate would hand that one fill a
    // weight no other entry has and let it dominate the phrase ends.
    const draw = resolveContext(5).part('drums');
    for (let bar = 0; bar < 16; bar += 1) {
      const plain = selectFillType('a', 'chorus', 'standard', 'high', draw, bar);
      const collided = selectFillType('a', 'chorus', 'standard', 'high', draw, bar, ['snareRoll']);
      expect(collided, `bar ${bar}`).toBe(plain);
    }
    // An id the library does not carry is an addition, and does change the odds.
    const added = new Set<string | undefined>();
    for (let bar = 0; bar < 16; bar += 1) {
      added.add(selectFillType('a', 'chorus', 'standard', 'high', draw, bar, ['callerFill']));
    }
    expect(added.has('callerFill')).toBe(true);
  });
});
