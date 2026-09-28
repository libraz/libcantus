import { describe, expect, it } from 'vitest';
import { CADENCE_TYPES } from '../src/analyze/functional/cadence.js';
import { chordToRoman, romanToChord } from '../src/analyze/functional/roman.js';
import { MELODIC_CONTOUR_SHAPES } from '../src/analyze/melody/contour.js';
import { motifGraph } from '../src/analyze/melody/graph.js';
import { extractMotifs } from '../src/analyze/melody/motifs.js';
import {
  REFERENCE_PROFILE_VERSION,
  type ReferenceMotif,
  type ReferenceProfile,
} from '../src/analyze/reference/types.js';
import { assertReferenceProfile } from '../src/analyze/reference/validate.js';
import { analyzeRhythm } from '../src/analyze/rhythm/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { chordQualities, makeChord } from '../src/theory/chord/index.js';
import { resolveKey } from '../src/theory/scale/index.js';

const METERS = [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }];

/** A 3-note cell stated at beat 0 and, transposed up a fifth, at beat 4. */
const LINE: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
  { pitch: 67, startBeat: 4, durationBeat: 1 },
  { pitch: 69, startBeat: 5, durationBeat: 1 },
  { pitch: 71, startBeat: 6, durationBeat: 1 },
];

/** The chord-change onsets `harmony.rhythm` is read from: one per 4-beat chord. */
const CHORD_ONSETS: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 4 },
  { pitch: 60, startBeat: 4, durationBeat: 4 },
];

/**
 * A hand-built, internally valid profile over {@link LINE}: two four-beat
 * phrases in one section, a I-V7 progression, and the motif graph and rhythm
 * readings `extractMotifs` / `motifGraph` / `analyzeRhythm` actually produce
 * for it — so the distributions and indices are guaranteed consistent rather
 * than hand-computed.
 */
function validProfile(): ReferenceProfile {
  const key = resolveKey('C major');
  const motifs = extractMotifs(LINE);
  const graph = motifGraph(LINE, motifs);
  const referenceMotifs: ReferenceMotif[] = motifs.map((motif) => {
    const last = motif.notes[motif.notes.length - 1];
    const first = motif.notes[0];
    return {
      intervals: motif.intervals,
      rhythm: motif.rhythm,
      spanBeats: (last?.startBeat ?? 0) + (last?.durationBeat ?? 0) - (first?.startBeat ?? 0),
      occurrences: motif.occurrences.length,
    };
  });
  const melodyRhythm = analyzeRhythm(LINE, { meters: METERS, totalBeats: 8 });
  const harmonyRhythm = analyzeRhythm(CHORD_ONSETS, { meters: METERS, totalBeats: 8 });

  return {
    profileVersion: REFERENCE_PROFILE_VERSION,
    span: { startBeat: 0, endBeat: 8, bars: 2 },
    meters: METERS,
    form: {
      hypermeter: { groupBars: 2, confidence: 0.5 },
      sections: [
        {
          label: 'A',
          startBeat: 0,
          endBeat: 8,
          bars: 2,
          firstOccurrence: 0,
          similarity: 1,
          rationale: 'the only section',
        },
      ],
      phrases: [
        {
          startBeat: 0,
          endBeat: 4,
          bars: 1,
          section: 0,
          confidence: 0.9,
          cadence: { atBeat: 4, type: 'half', weight: 0.6 },
          melody: {
            shape: 'ascending',
            low: 60,
            high: 64,
            mean: 62,
            peakPitch: 64,
            peakPosition: 1,
            outline: [0, 0, 0, 0, 0, 0, 0, 0],
            onsetDensity: 3,
            restRatio: 0.25,
          },
          motifNodes: [0],
        },
        {
          startBeat: 4,
          endBeat: 8,
          bars: 1,
          section: 0,
          confidence: 0.9,
          cadence: null,
          melody: {
            shape: 'ascending',
            low: 67,
            high: 71,
            mean: 69,
            peakPitch: 71,
            peakPosition: 1,
            outline: [0, 0, 0, 0, 0, 0, 0, 0],
            onsetDensity: 3,
            restRatio: 0.25,
          },
          motifNodes: [1],
        },
      ],
    },
    harmony: {
      keys: [{ startBeat: 0, endBeat: 8, key, confidence: 1 }],
      chords: [
        {
          startBeat: 0,
          endBeat: 4,
          key: 0,
          roman: chordToRoman(makeChord(0, 'maj'), key),
          function: 'tonic',
          level: 'structural',
        },
        {
          startBeat: 4,
          endBeat: 8,
          key: 0,
          roman: chordToRoman(makeChord(7, 'dom7'), key),
          function: 'dominant',
          level: 'structural',
        },
      ],
      rhythm: harmonyRhythm,
    },
    melody: {
      register: { low: 60, high: 71, mean: 65.5 },
      shape: 'ascending',
      motifs: referenceMotifs,
      graph,
      rhythm: melodyRhythm,
    },
  };
}

