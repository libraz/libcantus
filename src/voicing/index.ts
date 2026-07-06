import type { Chord } from '../chord/index.js';
import { chordPitchClasses } from '../chord/index.js';
import {
  createsParallelOctave,
  createsParallelPerfect,
  createsVoiceCrossing,
  createsVoiceOverlap,
  exceedsSpacing,
} from '../counterpoint/index.js';

/** An inclusive MIDI pitch range for a single voice. */
export type VoiceRange = {
  min: number;
  max: number;
};

/**
 * Default four-voice SATB ranges, ascending (index 0 = lowest):
 * bass E2–C4 (40–60), tenor C3–G4 (48–67), alto G3–D5 (55–74),
 * soprano C4–G5 (60–79).
 */
export const SATB_RANGES: readonly VoiceRange[] = [
  { min: 40, max: 60 },
  { min: 48, max: 67 },
  { min: 55, max: 74 },
  { min: 60, max: 79 },
];

/** Options controlling {@link voiceChord} and {@link voiceProgression}. */
export type VoicingOptions = {
  /** Number of voices to realize (default 4). Ignored when `ranges` is given. */
  voices?: number;
  /** Explicit per-voice ranges, ascending (index 0 = lowest). Takes precedence over `voices`. */
  ranges?: VoiceRange[];
  /** Maximum spacing in semitones between adjacent upper voices (default 12). */
  maxSpacing?: number;
};

/** Default maximum spacing between adjacent upper voices (one octave). */
const DEFAULT_MAX_SPACING = 12;

/** Overall pitch floor/ceiling used when deriving ranges for arbitrary voice counts. */
const DERIVED_LOW = 40;
const DERIVED_HIGH = 79;
/** Span of each derived per-voice range in semitones. */
const DERIVED_SPAN = 19;

/** Score penalty per counterpoint violation between consecutive voicings. */
const VIOLATION_PENALTY = 1000;
/** Score penalty per chord tone absent from a voicing. */
const MISSING_TONE_PENALTY = 500;
/** Score penalty per doubled tone that is neither the root nor the fifth. */
const POOR_DOUBLING_PENALTY = 4;
/** Hard cap on candidate voicings evaluated per chord, keeping the search bounded. */
const MAX_CANDIDATES = 4000;

/** Reduce a value to a pitch class in [0, 11]. */
function pitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
}

/**
 * Resolve the per-voice ranges implied by the options: explicit `ranges` win,
 * four voices use {@link SATB_RANGES}, and other counts get evenly spaced
 * ranges spanning roughly the bass-to-soprano compass.
 */
function resolveRanges(opts?: VoicingOptions): VoiceRange[] {
  if (opts?.ranges !== undefined) {
    if (opts.ranges.length === 0) {
      throw new Error('ranges must contain at least one voice range');
    }
    return opts.ranges.map((range) => ({ ...range }));
  }
  const voices = opts?.voices ?? 4;
  if (voices < 1) {
    throw new Error('voices must be at least 1');
  }
  if (voices === 4) {
    return SATB_RANGES.map((range) => ({ ...range }));
  }
  if (voices === 1) {
    return [{ min: DERIVED_LOW, max: DERIVED_HIGH }];
  }
  const ranges: VoiceRange[] = [];
  for (let i = 0; i < voices; i += 1) {
    const min = Math.round(
      DERIVED_LOW + (i * (DERIVED_HIGH - DERIVED_SPAN - DERIVED_LOW)) / (voices - 1),
    );
    ranges.push({ min, max: min + DERIVED_SPAN });
  }
  return ranges;
}

/** All MIDI pitches of a pitch class inside an inclusive range, ascending. */
function pitchesForPc(pc: number, range: VoiceRange): number[] {
  const result: number[] = [];
  for (let midi = Math.ceil(range.min); midi <= range.max; midi += 1) {
    if (pitchClass(midi) === pc) {
      result.push(midi);
    }
  }
  return result;
}

/**
 * Enumerate candidate voicings for a chord: the bass takes the chord's bass
 * (or root) pitch class at each available octave, and each upper voice takes
 * any chord pitch class within its range. Candidates are built in ascending
 * voice order and pruned to exclude voice crossings and over-wide adjacent
 * spacing (the bass–tenor pair is allowed an extra octave, per convention).
 * Enumeration is deterministic and capped at {@link MAX_CANDIDATES}.
 */
