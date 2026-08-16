import { InvalidInputError, NoSolutionError } from '../../core/errors/index.js';
import type { KeyScale } from '../../core/types.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertPositiveInt,
} from '../../core/validation/index.js';
import type { Chord } from '../chord/index.js';
import { type KeyLike, toKeyScale } from '../scale/index.js';
import { type ChordLike, formatChordSymbol, toChordData } from '../symbol/index.js';
import {
  createCandidateBuffer,
  DEFAULT_MAX_SPACING,
  enumerateVoicings,
  leadingCost,
  RESOLUTION_PENALTY,
  resolutionTables,
  resolutionViolations,
  structuralPenalty,
  structuralTables,
  VIOLATION_PENALTY,
  violationCount,
} from './internal.js';

/**
 * An inclusive MIDI pitch range for a single voice.
 *
 * @category Voicing & Counterpoint
 */
export type VoiceRange = {
  readonly min: number;
  readonly max: number;
};

/**
 * Default four-voice SATB ranges, ascending (index 0 = lowest):
 * bass E2–C4 (40–60), tenor C3–G4 (48–67), alto G3–D5 (55–74),
 * soprano C4–G5 (60–79).
 *
 * @category Voicing & Counterpoint
 */
export const SATB_RANGES: readonly Readonly<VoiceRange>[] = Object.freeze([
  Object.freeze({ min: 40, max: 60 }),
  Object.freeze({ min: 48, max: 67 }),
  Object.freeze({ min: 55, max: 74 }),
  Object.freeze({ min: 60, max: 79 }),
]);

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
  /**
   * Maximum candidate voicings evaluated for one chord.
   *
   * Raise this for large voicings when exact optimum matters more than bounded
   * search time.
   *
   * @defaultValue 4000
   */
  maxCandidates?: number;
  /**
   * Maximum number of chords {@link voiceProgression} will voice. The search
   * per chord is bounded internally, so the cost of a progression is linear in
   * its length; this is the guard against an unbounded caller, not a limit on
   * the search.
   *
   * @defaultValue 1000000
   */
  budget?: number;
  /**
   * The prevailing key, as a key name, a key/scale, or a `Key`. Supplying it
   * enables the rules that only make sense relative to a tonic: the leading
   * tone is neither doubled nor left unresolved. Without it, voicings are
   * chosen from chord structure and voice-leading distance alone.
   */
  key?: KeyLike;
  /**
   * The chord that produced the current voicing passed to {@link nextVoicing},
   * as a chord symbol, chord data, or a `Chord`. When supplied, chordal-seventh
   * resolution is scored exactly as it is by {@link voiceProgression}.
   */
  previousChord?: ChordLike;
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
      throw new InvalidInputError('ranges must contain at least one voice range');
    }
    assertGenerationBudget(opts.ranges.length, 'voice ranges', 128);
    return opts.ranges.map((range, index) => {
      assertFiniteNumber(range.min, `ranges[${index}].min`);
      assertFiniteNumber(range.max, `ranges[${index}].max`);
      if (range.min > range.max) {
        throw new InvalidInputError(`ranges[${index}].min must not exceed max`);
      }
      assertGenerationBudget(
        Math.floor(range.max) - Math.ceil(range.min) + 1,
        `ranges[${index}] span`,
        4096,
      );
      return { ...range };
    });
  }
  const voices = opts?.voices ?? 4;
  assertPositiveInt(voices, 'voices', 128);
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
 * Resolve and validate the adjacent-voice spacing limit. Shared by every entry
 * point so `nextVoicing` cannot accept a NaN that silently disables the spacing
 * constraint, nor a negative value that reports itself as an impossible range.
 */
export function resolveMaxSpacing(opts?: VoicingOptions): number {
  const maxSpacing = opts?.maxSpacing ?? DEFAULT_MAX_SPACING;
  assertFiniteNumber(maxSpacing, 'maxSpacing');
  if (maxSpacing < 0) {
    throw new InvalidInputError('maxSpacing must be non-negative');
  }
  return maxSpacing;
}

/**
 * Resolve the prevailing key once per entry point, so the scoring tables below
 * are handed a key/scale rather than re-reading whatever form the caller wrote.
 */
export function resolveKey(opts?: VoicingOptions): KeyScale | undefined {
  return opts?.key === undefined ? undefined : toKeyScale(opts.key);
}

/** Resolve the chord a `nextVoicing` caller says the current voicing came from. */
export function resolvePreviousChord(opts?: VoicingOptions): Chord | undefined {
  return opts?.previousChord === undefined ? undefined : toChordData(opts.previousChord);
}

/** Resolve and validate the per-chord candidate-search cap. */
export function resolveMaxCandidates(opts?: VoicingOptions): number | undefined {
  if (opts?.maxCandidates === undefined) return undefined;
  assertPositiveInt(opts.maxCandidates, 'maxCandidates', 1_000_000);
  return opts.maxCandidates;
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
export function voiceChord(chord: ChordLike, opts?: VoicingOptions): number[] {
  const data = toChordData(chord);
  const ranges = resolveRanges(opts);
  const maxSpacing = resolveMaxSpacing(opts);
  const candidates = enumerateVoicings(data, ranges, maxSpacing, resolveMaxCandidates(opts));
  const tables = structuralTables(data, resolveKey(opts));
  const { pitches, voices } = candidates;
  let bestOffset = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < candidates.count; index += 1) {
    const offset = index * voices;
    let score = structuralPenalty(tables, pitches, offset, voices);
    for (let i = 0; i < voices; i += 1) {
      const pitch = pitches[offset + i];
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
      bestOffset = offset;
    }
  }
  if (bestOffset < 0) {
    throw new NoSolutionError(
      `no voicing satisfies the given ranges for ${formatChordSymbol(chord)}`,
    );
  }
  return [...pitches.subarray(bestOffset, bestOffset + voices)];
}