describe('assertReferenceProfile: acceptance', () => {
  it('accepts a hand-built valid profile', () => {
    const profile = validProfile();
    expect(assertReferenceProfile(profile)).toEqual(profile);
  });

  it('survives a JSON round trip and is still accepted', () => {
    const profile = validProfile();
    const restored = JSON.parse(JSON.stringify(profile));
    expect(restored).toEqual(profile);
    expect(assertReferenceProfile(restored)).toEqual(profile);
  });

  it('accepts and round-trips an explicit modal key (D dorian)', () => {
    const profile = validProfile();
    (profile.harmony.keys[0] as (typeof profile.harmony.keys)[number]).key = resolveKey('D dorian');
    const restored = JSON.parse(JSON.stringify(profile));
    expect(assertReferenceProfile(restored)).toEqual(profile);
  });

  it('accepts and round-trips an explicit harmonic-minor key (C harmonic minor)', () => {
    const profile = validProfile();
    (profile.harmony.keys[0] as (typeof profile.harmony.keys)[number]).key =
      resolveKey('C harmonic minor');
    const restored = JSON.parse(JSON.stringify(profile));
    expect(assertReferenceProfile(restored)).toEqual(profile);
  });
});

describe('assertReferenceProfile: rejection', () => {
  it('rejects a missing field', () => {
    const profile = validProfile() as unknown as Record<string, unknown>;
    delete (profile.harmony as Record<string, unknown>).chords;
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/harmony\.chords/);
  });

  it('rejects a NaN in a required numeric field', () => {
    const profile = validProfile();
    (profile.form.phrases[0] as (typeof profile.form.phrases)[number]).confidence = Number.NaN;
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/form\.phrases\[0\]\.confidence/);
  });

  it('rejects a ratio outside [0, 1]', () => {
    const profile = validProfile();
    profile.melody.rhythm.restRatio = 1.5;
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/melody\.rhythm\.restRatio/);
  });

  it('rejects a distribution that no longer sums to 1', () => {
    const profile = validProfile();
    profile.melody.rhythm.onsetLevels = profile.melody.rhythm.onsetLevels.map((share, index) =>
      index === 0 ? share + 1 : share,
    );
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/melody\.rhythm\.onsetLevels/);
  });

  it('rejects a distribution of the wrong length', () => {
    const profile = validProfile();
    profile.melody.rhythm.onsetLevels = [1];
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/melody\.rhythm\.onsetLevels/);
  });

  it('rejects an index outside the array it points into', () => {
    const profile = validProfile();
    (profile.harmony.chords[0] as (typeof profile.harmony.chords)[number]).key = 5;
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/harmony\.chords\[0\]\.key/);
  });

  it('rejects a motif-graph node with in-degree 2', () => {
    const profile = validProfile();
    const edge = profile.melody.graph.edges[0] as (typeof profile.melody.graph.edges)[number];
    // A second edge into the same `to` is what the in-degree check catches,
    // whatever its own `from` and relation are.
    profile.melody.graph.edges.push({ ...edge });
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/incoming edge/);
  });

  it('rejects a motif-graph edge whose from is not less than its to', () => {
    const profile = validProfile();
    const edge = profile.melody.graph.edges[0] as (typeof profile.melody.graph.edges)[number];
    profile.melody.graph.edges[0] = { ...edge, from: edge.to, to: edge.from };
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/graph\.edges\[0\]\.from/);
  });

  it('rejects an unknown melodic contour shape', () => {
    const profile = validProfile();
    (profile.melody as unknown as Record<string, unknown>).shape = 'diagonal';
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/melody\.shape/);
  });

  it('rejects an unknown cadence type', () => {
    const profile = validProfile();
    const phrase = profile.form.phrases[0] as (typeof profile.form.phrases)[number];
    (phrase.cadence as unknown as Record<string, unknown>).type = 'imperfect';
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/cadence\.type/);
  });

  it('rejects a roman numeral romanToChord cannot read', () => {
    const profile = validProfile();
    (profile.harmony.chords[0] as (typeof profile.harmony.chords)[number]).roman = 'not a numeral';
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/harmony\.chords\[0\]\.roman/);
  });

  it.each([
    ['a fractional interval', { intervals: [2, 1.5], rhythm: [1, 1] }, /intervals\[1\]/],
    ['an interval run wider than MIDI', { intervals: [100, 100], rhythm: [1, 1] }, /intervals/],
    ['a rhythm of the wrong length', { intervals: [2, 2], rhythm: [1] }, /rhythm/],
    ['a non-positive rhythm ratio', { intervals: [2, 2], rhythm: [1, 0] }, /rhythm\[1\]/],
  ])('rejects a motif with %s', (_, cell, path) => {
    const profile = validProfile();
    expect(profile.melody.motifs.length).toBeGreaterThan(0);
    Object.assign(profile.melody.motifs[0] as ReferenceMotif, cell);
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(path);
  });

  it('rejects an unknown profileVersion', () => {
    const profile = validProfile();
    (profile as unknown as Record<string, unknown>).profileVersion = REFERENCE_PROFILE_VERSION + 1;
    expect(() => assertReferenceProfile(profile)).toThrow(InvalidInputError);
    expect(() => assertReferenceProfile(profile)).toThrow(/profileVersion/);
  });

  it('names every enum table it checks values against', () => {
    // Sanity check that the tables the rejection tests above rely on are
    // actually the ones the validator reads.
    expect(CADENCE_TYPES).toContain('half');
    expect(MELODIC_CONTOUR_SHAPES).toContain('ascending');
  });
});

describe('roman numerals the analyzer can produce read back for every quality', () => {
  const keys = [
    resolveKey('C major'),
    resolveKey('A minor'),
    resolveKey('D dorian'),
    resolveKey('C harmonic minor'),
  ];

  it.each(keys)('round-trips every chord quality in a $variant key', (key) => {
    for (const quality of chordQualities()) {
      const chord = makeChord(0, quality);
      const roman = chordToRoman(chord, key);
      const parsed = romanToChord(roman, key);
      expect(parsed.rootPc, `${roman} (${quality})`).toBe(chord.rootPc);
    }
  });
});
