import { scaleTonesInDegreeOrder } from '../scale/index.js';
import type { KeyScale } from '../types.js';

/** Chord quality identifiers understood by the chord builder. */
export type ChordQuality =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | 'maj7'
  | 'min7'
  | 'dom7'
  | 'dim7'
  | 'm7b5'
  | 'minMaj7'
  | 'aug7'
  | 'augMaj7'
  | 'majb5'
  | '6'
  | 'min6'
  | '6/9'
  | 'sus2'
  | 'sus4'
  | 'add9'
  | 'add11'
  | 'maj9'
  | 'min9'
  | 'dom9'
  | '7b9'
  | '7#9'
  | '7#11'
  | '7b13'
  | '11'
  | '13'
  | '5';

/**
 * A bare spelled pitch used as an enharmonic hint: a diatonic letter
 * (0..6 = C..B) plus a chromatic alteration (-2 double-flat .. +2 double-sharp).
 * Mirrors the letter/alter half of the pitch module's `Note` without an octave.
 */
export type PitchSpelling = {
  letter: number;
  alter: number;
};

/**
 * A chord expressed as a root pitch class plus semitone offsets.
 *
 * `rootSpelling`/`bassSpelling` are optional enharmonic hints recorded by
 * parsers (e.g. `parseChordSymbol('Bb7')`) so formatters can reproduce the
 * original spelling instead of defaulting to sharps. Consumers may ignore
 * them; a hint is only trusted when its pitch class still matches the
 * corresponding `rootPc`/`bassPc`.
 */
export type Chord = {
  rootPc: number;
  quality: ChordQuality;
  intervals: number[];
  bassPc?: number;
  rootSpelling?: PitchSpelling;
  bassSpelling?: PitchSpelling;
};

/** Semitone offsets from the root for each supported chord quality. */
const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  majb5: [0, 4, 6],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  minMaj7: [0, 3, 7, 11],
  aug7: [0, 4, 8, 10],
  augMaj7: [0, 4, 8, 11],
  '6': [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  '6/9': [0, 4, 7, 9, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  add11: [0, 4, 7, 17],
  maj9: [0, 4, 7, 11, 14],
  min9: [0, 3, 7, 10, 14],
  dom9: [0, 4, 7, 10, 14],
  '7b9': [0, 4, 7, 10, 13],
  '7#9': [0, 4, 7, 10, 15],
  '7#11': [0, 4, 7, 10, 18],
  '7b13': [0, 4, 7, 10, 20],
  '11': [0, 7, 10, 14, 17],
  '13': [0, 4, 7, 10, 14, 21],
  '5': [0, 7],
};

/** Reduce a value to a pitch class in [0, 11]. */
function pitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
}

/** All chord qualities the builder understands, longest templates last. */
export function chordQualities(): ChordQuality[] {
  return Object.keys(QUALITY_INTERVALS) as ChordQuality[];
}

/**
 * Build a chord rooted on a diatonic scale degree.
 *
 * The root pitch class is the degree's diatonic pitch class in `key`; the
 * quality's interval template is attached unchanged. Degrees beyond the scale
 * length wrap around.
 *
 * @param degree 0-based scale degree of the chord root.
 * @param ext Chord quality to apply.
 * @param key Key context supplying the diatonic root.
 * @returns The constructed chord.
 */
export function chordFromDegree(degree: number, ext: ChordQuality, key: KeyScale): Chord {
  const tones = scaleTonesInDegreeOrder(key);
  const length = tones.length;
  const index = length > 0 ? ((degree % length) + length) % length : 0;
  const rootPc = tones[index] ?? pitchClass(key.rootPc);
  return { rootPc, quality: ext, intervals: [...QUALITY_INTERVALS[ext]] };
}

/**
 * Build a chord from an explicit root pitch class and quality.
 *
 * @param rootPc Root pitch class (0..11).
 * @param quality Chord quality supplying the interval template.
 * @param bassPc Optional slash-chord bass pitch class.
 * @returns The constructed chord.
 */
export function makeChord(rootPc: number, quality: ChordQuality, bassPc?: number): Chord {
  const chord: Chord = {
    rootPc: pitchClass(rootPc),
    quality,
    intervals: [...QUALITY_INTERVALS[quality]],
  };
  if (bassPc !== undefined) {
    chord.bassPc = pitchClass(bassPc);
  }
  return chord;
}

/**
 * Get the sorted, deduplicated pitch classes of a chord.
 *
 * @param chord The chord to enumerate.
 * @returns The chord's pitch classes, sorted ascending in [0, 11].
 */
export function chordPitchClasses(chord: Chord): number[] {
  const set = new Set<number>();
  for (const interval of chord.intervals) {
    set.add(pitchClass(chord.rootPc + interval));
  }
  return [...set].sort((a, b) => a - b);
}

/** The chord-tone offsets present in a chord, reduced to pitch-class space. */
function chordToneOffsets(chord: Chord): Set<number> {
  return new Set(chord.intervals.map((i) => ((i % 12) + 12) % 12));
}