function enumerateVoicings(chord: Chord, ranges: VoiceRange[], maxSpacing: number): number[][] {
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
function structuralPenalty(pitches: number[], chord: Chord): number {
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
 * length: parallel perfects and parallel octaves on every voice pair, voice
 * crossings in the new voicing, and — on adjacent pairs — voice overlaps and
 * over-wide spacing between upper voices.
 */
function violationCount(prev: number[], cur: number[], maxSpacing: number): number {
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
      if (createsParallelOctave(prevUpper, curUpper, prevLower, curLower)) {
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

/**
 * Total voice-leading cost between two voicings: the sum of absolute semitone
 * motion across voices. The arrays must be the same length; when they differ
 * the voicings are not comparable and the cost is `Infinity`.
 *
 * @param from The previous voicing, one MIDI pitch per voice.
 * @param to The next voicing, one MIDI pitch per voice.
 * @returns The summed absolute motion, or `Infinity` when lengths differ.
 */
export function voiceLeadingCost(from: number[], to: number[]): number {
  if (from.length !== to.length) {
    return Number.POSITIVE_INFINITY;
  }
  let total = 0;
  for (let i = 0; i < from.length; i += 1) {
    const a = from[i];
    const b = to[i];
    if (a === undefined || b === undefined) {
      continue;
    }
    total += Math.abs(b - a);
  }
  return total;
}

/**
 * Realize a single chord as one MIDI pitch per voice, ascending (index 0 =
 * lowest). The bass voice takes the chord's `bassPc` when set, otherwise the
 * root; upper voices take chord pitch classes, doubling the root or fifth as
 * needed to fill all voices. The result stays inside each voice's range, keeps
 * adjacent upper voices within `maxSpacing`, avoids voice crossing, and is
 * deterministic: a compact close-position voicing centered in the ranges.
 *
 * @param chord The chord to voice.
 * @param opts Voicing options; defaults to four voices in {@link SATB_RANGES}.
 * @returns MIDI pitches, ascending, one per voice.
 * @throws If no voicing fits the given ranges.
 */
export function voiceChord(chord: Chord, opts?: VoicingOptions): number[] {
  const ranges = resolveRanges(opts);
  const maxSpacing = opts?.maxSpacing ?? DEFAULT_MAX_SPACING;
  const candidates = enumerateVoicings(chord, ranges, maxSpacing);
  let best: number[] | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    let score = structuralPenalty(candidate, chord);
    for (let i = 0; i < candidate.length; i += 1) {
      const pitch = candidate[i];
      const range = ranges[i];
      if (pitch === undefined || range === undefined) {
        continue;
      }
      // Prefer pitches near the middle of each voice's range for a centered,
      // compact default voicing.
      score += Math.abs(pitch - (range.min + range.max) / 2);
    }
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best === undefined) {
    throw new Error('no voicing satisfies the given ranges');
  }
  return best;
}

/**
 * Voice a chord progression with smooth voice leading. The first chord is
 * voiced with {@link voiceChord}; each subsequent chord picks, from a bounded
 * deterministic candidate set, the voicing minimizing the voice-leading cost
 * from the previous voicing plus a large penalty per counterpoint violation
 * (parallel perfects/octaves, voice crossing, voice overlap, and over-wide
 * upper-voice spacing).
 *
 * @param chords The chords to voice in order.
 * @param opts Voicing options; defaults to four voices in {@link SATB_RANGES}.
 * @returns One voicing per chord, each ascending with one MIDI pitch per voice.
 * @throws If any chord admits no voicing within the given ranges.
 */
export function voiceProgression(chords: Chord[], opts?: VoicingOptions): number[][] {
  const ranges = resolveRanges(opts);
  const maxSpacing = opts?.maxSpacing ?? DEFAULT_MAX_SPACING;
  const result: number[][] = [];
  let prev: number[] | undefined;
  for (const chord of chords) {
    if (prev === undefined) {
      prev = voiceChord(chord, opts);
      result.push(prev);
      continue;
    }
    const candidates = enumerateVoicings(chord, ranges, maxSpacing);
    let best: number[] | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const score =
        structuralPenalty(candidate, chord) +
        voiceLeadingCost(prev, candidate) +
        VIOLATION_PENALTY * violationCount(prev, candidate, maxSpacing);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best === undefined) {
      throw new Error('no voicing satisfies the given ranges');
    }
    result.push(best);
    prev = best;
  }
  return result;
}
