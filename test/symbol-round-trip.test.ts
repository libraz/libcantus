import { describe, expect, it } from 'vitest';
import type { NoteNameSystem } from '../src/core/pitch/index.js';
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
  makeChord,
} from '../src/theory/chord/index.js';
import type { ChordSymbolOptions } from '../src/theory/symbol/index.js';
import {
  formatChordSymbol,
  transposeChordSymbol,
  tryParseChordSymbol,
} from '../src/theory/symbol/index.js';

/**
 * The bases a symbol writes out in full. `power` is covered by the `5` quality
 * below: a power chord carrying anything else is read back as a triad with its
 * third left out, and an omitted tone is deliberately not written.
 */
const BASES: ChordBase[] = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4'];

/** Every base, for the passes that claim nothing about what the tones are. */
const ALL_BASES: ChordBase[] = [...BASES, 'power'];

/** The tones a chord may leave out, root included. */
const OMISSION_SETS: number[][] = [[], [1], [3], [5], [3, 5]];

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

const SYSTEMS: NoteNameSystem[] = ['english', 'german', 'japanese', 'italian', 'fixedDo'];

/** Root pitch classes: a natural, a sharp side and a flat side. */
const SPELLING_ROOTS = [0, 6, 10];

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
 * Every spec the product reaches, nothing left out: omitted tones, a power
 * chord carrying tensions, and a degree named twice all included.
 *
 * These are the chords whose tones a symbol cannot promise to carry — an
 * omission is deliberately not written, and the model keeps only the alteration
 * where a degree is named twice — but a symbol is still written for them, and
 * every symbol the library writes has to read back as a chord.
 */
function everySpec(): ChordSpec[] {
  const specs: ChordSpec[] = [];
  for (const base of ALL_BASES) {
    for (const seventh of SEVENTHS) {
      for (const additions of ADDITION_SETS) {
        for (const alterations of ALTERATION_SETS) {
          for (const omissions of OMISSION_SETS) {
            specs.push({
              rootPc: 0,
              base,
              ...(seventh === undefined ? {} : { seventh }),
              alterations,
              additions,
              omissions,
            });
          }
        }
      }
    }
  }
  return specs;
}

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

/**
 * Report what a chord's symbol loses on the way back, or nothing when it loses
 * nothing.
 */
function roundTripFailure(chord: Chord, opts?: ChordSymbolOptions): string | undefined {
  let symbol: string;
  try {
    symbol = formatChordSymbol(chord, opts);
  } catch (error) {
    return `format ${harmonyOf(chord)}: ${String(error)}`;
  }
  const parsed = tryParseChordSymbol(symbol, opts);
  if (!parsed.ok) {
    return `parse ${symbol}: ${parsed.error.message}`;
  }
  if (harmonyOf(parsed.value) !== harmonyOf(chord)) {
    return `${symbol}: ${harmonyOf(chord)} became ${harmonyOf(parsed.value)}`;
  }
  // A symbol read back and written again is the same symbol: the second pass
  // starts from a chord carrying the spelling hints the first one wrote.
  const rewritten = formatChordSymbol(parsed.value, opts);
  return rewritten === symbol ? undefined : `${symbol}: rewritten as ${rewritten}`;
}