/**
 * Determine a pitch's harmonic role within a chord.
 *
 * The role is derived from the pitch's interval above the chord root, reduced
 * modulo 12. A major sixth (9) reads as a `sixth` for sixth chords but as a
 * `seventh` for a diminished-seventh chord; ninths and other tensions have no
 * basic role and return null.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param chord The chord providing the root reference.
 * @returns The chord-tone role, or null if the pitch has no basic role.
 */
export function chordToneRole(
  pitch: number,
  chord: Chord,
): 'root' | 'third' | 'fifth' | 'sixth' | 'seventh' | null {
  const interval = (pitchClass(pitch) - pitchClass(chord.rootPc) + 12) % 12;
  const tones = chordToneOffsets(chord);
  if (interval === 0) {
    return 'root';
  }
  if (interval === 3 || interval === 4) {
    return tones.has(interval) ? 'third' : null;
  }
  if (interval === 7) {
    return tones.has(7) ? 'fifth' : null;
  }
  if (interval === 6) {
    // A diminished fifth is the chord's fifth only when no perfect fifth is
    // present; alongside a perfect fifth it is a #11 tension, not a fifth.
    return tones.has(6) && !tones.has(7) ? 'fifth' : null;
  }
  if (interval === 8) {
    // An augmented fifth is the chord's fifth only without a perfect fifth;
    // alongside a perfect fifth it is a b13 tension, not a fifth.
    return tones.has(8) && !tones.has(7) ? 'fifth' : null;
  }
  if (interval === 9) {
    const hasHigherSeventh = tones.has(10) || tones.has(11);
    const isDiminishedSeventh = tones.has(3) && tones.has(6) && !hasHigherSeventh;
    if (isDiminishedSeventh) {
      return 'seventh';
    }
    if (tones.has(9) && !hasHigherSeventh) {
      return 'sixth';
    }
    return null;
  }
  if (interval === 10 || interval === 11) {
    return tones.has(interval) ? 'seventh' : null;
  }
  return null;
}

/** Classify a stacked-thirds triad into a chord quality from its interval set. */
function classifyTriad(thirdIc: number, fifthIc: number): ChordQuality {
  if (thirdIc === 4 && fifthIc === 8) {
    return 'aug';
  }
  if (thirdIc === 4 && fifthIc === 6) {
    return 'majb5';
  }
  if (thirdIc === 3 && fifthIc === 6) {
    return 'dim';
  }
  if (thirdIc === 3) {
    return 'min';
  }
  return 'maj';
}

/** Classify a stacked-thirds seventh chord into a chord quality. */
function classifySeventh(thirdIc: number, fifthIc: number, seventhIc: number): ChordQuality {
  if (thirdIc === 3 && fifthIc === 6 && seventhIc === 9) {
    return 'dim7';
  }
  if (thirdIc === 3 && fifthIc === 6 && seventhIc === 10) {
    return 'm7b5';
  }
  if (thirdIc === 3 && seventhIc === 11) {
    return 'minMaj7';
  }
  if (thirdIc === 3) {
    return 'min7';
  }
  if (fifthIc === 8 && seventhIc === 10) {
    return 'aug7';
  }
  if (fifthIc === 8 && seventhIc === 11) {
    return 'augMaj7';
  }
  if (seventhIc === 11) {
    return 'maj7';
  }
  return 'dom7';
}

/** Stack scale thirds from a scale degree into a chord of `size` notes. */
function stackThirds(degree: number, key: KeyScale, size: 3 | 4): Chord {
  const tones = scaleTonesInDegreeOrder(key);
  const length = tones.length;
  if (length === 0) {
    return { rootPc: pitchClass(key.rootPc), quality: 'maj', intervals: [0, 4, 7] };
  }
  const idx = (step: number) => (((degree + step) % length) + length) % length;
  const rootPc = tones[idx(0)] ?? pitchClass(key.rootPc);
  const offsets = [0, 2, 4, 6].slice(0, size).map((step) => {
    const pc = tones[idx(step)] ?? rootPc;
    return (((pc - rootPc) % 12) + 12) % 12;
  });
  const thirdIc = offsets[1] ?? 4;
  const fifthIc = offsets[2] ?? 7;
  const quality =
    size === 3
      ? classifyTriad(thirdIc, fifthIc)
      : classifySeventh(thirdIc, fifthIc, offsets[3] ?? 11);
  return { rootPc, quality, intervals: offsets };
}

/**
 * Build the diatonic triad rooted on a scale degree by stacking scale thirds.
 *
 * Unlike {@link chordFromDegree}, the chord quality is derived from the scale
 * rather than supplied, so degrees yield their scale-correct triads (e.g. a
 * diminished triad on the leading tone of a major key). Intended for heptatonic
 * scales; other scales stack by scale step regardless.
 *
 * @param degree 0-based scale degree of the chord root.
 * @param key Key/scale context.
 * @returns The diatonic triad.
 */
export function diatonicTriad(degree: number, key: KeyScale): Chord {
  return stackThirds(degree, key, 3);
}

/**
 * Build the diatonic seventh chord rooted on a scale degree.
 *
 * @param degree 0-based scale degree of the chord root.
 * @param key Key/scale context.
 * @returns The diatonic seventh chord.
 */
export function diatonicSeventh(degree: number, key: KeyScale): Chord {
  return stackThirds(degree, key, 4);
}
