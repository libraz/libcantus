import { InvalidInputError, NoSolutionError } from '../../core/errors/index.js';
import {
  assertArray,
  assertFiniteNumber,
  assertGenerationBudget,
  assertOptions,
  assertPositiveInt,
} from '../../core/validation/index.js';
import type { Chord } from '../chord/index.js';
import { type KeyLike, type ResolvedKey, resolveKey } from '../scale/index.js';
import { type ChordLike, formatChordSymbol, toChordData } from '../symbol/index.js';
import {
  createCandidateBuffer,
  DEFAULT_MAX_SPACING,
  enumerateVoicings,
  leadingCost,
  MAX_LOOKAHEAD_PAIRS,
  type MoveScoring,
  moveScore,
  moveScoring,
  structuralPenalty,
  type VoicingCandidates,
  violationWeight,
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
   * tone is not doubled, and — where the chord being left is known as well —
   * it is not left unresolved. Without it, voicings are chosen from chord
   * structure and voice-leading distance alone.
   */
  key?: KeyLike;
  /**
   * The chord the current voicing was written on, as a chord symbol, chord
   * data, or a `Chord`.
   *
   * It enables every rule that is read from the chord being left: the
   * resolution of a chordal seventh, the resolution of a leading tone, and the
   * cross relation between the two chords. All three are scored exactly as
   * {@link voiceProgression} scores them, and none of them is scored without
   * it — a leading tone cannot be told from the third of a chord that merely
   * contains it until the chord it belongs to is known. Supply it whenever the
   * caller has the chord, not only where that chord carried a seventh.
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
  // Every voicing entrance resolves its ranges, so the options bag they share is
  // read as one here rather than at four entrances separately.
  assertOptions(opts, 'opts');
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
 * are handed one key rather than re-reading whatever form the caller wrote.
 *
 * The whole key, spelling and all: the search grades the letters it writes, and
 * a key handed in as an Ab minor would otherwise be scored on the sharps a G#
 * minor spells.
 */
export function resolvedKeyOf(opts?: VoicingOptions): ResolvedKey | undefined {
  return opts?.key === undefined ? undefined : resolveKey(opts.key);
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
 * How far a candidate sits from the middle of each voice's range, summed.
 *
 * A chord with nothing before it is placed by this alone once its structure is
 * settled: preferring pitches near the middle of every range is what makes the
 * default voicing centered and compact rather than pushed to one end of the
 * compass.
 */
function centeringPenalty(
  ranges: readonly VoiceRange[],
  pitches: ArrayLike<number>,
  offset: number,
  voices: number,
): number {
  let penalty = 0;
  for (let voice = 0; voice < voices; voice += 1) {
    const pitch = pitches[offset + voice];
    const range = ranges[voice];
    if (pitch === undefined || range === undefined) {
      continue;
    }
    penalty += Math.abs(pitch - (range.min + range.max) / 2);
  }
  return penalty;
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
  const { structure } = moveScoring(undefined, data, resolvedKeyOf(opts));
  const { pitches, voices } = candidates;
  let bestOffset = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < candidates.count; index += 1) {
    const offset = index * voices;
    const score =
      structuralPenalty(structure, pitches, offset, voices) +
      centeringPenalty(ranges, pitches, offset, voices);
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
 * Voice a chord progression with smooth voice leading. Each chord picks, from a
 * bounded deterministic candidate set, the voicing minimizing the voice-leading
 * cost from the previous voicing plus a large penalty per counterpoint
 * violation (parallel perfects/octaves, voice crossing, voice overlap, and
 * over-wide upper-voice spacing).
 *
 * The choice also weighs the chord that follows. A voicing costs whatever the
 * move onto the next chord will cost in broken rules, so a placement that is
 * marginally smoother now but strands a voice on a leap it cannot write cleanly
 * loses to the one that leaves the line somewhere the next chord can be reached
 * from. The lookahead is one chord deep and reads only the violation weight of
 * the connection, so a chord is otherwise voiced exactly as it would be on its
 * own merits.
 *
 * Tendency tones are resolved rather than merely moved economically: the voice
 * holding a chordal seventh falls by step unless the next chord keeps that tone,
 * and — when `opts.key` is given — the leading tone rises to the tonic and is
 * never doubled, wherever it is functioning as a leading tone rather than
 * sounding as an ordinary tone of some other chord. A key also names the letters
 * each voice is written with, which is what lets the search refuse the augmented
 * second between the lowered sixth and the raised seventh that a minor-key line
 * otherwise falls into. Without a key neither rule can apply, since nothing
 * identifies which pitch class is the leading tone or how a tone is spelled.
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

/** The chord after the one being voiced: its candidates, and how a move onto it scores. */
type Lookahead = {
  /** The next chord's candidate voicings. */
  candidates: VoicingCandidates;
  /** What a move from the chord being voiced onto that chord is scored against. */
  scoring: MoveScoring;
};

/**
 * The violation weight a candidate commits the next chord to: the weight of the
 * connection the following step would write, arriving from this candidate.
 *
 * The following step chooses by the whole score, so the connection weighed here
 * is the one it will actually pick rather than the cleanest one it could reach —
 * a lookahead that reported an unreachable best would recommend placements the
 * search then declines to use.
 */
function successorWeight(
  next: Lookahead,
  cur: ArrayLike<number>,
  curOffset: number,
  voices: number,
): number {
  const { candidates, scoring } = next;
  const { pitches } = candidates;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestWeight = 0;
  for (let candidate = 0; candidate < candidates.count; candidate += 1) {
    const offset = candidate * voices;
    const weight = violationWeight(scoring, cur, curOffset, pitches, offset, voices);
    const score =
      weight +
      structuralPenalty(scoring.structure, pitches, offset, voices) +
      leadingCost(cur, curOffset, pitches, offset, voices);
    if (score < bestScore) {
      bestScore = score;
      bestWeight = weight;
    }
  }
  return bestWeight;
}

/**
 * Voice a chord progression with smooth, bounded SATB-style leading.
 *
 * Each chord is chosen from a deterministic candidate set, minimizing motion
 * while penalizing counterpoint violations, and weighing the violations the
 * move onto the following chord would then be forced into. A supplied key
 * additionally resolves leading tones and chordal sevenths.
 *
 * @param chords The chords to voice in order.
 * @param opts Voicing options; defaults to four voices in {@link SATB_RANGES}.
 * @returns One ascending MIDI voicing per chord.
 * @throws {@link NoSolutionError} with the failing chord index when a chord
 *   cannot fit the requested ranges.
 * @category Voicing & Counterpoint
 */
export function voiceProgression(chords: readonly ChordLike[], opts?: VoicingOptions): number[][] {
  const progression = assertArray<ChordLike>(chords, 'chords');
  assertGenerationBudget(progression.length, 'voiced progression chords', opts?.budget);
  const data = progression.map((chord) => toChordData(chord));
  const key = resolvedKeyOf(opts);
  const ranges = resolveRanges(opts);
  const maxSpacing = resolveMaxSpacing(opts);
  const maxCandidates = resolveMaxCandidates(opts);
  const result: number[][] = [];
  const first = data[0];
  if (first === undefined) {
    return result;
  }
  // Two candidate buffers serve the whole progression: the chord being voiced,
  // and the one looked ahead to. Each step hands its lookahead buffer on as the
  // next step's own, so every chord is enumerated once and a lead sheet
  // allocates two buffers rather than two per chord.
  let current = locate(0, first, () =>
    enumerateVoicings(first, ranges, maxSpacing, maxCandidates, createCandidateBuffer()),
  );
  let spare = createCandidateBuffer();
  // The scoring of a move onto the chord being voiced is the very context its
  // predecessor built to look ahead with, so it is carried forward rather than
  // rebuilt.
  let scoring = moveScoring(undefined, first, key);
  let prev: number[] | undefined;
  for (const [index, chord] of data.entries()) {
    const nextChord = data[index + 1];
    const lookahead: Lookahead | undefined =
      nextChord === undefined
        ? undefined
        : {
            candidates: locate(index + 1, nextChord, () =>
              enumerateVoicings(nextChord, ranges, maxSpacing, maxCandidates, spare),
            ),
            // The chord after the one being reached goes in too: it is what
            // says whether the chromatic tone the next chord introduces is the
            // one an applied dominant is written with.
            scoring: moveScoring(chord, nextChord, key, data[index + 2]),
          };
    const { pitches, voices, count } = current;
    // A lookahead weighs every pair of candidates, so it is dropped wherever the
    // pairs would outgrow the bounded per-chord search — for the whole chord, so
    // no candidate is judged on terms the others were not.
    const weighed =
      lookahead !== undefined && count * lookahead.candidates.count <= MAX_LOOKAHEAD_PAIRS
        ? lookahead
        : undefined;
    let bestOffset = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < count; candidate += 1) {
      const offset = candidate * voices;
      let score =
        prev === undefined
          ? structuralPenalty(scoring.structure, pitches, offset, voices) +
            centeringPenalty(ranges, pitches, offset, voices)
          : moveScore(scoring, prev, 0, pitches, offset, voices);
      if (weighed !== undefined) {
        score += successorWeight(weighed, pitches, offset, voices);
      }
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
    if (lookahead !== undefined) {
      spare = current;
      current = lookahead.candidates;
      scoring = lookahead.scoring;
    }
  }
  return result;
}