describe('chord symbol round trip', () => {
  it(
    'preserves the harmony of every chord at every root and inversion',
    () => {
      const failures: string[] = [];
      let checked = 0;
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        // The bass unchanged, doubling the root, and under the third and fifth.
        for (const bassPc of [undefined, rootPc, (rootPc + 4) % 12, (rootPc + 7) % 12]) {
          for (const chord of chordsAt(rootPc, bassPc)) {
            checked += 1;
            const failure = roundTripFailure(chord);
            if (failure !== undefined) {
              failures.push(failure);
            }
          }
        }
      }
      expect(checked).toBe(SHAPES * 12 * 4);
      expect(failures.slice(0, REPORTED_FAILURES)).toEqual([]);
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    'preserves the harmony in every notation system',
    () => {
      const failures: string[] = [];
      let checked = 0;
      for (const system of SYSTEMS) {
        for (const rootPc of SPELLING_ROOTS) {
          for (const bassPc of [undefined, (rootPc + 4) % 12]) {
            for (const chord of chordsAt(rootPc, bassPc)) {
              checked += 1;
              const failure = roundTripFailure(chord, { system });
              if (failure !== undefined) {
                failures.push(`${system} ${failure}`);
              }
            }
          }
        }
      }
      expect(checked).toBe(SHAPES * SYSTEMS.length * SPELLING_ROOTS.length * 2);
      expect(failures.slice(0, REPORTED_FAILURES)).toEqual([]);
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    'preserves the harmony on either side of the enharmonic fence',
    () => {
      const failures: string[] = [];
      let checked = 0;
      for (const flats of [true, false]) {
        for (let rootPc = 0; rootPc < 12; rootPc += 1) {
          for (const chord of chordsAt(rootPc, (rootPc + 7) % 12)) {
            checked += 1;
            const failure = roundTripFailure(chord, { flats });
            if (failure !== undefined) {
              failures.push(`flats=${flats} ${failure}`);
            }
          }
        }
      }
      expect(checked).toBe(SHAPES * 2 * 12);
      expect(failures.slice(0, REPORTED_FAILURES)).toEqual([]);
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    'transposes every symbol it writes, through all twelve semitones',
    () => {
      const failures: string[] = [];
      let checked = 0;
      for (const system of ['english', 'german'] as const) {
        for (const chord of chordsAt(0, 4)) {
          const symbol = formatChordSymbol(chord, { system });
          for (let semitones = 0; semitones < 12; semitones += 1) {
            checked += 1;
            let moved: string;
            try {
              moved = transposeChordSymbol(symbol, semitones, { system });
            } catch (error) {
              failures.push(`${system} ${symbol} +${semitones}: ${String(error)}`);
              continue;
            }
            const parsed = tryParseChordSymbol(moved, { system });
            if (!parsed.ok) {
              failures.push(`${system} ${moved}: ${parsed.error.message}`);
              continue;
            }
            const expected = chordPitchClasses(chord).map((pc) => (pc + semitones) % 12);
            expected.sort((a, b) => a - b);
            if (chordPitchClasses(parsed.value).join(',') !== expected.join(',')) {
              failures.push(
                `${system} ${symbol} +${semitones} -> ${moved}: ${chordPitchClasses(parsed.value).join(',')} not ${expected.join(',')}`,
              );
            }
          }
        }
      }
      expect(checked).toBe(SHAPES * 2 * 12);
      expect(failures.slice(0, REPORTED_FAILURES)).toEqual([]);
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    'writes a readable symbol for every chord, tones it cannot carry included',
    () => {
      // The passes above hold the tones as well as the symbol, so they run over
      // the chords whose tones a symbol can carry. A chord that leaves a tone
      // out, or that names one degree twice, still gets a symbol written for it
      // — and a symbol the library writes and cannot read is the fault this
      // whole file is here for, whatever else is true of the chord.
      const failures: string[] = [];
      let checked = 0;
      for (const spec of everySpec()) {
        for (const rootPc of [0, 6]) {
          for (const bassPc of [undefined, (rootPc + 4) % 12]) {
            const chord = chordFromSpec({
              ...spec,
              rootPc,
              ...(bassPc === undefined ? {} : { bassPc }),
            });
            checked += 1;
            let symbol: string;
            try {
              symbol = formatChordSymbol(chord);
            } catch (error) {
              failures.push(`format ${harmonyOf(chord)}: ${String(error)}`);
              continue;
            }
            const parsed = tryParseChordSymbol(symbol);
            if (!parsed.ok) {
              failures.push(`parse ${symbol}: ${parsed.error.message}`);
              continue;
            }
            // The tones may be fewer than the chord's, but the chord it names
            // is rooted where the chord was and stands on the same bass.
            if (parsed.value.rootPc !== chord.rootPc) {
              failures.push(`${symbol}: root ${chord.rootPc} became ${parsed.value.rootPc}`);
            }
            if ((parsed.value.bassPc ?? parsed.value.rootPc) !== (chord.bassPc ?? chord.rootPc)) {
              failures.push(`${symbol}: bass moved`);
            }
          }
        }
      }
      expect(checked).toBe(everySpec().length * 2 * 2);
      expect(failures.slice(0, REPORTED_FAILURES)).toEqual([]);
    },
    PROPERTY_TIMEOUT_MS,
  );
});

describe('chord symbol round trip: the shapes a name does not cover', () => {
  it('covers every way the suffix writer can arrive at a spelling', () => {
    const symbols = new Set(chordsAt(0).map((chord) => formatChordSymbol(chord)));
    // A quality name covers the chord outright.
    expect(symbols.has('Cmaj7')).toBe(true);
    // The largest name that fits inside it, with the rest written as figures.
    expect(symbols.has('C6/9(#11)')).toBe(true);
    // No name fits inside it at all, so the suffix is built from the parts.
    expect(symbols.has('Cmaj7sus4')).toBe(true);
  });

  it('writes a suspended chord with any seventh so it reads back', () => {
    for (const base of ['sus2', 'sus4'] as const) {
      for (const seventh of ['maj7', 'min7', 'dim7'] as const) {
        for (const additions of [[], [6]]) {
          const chord = chordFromSpec({
            rootPc: 0,
            base,
            seventh,
            alterations: [],
            additions,
            omissions: [],
          });
          expect(roundTripFailure(chord)).toBeUndefined();
        }
      }
    }
  });

  it('writes the major seventh of a suspended chord the way a chart does', () => {
    const chord = chordFromSpec({
      rootPc: 0,
      base: 'sus4',
      seventh: 'maj7',
      alterations: [],
      additions: [],
      omissions: [],
    });
    expect(formatChordSymbol(chord)).toBe('Cmaj7sus4');
  });

  it('writes a sixth-ninth chord carrying tensions so it reads back', () => {
    for (const base of ['maj', 'min'] as const) {
      for (const alterations of [
        [],
        [{ degree: 11, alter: 1 }],
        [{ degree: 13, alter: -1 }],
        [{ degree: 5, alter: -1 }],
      ] as Alteration[][]) {
        for (const additions of [
          [6, 9],
          [6, 9, 11],
          [6, 9, 13],
        ]) {
          if (additions.some((degree) => alterations.some((part) => part.degree === degree))) {
            continue;
          }
          const chord = chordFromSpec({
            rootPc: 0,
            base,
            alterations,
            additions,
            omissions: [],
          });
          expect(roundTripFailure(chord)).toBeUndefined();
        }
      }
    }
  });

  it('keeps the slash of a sixth-ninth chord apart from a slash bass', () => {
    expect(
      formatChordSymbol(
        chordFromSpec({
          rootPc: 0,
          base: 'maj',
          alterations: [{ degree: 11, alter: 1 }],
          additions: [6, 9],
          omissions: [],
          bassPc: 4,
        }),
      ),
    ).toBe('C6/9(#11)/E');
    expect(tryParseChordSymbol('C6/9(#11)/E').ok).toBe(true);
  });
});
