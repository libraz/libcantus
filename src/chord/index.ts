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
  | 'sus2'
  | 'sus4'
  | 'add9'
  | 'maj9'
  | 'min9'
  | 'dom9';

/** A chord expressed as a root pitch class plus semitone offsets. */
export type Chord = {
  rootPc: number;
  quality: ChordQuality;
  intervals: number[];
  bassPc?: number;
};

/** Semitone offsets from the root for each supported chord quality. */
const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  maj9: [0, 4, 7, 11, 14],
  min9: [0, 3, 7, 10, 14],
  dom9: [0, 4, 7, 10, 14],
};

/** Reduce a value to a pitch class in [0, 11]. */
function pitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
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

/**
 * Determine a pitch's harmonic role within a chord.
 *
 * The role is derived from the pitch's interval above the chord root, reduced
 * modulo 12. Ninths and other tensions have no basic role and return null.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param chord The chord providing the root reference.
 * @returns The chord-tone role, or null if the pitch has no basic role.
 */
export function chordToneRole(
  pitch: number,
  chord: Chord,
): 'root' | 'third' | 'fifth' | 'seventh' | null {
  const interval = (pitchClass(pitch) - pitchClass(chord.rootPc) + 12) % 12;
  if (interval === 0) {
    return 'root';
  }
  if (interval === 3 || interval === 4) {
    return 'third';
  }
  if (interval === 6 || interval === 7 || interval === 8) {
    return 'fifth';
  }
  if (interval === 10 || interval === 11) {
    return 'seventh';
  }
  return null;
}