/**
 * Voice a chord progression with smooth voice leading. The first chord is
 * voiced with {@link voiceChord}; each subsequent chord picks, from a bounded
 * deterministic candidate set, the voicing minimizing the voice-leading cost
 * from the previous voicing plus a large penalty per counterpoint violation
 * (parallel perfects/octaves, voice crossing, voice overlap, and over-wide
 * upper-voice spacing).
 *
 * Tendency tones are resolved rather than merely moved economically: the voice
 * holding a chordal seventh falls by step unless the next chord keeps that tone,
 * and — when `opts.key` is given — the leading tone rises to the tonic and is
 * never doubled, wherever it is functioning as a leading tone rather than
 * sounding as an ordinary tone of some other chord. Without a key the
 * leading-tone rules cannot apply, since nothing identifies which pitch class is
 * the leading tone.
 *
 * @param chords The chords to voice in order.
 * @param opts Voicing options; defaults to four voices in {@link SATB_RANGES}.
 * @returns One voicing per chord, each ascending with one MIDI pitch per voice.
 * @throws If any chord admits no voicing within the given ranges, or if the
 *   progression is longer than `opts.budget` chords.
 * @example
 * ```ts
 * import { parseChordSymbol, voiceProgression } from '@libraz/libcantus';
 * const chords = ['C', 'Am', 'F', 'G'].map((s) => parseChordSymbol(s));
 * voiceProgression(chords); // one four-voice voicing per chord, smoothly led
 * ```
 * @category Voicing & Counterpoint
 */
/** The unsatisfiable-constraints error for one chord of a progression. */
function noSolutionAt(index: number, chord: Chord): NoSolutionError {
  return new NoSolutionError(
    `no voicing satisfies the given ranges for ${formatChordSymbol(chord)} at index ${index}`,
    { at: index },
  );
}

/**
 * Run one chord's work, re-raising an unsatisfiable-constraints failure with
 * the chord it happened on. Voicing a whole lead sheet is otherwise told only
 * that some chord did not fit.
 */
function locate<T>(index: number, chord: Chord, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof NoSolutionError) {
      throw noSolutionAt(index, chord);
    }
    throw error;
  }
}

/**
 * Voice a chord progression with smooth, bounded SATB-style leading.
 *
 * Each chord is chosen from a deterministic candidate set, minimizing motion
 * while penalizing counterpoint violations. A supplied key additionally
 * resolves leading tones and chordal sevenths.
 *
 * @param chords The chords to voice in order.
 * @param opts Voicing options; defaults to four voices in {@link SATB_RANGES}.
 * @returns One ascending MIDI voicing per chord.
 * @throws {@link NoSolutionError} with the failing chord index when a chord
 *   cannot fit the requested ranges.
 * @category Voicing & Counterpoint
 */
export function voiceProgression(chords: readonly ChordLike[], opts?: VoicingOptions): number[][] {
  assertGenerationBudget(chords.length, 'voiced progression chords', opts?.budget);
  const data = chords.map((chord) => toChordData(chord));
  const key = resolveKey(opts);
  const ranges = resolveRanges(opts);
  const maxSpacing = resolveMaxSpacing(opts);
  const maxCandidates = resolveMaxCandidates(opts);
  const result: number[][] = [];
  // One candidate buffer serves the whole progression: the search overwrites it
  // per chord, so a lead sheet allocates it once rather than once per chord.
  const buffer = createCandidateBuffer();
  let prev: number[] | undefined;
  let prevChord: Chord | undefined;
  for (let index = 0; index < data.length; index += 1) {
    const chord = data[index];
    if (chord === undefined) {
      continue;
    }
    if (prev === undefined) {
      prev = locate(index, chord, () => voiceChord(chord, opts));
      prevChord = chord;
      result.push(prev);
      continue;
    }
    const candidates = locate(index, chord, () =>
      enumerateVoicings(chord, ranges, maxSpacing, maxCandidates, buffer),
    );
    const { pitches, voices } = candidates;
    const structure = structuralTables(chord, key);
    const resolution =
      prevChord === undefined ? undefined : resolutionTables(prevChord, chord, key);
    let bestOffset = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < candidates.count; candidate += 1) {
      const offset = candidate * voices;
      const unresolved =
        resolution === undefined
          ? 0
          : resolutionViolations(resolution, prev, 0, pitches, offset, voices);
      const score =
        structuralPenalty(structure, pitches, offset, voices) +
        leadingCost(prev, 0, pitches, offset, voices) +
        VIOLATION_PENALTY * violationCount(prev, 0, pitches, offset, voices) +
        RESOLUTION_PENALTY * unresolved;
      if (score < bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }
    if (bestOffset < 0) {
      throw noSolutionAt(index, chord);
    }
    const best = [...pitches.subarray(bestOffset, bestOffset + voices)];
    result.push(best);
    prev = best;
    prevChord = chord;
  }
  return result;
}
