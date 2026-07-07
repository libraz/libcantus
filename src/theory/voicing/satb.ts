import type { Chord } from '../chord/index.js';
import {
  DEFAULT_MAX_SPACING,
  enumerateVoicings,
  structuralPenalty,
  VIOLATION_PENALTY,
  violationCount,
} from './internal.js';
import { voiceLeadingCost } from './leading.js';

/**
 * An inclusive MIDI pitch range for a single voice.
 *
 * @category Voicing & Counterpoint
 */
export type VoiceRange = {
  min: number;
  max: number;
};

/**
 * Default four-voice SATB ranges, ascending (index 0 = lowest):
 * bass E2–C4 (40–60), tenor C3–G4 (48–67), alto G3–D5 (55–74),
 * soprano C4–G5 (60–79).
 *
 * @category Voicing & Counterpoint
 */
export const SATB_RANGES: readonly VoiceRange[] = [
  { min: 40, max: 60 },
  { min: 48, max: 67 },
  { min: 55, max: 74 },
  { min: 60, max: 79 },
];

/**
 * Options controlling {@link voiceChord} and {@link voiceProgression}.
 *
 * @category Voicing & Counterpoint
 */
export type VoicingOptions = {
  /**
   * Number of voices to realize. Ignored when `ranges` is given.
   *
   * @defaultValue 4
   */
  voices?: number;
  /** Explicit per-voice ranges, ascending (index 0 = lowest). Takes precedence over `voices`. */
  ranges?: VoiceRange[];
  /**
   * Maximum spacing in semitones between adjacent upper voices.
   *
   * @defaultValue 12
   */
  maxSpacing?: number;
};

/** Overall pitch floor/ceiling used when deriving ranges for arbitrary voice counts. */
const DERIVED_LOW = 40;
const DERIVED_HIGH = 79;
/** Span of each derived per-voice range in semitones. */
const DERIVED_SPAN = 19;

/**
 * Resolve the per-voice ranges implied by the options: explicit `ranges` win,
 * four voices use {@link SATB_RANGES}, and other counts get evenly spaced
 * ranges spanning roughly the bass-to-soprano compass.
 */
export function resolveRanges(opts?: VoicingOptions): VoiceRange[] {
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
 * @example
 * ```ts
 * import { parseChordSymbol, voiceChord } from '@libraz/libcantus';
 * const chord = parseChordSymbol('Cmaj7');
 * voiceChord(chord); // four ascending MIDI pitches within the SATB ranges
 * ```
 * @category Voicing & Counterpoint
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
 * @example
 * ```ts
 * import { parseChordSymbol, voiceProgression } from '@libraz/libcantus';
 * const chords = ['C', 'Am', 'F', 'G'].map((s) => parseChordSymbol(s));
 * voiceProgression(chords); // one four-voice voicing per chord, smoothly led
 * ```
 * @category Voicing & Counterpoint
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
