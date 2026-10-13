import { describe, expect, it } from 'vitest';
import { appliedTarget } from '../src/analyze/functional/tonicization.js';
import { parseNote } from '../src/core/pitch/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { crossRelations } from '../src/theory/partwriting/cross-relation.js';
import { NAMED_SCALES, type ScaleName, scaleByName } from '../src/theory/scale/index.js';

describe('the part-writing licence and the analysis read one list of tonicizable degrees', () => {
  /**
   * Two voicings holding a cross relation whatever chords they are said to be:
   * the alto's Eb is contradicted by the soprano's E natural, a contradiction
   * sprung rather than led into and exposed in an outer voice. Neither voicing
   * writes a sixth above its bass, so nothing here can read as an augmented
   * sixth in any key, and the only exemption left to be had is the applied
   * dominant's.
   */
  const CONTRADICTION = {
    from: ['C3', 'Eb3', 'G4'].map((name) => parseNote(name)),
    to: ['C3', 'F3', 'E4'].map((name) => parseNote(name)),
  };

  it('exempts the chromatic tone exactly where a degree can be tonicized', () => {
    // The checker exempts a cross relation the applied dominant brings with it,
    // and the analysis names the degree that dominant tonicizes. Both read one
    // list, so a chord let through the rule is one an applied numeral can be
    // written for, in every scale the library names.
    const divergences: string[] = [];
    const swept = new Set<ScaleName>();
    let exempted = 0;
    let reported = 0;
    for (const name of Object.keys(NAMED_SCALES) as ScaleName[]) {
      for (let tonic = 0; tonic < 12; tonic += 1) {
        const key = scaleByName(name, tonic);
        swept.add(name);
        for (let degree = 0; degree < 12; degree += 1) {
          const target = (tonic + degree) % 12;
          const applied = makeChord((target + 7) % 12, 'dom7');
          const licensed =
            crossRelations(
              { notes: CONTRADICTION.from, chord: makeChord(key.rootPc, 'min') },
              { notes: CONTRADICTION.to, chord: applied },
              key,
              { after: makeChord(target, 'maj') },
            ).length === 0;
          const tonicized = appliedTarget(applied, key)?.rootPc === target;
          if (licensed !== tonicized) {
            divergences.push(`${name} on ${tonic}: the chord over pitch class ${target}`);
          }
          if (licensed) {
            exempted += 1;
          } else {
            reported += 1;
          }
        }
      }
    }
    // The sweep is the whole registry rather than a written list, and it saw
    // the rule both grant the exemption and withhold it, so an empty divergence
    // list means the two layers were actually put to the question.
    expect(swept.size).toBe(Object.keys(NAMED_SCALES).length);
    expect(exempted).toBeGreaterThan(0);
    expect(reported).toBeGreaterThan(0);
    expect(divergences).toEqual([]);
  });
});
