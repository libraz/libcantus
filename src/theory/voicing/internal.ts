import type { Chord } from '../chord/index.js';
import { chordPitchClasses } from '../chord/index.js';
import {
  createsParallelPerfect,
  createsVoiceCrossing,
  createsVoiceOverlap,
  exceedsSpacing,
} from '../counterpoint/index.js';
import type { VoiceRange } from './satb.js';

/** Default maximum spacing between adjacent upper voices (one octave). */
export const DEFAULT_MAX_SPACING = 12;

/** Score penalty per counterpoint violation between consecutive voicings. */
export const VIOLATION_PENALTY = 1000;
/** Score penalty per chord tone absent from a voicing. */
const MISSING_TONE_PENALTY = 500;
/** Score penalty per doubled tone that is neither the root nor the fifth. */
const POOR_DOUBLING_PENALTY = 4;
/** Hard cap on candidate voicings evaluated per chord, keeping the search bounded. */
const MAX_CANDIDATES = 4000;

/** Reduce a value to a pitch class in [0, 11]. */
export function pitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
}

/**
 * All MIDI pitches of a pitch class inside an inclusive range, ordered from the
 * centre of the range outward (ties break toward the lower pitch). Enumerating
 * centre-outward keeps the candidate set balanced around the register when it
 * is truncated at {@link MAX_CANDIDATES}, instead of skewing to the low octaves
 * that a plain ascending scan would visit first.
 */
function pitchesForPc(pc: number, range: VoiceRange): number[] {
  const result: number[] = [];
  for (let midi = Math.ceil(range.min); midi <= range.max; midi += 1) {
    if (pitchClass(midi) === pc) {
      result.push(midi);
    }
  }
  const center = (range.min + range.max) / 2;
  return result.sort((a, b) => {
    const da = Math.abs(a - center);
    const db = Math.abs(b - center);
    return da === db ? a - b : da - db;
  });
}

/**
 * Enumerate candidate voicings for a chord: the bass takes the chord's bass
 * (or root) pitch class at each available octave, and each upper voice takes
 * any chord pitch class within its range. Candidates are built in ascending
 * voice order and pruned to exclude voice crossings and over-wide adjacent
 * spacing (the bass–tenor pair is allowed an extra octave, per convention).
 * Enumeration is deterministic and capped at {@link MAX_CANDIDATES}.
 */
export function enumerateVoicings(
  chord: Chord,
  ranges: VoiceRange[],
  maxSpacing: number,
): number[][] {
  const chordPcs = chordPitchClasses(chord);
  const bassPc = pitchClass(chord.bassPc ?? chord.rootPc);
  const results: number[][] = [];
  const current: number[] = [];
  const build = (voice: number): void => {
    if (results.length >= MAX_CANDIDATES) {
      return;
    }
    if (voice === ranges.length) {
      results.push([...current]);
      return;
    }
    const range = ranges[voice];
    if (range === undefined) {
      return;
    }
    const pcs = voice === 0 ? [bassPc] : chordPcs;
    const prev = current[voice - 1];
    for (const pc of pcs) {
      for (const pitch of pitchesForPc(pc, range)) {
        if (prev !== undefined) {
          if (pitch < prev) {
            continue; // would cross below the next lower voice
          }
          const spacingLimit = voice === 1 ? maxSpacing + 12 : maxSpacing;
          if (pitch - prev > spacingLimit) {
            continue;
          }
        }
        current.push(pitch);
        build(voice + 1);
        current.pop();
      }
    }
  };
  build(0);
  return results;
}

/**
 * Structural quality penalty of a single voicing: heavily penalize missing
 * chord tones, mildly penalize doubling anything other than the root or fifth.
 */
export function structuralPenalty(pitches: number[], chord: Chord): number {
  const counts = new Map<number, number>();
  for (const pitch of pitches) {
    const pc = pitchClass(pitch);
    counts.set(pc, (counts.get(pc) ?? 0) + 1);
  }
  let penalty = 0;
  for (const pc of chordPitchClasses(chord)) {
    if (!counts.has(pc)) {
      penalty += MISSING_TONE_PENALTY;
    }
  }
  const rootPc = pitchClass(chord.rootPc);
  const fifthPc = pitchClass(chord.rootPc + 7);
  for (const [pc, count] of counts) {
    if (count > 1 && pc !== rootPc && pc !== fifthPc) {
      penalty += (count - 1) * POOR_DOUBLING_PENALTY;
    }
  }
  return penalty;
}

/**
 * Count counterpoint violations between two consecutive voicings of equal
 * length: parallel perfects (fifths and octaves alike, since octaves are the
 * perfect-class-zero case of {@link createsParallelPerfect}) on every voice
 * pair, voice crossings in the new voicing, and — on adjacent pairs — voice
 * overlaps and over-wide spacing between upper voices.
 */
export function violationCount(prev: number[], cur: number[], maxSpacing: number): number {
  let count = 0;
  for (let lower = 0; lower < cur.length; lower += 1) {
    for (let upper = lower + 1; upper < cur.length; upper += 1) {
      const prevLower = prev[lower];
      const prevUpper = prev[upper];
      const curLower = cur[lower];
      const curUpper = cur[upper];
      if (
        prevLower === undefined ||
        prevUpper === undefined ||
        curLower === undefined ||
        curUpper === undefined
      ) {
        continue;
      }
      if (createsParallelPerfect(prevUpper, curUpper, prevLower, curLower)) {
        count += 1;
      }
      if (createsVoiceCrossing(curUpper, curLower)) {
        count += 1;
      }
      if (upper === lower + 1) {
        if (createsVoiceOverlap(prevUpper, curUpper, prevLower, curLower)) {
          count += 1;
        }
        if (lower > 0 && exceedsSpacing(curUpper, curLower, maxSpacing)) {
          count += 1;
        }
      }
    }
  }
  return count;
}
