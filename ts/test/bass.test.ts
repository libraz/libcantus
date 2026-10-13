import { describe, expect, it } from 'vitest';
import {
  BASS_4_STRING,
  BASS_5_STRING,
  foldIntoRange,
  type StringedProfile,
} from '../src/core/instrument/index.js';
import { isStrongBeat, type TimeSignature } from '../src/core/meter/index.js';
import { type BassSegment, type BassStyle, generateBassLine } from '../src/generate/bass/index.js';
import { bandFloor, placeRoot } from '../src/generate/bass/internal.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };

/**
 * Where a chord sounds its bass in a generated line: the band placement, as the
 * instrument leaves it.
 *
 * This is the note a pickup must not be, and it is derived the way the line
 * derives it rather than read back off the output — a segment whose every note
 * is a pickup still has to be measured against the right note.
 */
function soundingRoot(
  rootPc: number,
  octave: number,
  instrument: StringedProfile | undefined,
): number {
  const placed = placeRoot(rootPc, bandFloor(octave * 12 + 12, instrument));
  return instrument ? foldIntoRange(placed, instrument) : placed;
}

describe('a chord written over a bass is played as the inversion it is', () => {
  /** Every inversion of a seventh chord, one chord per segment. */
  function inversions(rootPc: number): BassSegment[] {
    return chordPitchClasses(makeChord(rootPc, 'dom7'))
      .filter((pc) => pc !== rootPc % 12)
      .map((bassPc, index) => ({
        startBeat: index * 4,
        endBeat: index * 4 + 4,
        chord: makeChord(rootPc, 'dom7', bassPc),
      }));
  }

  it('sounds no tone of the chord under the bass the chord names', () => {
    // The band is one octave wide, so folding the chord's other tones into it
    // put them under a bass placed anywhere but the bottom of it: the C of a
    // C/E came out below its own E, which is a root-position C. Reading such a
    // line back through this library reported a chord the part was not written
    // on. The walking style's last note of a segment is the approach into the
    // next chord and is left out, as the style's own reading is.
    for (const style of ['root', 'rootFifth', 'arpeggio', 'pop', 'walking'] as BassStyle[]) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const segments = inversions(rootPc);
        const notes = generateBassLine({ segments, key: cMajor, style, ctx: 3 });
        for (const segment of segments) {
          const bass = placeRoot(
            segment.chord.bassPc ?? segment.chord.rootPc,
            bandFloor(36, undefined),
          );
          const inSegment = notes.filter(
            (note) =>
              note.startBeat >= segment.startBeat - 1e-9 && note.startBeat < segment.endBeat - 1e-9,
          );
          const own =
            style === 'walking' ? inSegment.slice(0, Math.max(0, inSegment.length - 1)) : inSegment;
          for (const note of own) {
            // The pop style's pickup is the bass an octave below itself, which
            // is the one note written under the bass on purpose.
            if (style === 'pop' && note.pitch === bass - 12) {
              continue;
            }
            expect(
              note.pitch,
              `${style} ${rootPc}/${segment.chord.bassPc} at ${note.startBeat}`,
            ).toBeGreaterThanOrEqual(bass);
          }
        }
      }
    }
  });
});

describe("the pop style's weak-beat pickup", () => {
  it('is never the note already sounding under it, on any instrument or register', () => {
    // The pickup drops an octave below the band, and the band is one octave
    // wide: on an instrument with nothing under it the drop folds straight back
    // onto the root and the pickup becomes a repeated note. A four-string bass
    // has no C, C#, D or D# below its E — between them most of the keys pop is
    // written in — and `Instrument.bass4()` is the example the class layer's own
    // documentation gives.
    let seen = 0;
    for (const instrument of [undefined, BASS_4_STRING, BASS_5_STRING]) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        for (const octave of [1, 2, 3]) {
          for (let seed = 0; seed < 8; seed += 1) {
            const segments: BassSegment[] = [
              { startBeat: 0, endBeat: 4, chord: makeChord(rootPc, 'maj') },
            ];
            const notes = generateBassLine({
              segments,
              key: cMajor,
              style: 'pop',
              octave,
              instrument,
              ctx: { seed, complexity: { rhythmic: 1 } },
            });
            const root = soundingRoot(rootPc, octave, instrument);
            for (const note of notes) {
              if (isStrongBeat(note.startBeat, FOUR_FOUR)) {
                continue;
              }
              seen += 1;
              expect(
                note.pitch,
                `pc ${rootPc} / octave ${octave} / seed ${seed} @${note.startBeat}`,
              ).not.toBe(root);
            }
          }
        }
      }
    }
    // The sweep has to have produced pickups for the assertion above to mean
    // anything.
    expect(seen).toBeGreaterThan(500);
  });

  it('sounds instead of the fallback root on a segment with no strong beat', () => {
    // The fallback is for a segment that produced no note at all. A segment
    // covering one weak beat produces a pickup, and the pickup is what has to be
    // heard: writing the fallback on top of it put two notes on one onset, and
    // the one silently dropped was the one the line had chosen.
    for (const ts of [
      { numerator: 4, denominator: 4 },
      { numerator: 3, denominator: 4 },
    ] as const) {
      for (let seed = 0; seed < 8; seed += 1) {
        const notes = generateBassLine({
          segments: [{ startBeat: 1, endBeat: 2, chord: makeChord(0, 'maj') }],
          key: cMajor,
          style: 'pop',
          ts,
          octave: 2,
          ctx: { seed, complexity: { rhythmic: 1 } },
        });
        const label = `${ts.numerator}/${ts.denominator} seed ${seed}`;
        expect(notes, label).toHaveLength(1);
        expect(notes[0]?.startBeat, label).toBe(1);
        expect(notes[0]?.pitch, label).not.toBe(soundingRoot(0, 2, undefined));
      }
    }
  });
});
