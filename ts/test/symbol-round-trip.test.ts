import { describe, expect, it } from 'vitest';
import { noteToPitchClass } from '../src/core/pitch/index.js';
import type {
  Alteration,
  Chord,
  ChordBase,
  ChordSeventh,
  ChordSpec,
} from '../src/theory/chord/index.js';
import {
  chordFromSpec,
  chordPitchClasses,
  chordQualities,
  degreeOfInterval,
  makeChord,
} from '../src/theory/chord/index.js';
import { formatChordSymbol, tryParseChordSymbol } from '../src/theory/symbol/index.js';
import { isWrittenSpelling } from '../src/theory/symbol/spelling.js';

/**
 * The bases a symbol writes out in full. `power` is covered by the `5` quality
 * below: a power chord carrying anything else is read back as a triad with its
 * third left out, and an omitted tone is deliberately not written.
 */
const BASES: ChordBase[] = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4'];

const SEVENTHS: (ChordSeventh | undefined)[] = [undefined, 'maj7', 'min7', 'dim7'];

const ADDITION_SETS: number[][] = [[], [6], [9], [6, 9]];

const ALTERATION_SETS: Alteration[][] = [
  [],
  [{ degree: 5, alter: -1 }],
  [{ degree: 9, alter: 0 }],
  [{ degree: 11, alter: 1 }],
  [{ degree: 13, alter: -1 }],
  [
    { degree: 9, alter: -1 },
    { degree: 11, alter: 1 },
  ],
  [
    { degree: 9, alter: 0 },
    { degree: 13, alter: 0 },
  ],
];

/** Failures are collected and asserted once, so a product of this size reports
 * what broke instead of stopping at the first case. */
const REPORTED_FAILURES = 10;

/**
 * The chords built from spec parts, minus the ones the chord model cannot hold.
 *
 * A spec naming one degree in both `additions` and `alterations` keeps only the
 * alteration — a chord carrying an added ninth *and* a flattened one has no
 * structural reading — so its tones are already gone before any symbol is
 * written, and no way of writing one could bring them back.
 */
function structuralSpecs(): ChordSpec[] {
  const specs: ChordSpec[] = [];
  for (const base of BASES) {
    for (const seventh of SEVENTHS) {
      for (const additions of ADDITION_SETS) {
        for (const alterations of ALTERATION_SETS) {
          if (additions.some((degree) => alterations.some((part) => part.degree === degree))) {
            continue;
          }
          specs.push({
            rootPc: 0,
            base,
            ...(seventh === undefined ? {} : { seventh }),
            alterations,
            additions,
            omissions: [],
          });
        }
      }
    }
  }
  return specs;
}

const STRUCTURAL_SPECS = structuralSpecs();

/**
 * Every chord under test at one root and bass.
 *
 * Both ways into the suffix writer are here: a named quality takes the alias
 * table's spelling outright, and a spec no name covers is written from its
 * parts, with whatever the largest name inside it does not say added as
 * figures.
 */
function buildChordsAt(rootPc: number, bassPc?: number): Chord[] {
  const named = chordQualities().map((quality) => makeChord(rootPc, quality, bassPc));
  const structural = STRUCTURAL_SPECS.map((spec) =>
    chordFromSpec({ ...spec, rootPc, ...(bassPc === undefined ? {} : { bassPc }) }),
  );
  return [...named, ...structural];
}

/**
 * The chords at one root and bass, built once.
 *
 * A chord is what is being round-tripped, not what is being varied: the option
 * sets below read the same chords, so rebuilding them per option would spend
 * most of the run in the chord builder rather than in the symbol layer.
 */
const CHORD_CACHE = new Map<string, Chord[]>();

function chordsAt(rootPc: number, bassPc?: number): Chord[] {
  const id = `${rootPc}|${bassPc ?? 'none'}`;
  const cached = CHORD_CACHE.get(id);
  if (cached !== undefined) {
    return cached;
  }
  const built = buildChordsAt(rootPc, bassPc);
  CHORD_CACHE.set(id, built);
  return built;
}

/** How many chords one root and bass contributes. */
const SHAPES = chordsAt(0).length;

/**
 * A generous ceiling for the exhaustive passes.
 *
 * They are deliberately large — tens of thousands of round trips each — so they
 * declare their own budget rather than sitting just under a default written for
 * ordinary unit tests, where a loaded machine decides whether they pass.
 */
const PROPERTY_TIMEOUT_MS = 30_000;

/** What a round trip has to preserve: the root, the sounding bass, the tones. */
function harmonyOf(chord: Chord): string {
  return `${chord.rootPc}/${chord.bassPc ?? chord.rootPc}/${chordPitchClasses(chord).join(',')}`;
}

describe('chord symbol round trip', () => {
  it(
    'writes a chord read on one side of the fence on the other',
    () => {
      // The one configuration in which the spelling a chord carries and the
      // side it is being written on disagree: everything else round-trips with
      // the hint already on the side it is asked for, and the step that moves a
      // spelling across runs as the identity. A chord read from a sharp name
      // and written flat is what a caller does with `{ flats: true }` on a
      // chart typed in sharps.
      const failures: string[] = [];
      let checked = 0;
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        for (const bassPc of [undefined, (rootPc + 4) % 12]) {
          for (const chord of chordsAt(rootPc, bassPc)) {
            for (const from of [false, true]) {
              checked += 1;
              const named = formatChordSymbol(chord, { flats: from });
              const read = tryParseChordSymbol(named);
              if (!read.ok) {
                failures.push(`parse ${named}: ${read.error.message}`);
                continue;
              }
              // Written on the other side, from a chord whose spellings are on
              // this one.
              const crossed = formatChordSymbol(read.value, { flats: !from });
              const back = tryParseChordSymbol(crossed);
              if (!back.ok) {
                failures.push(`parse ${crossed} (from ${named}): ${back.error.message}`);
                continue;
              }
              if (harmonyOf(back.value) !== harmonyOf(chord)) {
                failures.push(
                  `${named} -> ${crossed}: ${harmonyOf(chord)} became ${harmonyOf(back.value)}`,
                );
                continue;
              }
              // The root is always written plainly, and so is a bass standing
              // under the chord rather than in it. A bass that is one of the
              // chord's own tones keeps the chord's spelling however odd — the
              // augmented fifth of a G sharp is a D double sharp — and what
              // makes that a spelling rather than an accident is the letter:
              // it is the letter of the degree the tone plays. A bass carried
              // onto some other letter is neither, and the `Db/Gbb` a `C#/F`
              // used to become is exactly that.
              const root = back.value.rootSpelling;
              if (root !== undefined && !isWrittenSpelling(root)) {
                failures.push(`${crossed}: root ${JSON.stringify(root)} is not written`);
              }
              const bass = back.value.bassSpelling;
              if (bass !== undefined && !isWrittenSpelling(bass) && root !== undefined) {
                const degree = degreeOfInterval(
                  (noteToPitchClass(bass) - back.value.rootPc + 12) % 12,
                  back.value,
                );
                const letter = degree === undefined ? -1 : (root.letter + degree - 1) % 7;
                if (bass.letter !== letter) {
                  failures.push(
                    `${crossed}: bass ${JSON.stringify(bass)} is on no degree's letter`,
                  );
                }
              }
            }
          }
        }
      }
      expect(checked).toBe(SHAPES * 2 * 12 * 2);
      expect(failures.slice(0, REPORTED_FAILURES)).toEqual([]);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
