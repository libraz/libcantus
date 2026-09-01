import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';

export { pitchClassOf as pitchClass } from '../../core/pitch/index.js';

import { NoSolutionError } from '../../core/errors/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../chord/index.js';
import { chordPitchClasses, chordToneRole } from '../chord/index.js';
import {
  createsHiddenParallelPerfect,
  createsParallelPerfect,
  createsVoiceOverlap,
} from '../counterpoint/index.js';
import type { VoiceRange } from './satb.js';
import type { SpellingTable } from './tendency.js';
import {
  isFrustratedLeadingTone,
  isFunctioningLeadingTone,
  leadingTonePcOf,
  movesByAugmentedInterval,
  seventhPcOf,
  spellingTable,
} from './tendency.js';

/** Default maximum spacing between adjacent upper voices (one octave). */
export const DEFAULT_MAX_SPACING = 12;

/** Score penalty per counterpoint violation between consecutive voicings. */
export const VIOLATION_PENALTY = 1000;
/** Score penalty per chord tone absent from a voicing. */
const MISSING_TONE_PENALTY = 500;
/**
 * Score penalty for omitting the chord's fifth. Far milder than any other
 * missing tone: the fifth carries no identity, and the textbook resolution of a
 * complete dominant seventh onto a tonic triad — every tendency tone resolving
 * inward — leaves the tonic without its fifth. Weighted below
 * {@link RESOLUTION_PENALTY} so a resolution can buy the omission, and above
 * {@link POOR_DOUBLING_PENALTY} so nothing else can.
 */
const MISSING_FIFTH_PENALTY = 20;
/** Score penalty per doubled tone that is neither the root nor the fifth. */
const POOR_DOUBLING_PENALTY = 4;
/** Penalty for adjacent voices sharing exactly the same MIDI pitch. */
const UNISON_PENALTY = 100;
/**
 * Score penalty for doubling the key's leading tone. Doubling it guarantees
 * parallel octaves on its resolution, so it is a rule violation rather than a
 * matter of taste — weighted far above {@link POOR_DOUBLING_PENALTY}, but below
 * a missing chord tone, which damages the chord itself.
 */
const LEADING_TONE_DOUBLING_PENALTY = 200;
/**
 * Score penalty per tendency tone that fails to resolve. Well above the few
 * semitones of extra motion a correct resolution usually costs, so smoothness
 * can never buy an unresolved seventh, and well below
 * {@link VIOLATION_PENALTY}, so avoiding parallels still comes first.
 */
export const RESOLUTION_PENALTY = 200;
/** Hard cap on candidate voicings evaluated per chord, keeping the search bounded. */
const DEFAULT_MAX_CANDIDATES = 4000;
/**
 * Hard cap on the candidate pairs one chord's lookahead may weigh. A lookahead
 * reads every candidate of the chord against every candidate of the chord after
 * it, so the pairs grow as the square of a per-chord search that is itself only
 * bounded at a few thousand. Past this many the lookahead is dropped for that
 * chord — for all of its candidates alike, so the choice is never biased by
 * where the cap happened to fall.
 */
export const MAX_LOOKAHEAD_PAIRS = 1_000_000;
/**
 * Hard cap on search-tree nodes visited per chord. The candidate cap alone only
 * counts completed voicings, so a search whose upper voices admit no chord tone
 * would expand the whole cartesian product without ever reaching a leaf.
 */
const SEARCH_NODES_PER_CANDIDATE = 16;

/**
 * Score penalty for a hidden/direct perfect fifth or octave reached on the
 * outer-voice (bass–soprano) pair. The checker reports one as a broken rule, so
 * the search cannot treat it as a nudge: the weight is heavy enough that the
 * textbook escape — tripling the root and omitting the fifth, which costs
 * {@link MISSING_FIFTH_PENALTY} — is the cheaper answer. It stays below
 * {@link VIOLATION_PENALTY} because a hidden perfect is discouraged where a
 * true parallel is forbidden, which is the order the rules are ranked in.
 *
 * It is scored beside the other penalties rather than inside
 * {@link leadingCost}, whose published sibling `voiceLeadingCost` is defined as
 * the summed semitone motion and nothing else.
 */
export const HIDDEN_PERFECT_PENALTY = 100;

/**
 * Score penalty per voice moving by an augmented interval. The augmented second
 * between the lowered sixth and the raised seventh is what a minor-key search
 * writes if nothing stops it, and the checker reports it as a broken rule
 * rather than as rough writing — so it is weighted with the counterpoint
 * violations, where no amount of smoother motion can buy it back, rather than
 * alongside them. A chord whose every candidate writes one is still voiced: the
 * penalty then falls on all of them alike and the rest of the scoring decides.
 */
export const AUGMENTED_MELODIC_PENALTY = VIOLATION_PENALTY;

/**
 * Candidate voicings of one chord, held flat: voice `v` of candidate `i` sits at
 * `pitches[i * voices + v]`.
 *
 * A four-voice search reaches four thousand candidates, so a voicing per
 * candidate would be four thousand short arrays per chord — the bulk of what
 * voicing a lead sheet allocates. One buffer holds them all instead, and
 * {@link voiceProgression} reuses the same buffer for every chord, so the whole
 * progression allocates it once.
 */
export type VoicingCandidates = {
  /** The candidate pitches, valid up to `count * voices`. */
  pitches: Int32Array;
  /** How many candidates the last enumeration wrote. */
  count: number;
  /** Voices per candidate, i.e. the stride of `pitches`. */
  voices: number;
};

/** Candidates a fresh buffer holds before it has to grow. */
const INITIAL_CANDIDATE_CAPACITY = 512;

/** An empty candidate buffer, ready to be filled by {@link enumerateVoicings}. */
export function createCandidateBuffer(): VoicingCandidates {
  return { pitches: new Int32Array(0), count: 0, voices: 0 };
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
 * Enumeration is deterministic and capped at `maxCandidates` completed
 * voicings and a proportional number of visited nodes.
 *
 * Each voice's admissible pitches are resolved once up front rather than
 * recomputed at every node, and a voice that admits no chord tone at all fails
 * immediately: continuing would explore every combination of the voices below
 * it only to reach no leaf.
 *
 * @param into A buffer to fill, reused and grown in place. Pass the same one
 *   for every chord of a progression so the search allocates once rather than
 *   once per chord.
 * @throws If any voice's range contains no pitch of any chord tone.
 */
export function enumerateVoicings(
  chord: Chord,
  ranges: VoiceRange[],
  maxSpacing: number,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  into: VoicingCandidates = createCandidateBuffer(),
): VoicingCandidates {
  const chordPcs = chordPitchClasses(chord);
  const bassPc = pitchClass(chord.bassPc ?? chord.rootPc);
  // Pitch-class-major order, matching the enumeration order of the search.
  const byVoice = ranges.map((range, voice) =>
    (voice === 0 ? [bassPc] : chordPcs).flatMap((pc) => pitchesForPc(pc, range)),
  );
  for (let voice = 0; voice < byVoice.length; voice += 1) {
    if ((byVoice[voice] ?? []).length === 0) {
      throw new NoSolutionError('no voicing satisfies the given ranges');
    }
  }
  const voices = ranges.length;
  into.voices = voices;
  into.count = 0;
  let capacity = Math.floor(into.pitches.length / Math.max(1, voices));
  if (capacity === 0) {
    capacity = Math.min(maxCandidates, INITIAL_CANDIDATE_CAPACITY);
    into.pitches = new Int32Array(capacity * voices);
  }
  const current = new Int32Array(voices);
  let nodes = 0;
  const maxSearchNodes = maxCandidates * SEARCH_NODES_PER_CANDIDATE;
  const build = (voice: number): void => {
    nodes += 1;
    if (into.count >= maxCandidates || nodes > maxSearchNodes) {
      return;
    }
    if (voice === voices) {
      if (into.count === capacity) {
        capacity = Math.min(maxCandidates, capacity * 2);
        const grown = new Int32Array(capacity * voices);
        grown.set(into.pitches.subarray(0, into.count * voices));
        into.pitches = grown;
      }
      into.pitches.set(current, into.count * voices);
      into.count += 1;
      return;
    }
    const prev = voice === 0 ? undefined : current[voice - 1];
    for (const pitch of byVoice[voice] ?? []) {
      if (prev !== undefined) {
        if (pitch < prev) {
          continue; // would cross below the next lower voice
        }
        const spacingLimit = voice === 1 ? maxSpacing + 12 : maxSpacing;
        if (pitch - prev > spacingLimit) {
          continue;
        }
      }
      current[voice] = pitch;
      build(voice + 1);
    }
  };
  build(0);
  return into;
}

/**
 * The per-chord tables {@link structuralPenalty} reads.
 *
 * Every entry is a function of the chord and key alone, so it is worked out
 * once per chord instead of once per candidate — which is what keeps a
 * four-thousand-candidate search from rebuilding the chord's pitch-class set,
 * and re-deriving every tone's role, four thousand times.
 */
export type StructuralTables = {
  /** The chord's pitch classes, ascending. */
  tones: readonly number[];
  /** Penalty for the tone at the same index of `tones` being absent. */
  missing: readonly number[];
  /** Penalty per extra copy of each pitch class 0-11. */
  doubling: Float64Array;
};

/**
 * Build the structural tables for one chord: heavily penalize missing chord
 * tones (mildly for the fifth, which carries no identity), mildly penalize
 * doubling anything other than the root or fifth, and — when a key is known and
 * the chord is one where the leading tone functions as one — heavily penalize
 * doubling that leading tone.
 *
 * The exempt fifth is the chord's own fifth, whatever its size: a diminished,
 * augmented, or absent fifth would leave the root as the only freely doubled
 * tone, which is what forces a doubled leading tone in a `viio` chord.
 */
export function structuralTables(chord: Chord, key?: KeyScale): StructuralTables {
  const tones = chordPitchClasses(chord);
  const missing = tones.map((pc) =>
    chordToneRole(pc, chord) === 'fifth' ? MISSING_FIFTH_PENALTY : MISSING_TONE_PENALTY,
  );
  const rootPc = pitchClass(chord.rootPc);
  const leadingTonePc =
    key !== undefined && isFunctioningLeadingTone(chord, key) ? leadingTonePcOf(key) : -1;
  const doubling = new Float64Array(12);
  for (let pc = 0; pc < 12; pc += 1) {
    if (pc === leadingTonePc) {
      doubling[pc] = LEADING_TONE_DOUBLING_PENALTY;
    } else if (pc !== rootPc && chordToneRole(pc, chord) !== 'fifth') {
      doubling[pc] = POOR_DOUBLING_PENALTY;
    }
  }
  return { tones, missing, doubling };
}

/**
 * Pitch-class tally shared by every structural evaluation. The scoring loop
 * calls nothing that could re-enter it, so one buffer serves the whole search.
 */
const PITCH_CLASS_COUNTS = new Int32Array(12);

/**
 * Structural quality penalty of the candidate at `offset` in `pitches`, read
 * off the chord's {@link StructuralTables}.
 */
export function structuralPenalty(
  tables: StructuralTables,
  pitches: ArrayLike<number>,
  offset: number,
  voices: number,
): number {
  PITCH_CLASS_COUNTS.fill(0);
  let penalty = 0;
  for (let index = 0; index < voices; index += 1) {
    const pitch = pitches[offset + index];
    if (pitch === undefined) {
      continue;
    }
    const pc = pitchClass(pitch);
    PITCH_CLASS_COUNTS[pc] = (PITCH_CLASS_COUNTS[pc] ?? 0) + 1;
    if (index > 0 && pitch === pitches[offset + index - 1]) {
      penalty += UNISON_PENALTY;
    }
  }
  for (let index = 0; index < tables.tones.length; index += 1) {
    const pc = tables.tones[index];
    if (pc !== undefined && PITCH_CLASS_COUNTS[pc] === 0) {
      penalty += tables.missing[index] ?? 0;
    }
  }
  for (let pc = 0; pc < 12; pc += 1) {
    const count = PITCH_CLASS_COUNTS[pc] ?? 0;
    if (count > 1) {
      penalty += (count - 1) * (tables.doubling[pc] ?? 0);
    }
  }
  return penalty;
}

/**
 * The per-chord-pair tables {@link resolutionViolations} reads, worked out once
 * per chord rather than once per candidate.
 */
export type ResolutionTables = {
  /** The leaving chord's seventh, or -1 when it has none. */
  seventhPc: number;
  /**
   * The key's leading tone, or -1 without a key and wherever the leaving chord
   * is not one the leading tone functions in.
   */
  leadingTonePc: number;
  /** The key's tonic, or -1 without a key. */
  tonicPc: number;
  /** Whether the arriving chord contains each pitch class 0-11. */
  nextHas: Uint8Array;
  /** The arriving chord itself, which names the fifth a leading tone may fall to. */
  nextChord: Chord;
};

/** Build the resolution tables for one chord-to-chord move. */
export function resolutionTables(
  prevChord: Chord,
  nextChord: Chord,
  key?: KeyScale,
): ResolutionTables {
  const nextHas = new Uint8Array(12);
  for (const pc of chordPitchClasses(nextChord)) {
    nextHas[pc] = 1;
  }
  return {
    seventhPc: seventhPcOf(prevChord) ?? -1,
    leadingTonePc:
      key !== undefined && isFunctioningLeadingTone(prevChord, key) ? leadingTonePcOf(key) : -1,
    tonicPc: key === undefined ? -1 : pitchClass(key.rootPc),
    nextHas,
    nextChord,
  };
}

/**
 * Count the tendency tones that fail to resolve between two consecutive
 * voicings of the same progression.
 *
 * A chordal seventh is a dissonance: unless the next chord holds it as a common
 * tone, the voice carrying it must fall by step. A leading tone must rise to
 * the tonic whenever the next chord contains one, and only where it is
 * functioning as a leading tone; without a key there is no leading tone to
 * speak of, so that half of the rule is skipped. An inner voice may frustrate
 * its leading tone instead, exactly as {@link checkPartWriting} allows, so the
 * search is not scored against a resolution its own checker accepts.
 */
export function resolutionViolations(
  tables: ResolutionTables,
  prev: ArrayLike<number>,
  prevOffset: number,
  cur: ArrayLike<number>,
  curOffset: number,
  voices: number,
): number {
  const { seventhPc, leadingTonePc, tonicPc, nextHas, nextChord } = tables;
  let count = 0;
  for (let voice = 0; voice < voices; voice += 1) {
    const from = prev[prevOffset + voice];
    const to = cur[curOffset + voice];
    if (from === undefined || to === undefined) {
      continue;
    }
    const fromPc = pitchClass(from);
    const motion = to - from;
    if (fromPc === seventhPc && nextHas[fromPc] === 0 && motion !== -1 && motion !== -2) {
      count += 1;
    }
    const inner = voice > 0 && voice < voices - 1;
    if (
      fromPc === leadingTonePc &&
      tonicPc >= 0 &&
      nextHas[tonicPc] === 1 &&
      nextHas[fromPc] === 0 &&
      motion !== 1 &&
      !(inner && isFrustratedLeadingTone(from, to, nextChord))
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * Total voice-leading cost from the voicing at `prevOffset` to the one at
 * `curOffset`: the summed absolute semitone motion, and nothing else.
 */
export function leadingCost(
  prev: ArrayLike<number>,
  prevOffset: number,
  cur: ArrayLike<number>,
  curOffset: number,
  voices: number,
): number {
  let total = 0;
  for (let voice = 0; voice < voices; voice += 1) {
    const a = prev[prevOffset + voice];
    const b = cur[curOffset + voice];
    if (a === undefined || b === undefined) {
      continue;
    }
    total += Math.abs(b - a);
  }
  return total;
}

/**
 * Whether the outermost voices reach a hidden/direct perfect fifth or octave by
 * similar motion, the pair {@link checkPartWriting} judges the rule on. Between
 * inner voices the interval is covered by the others, and no rule reports it.
 */
export function createsOuterHiddenPerfect(
  prev: ArrayLike<number>,
  prevOffset: number,
  cur: ArrayLike<number>,
  curOffset: number,
  voices: number,
): boolean {
  if (voices < 2) {
    return false;
  }
  const bassPrev = prev[prevOffset];
  const bassCur = cur[curOffset];
  const sopPrev = prev[prevOffset + voices - 1];
  const sopCur = cur[curOffset + voices - 1];
  if (
    bassPrev === undefined ||
    bassCur === undefined ||
    sopPrev === undefined ||
    sopCur === undefined
  ) {
    return false;
  }
  return createsHiddenParallelPerfect(sopPrev, sopCur, bassPrev, bassCur);
}

/**
 * The spelling of the chord left and of the chord reached, which is what lets
 * the search read the letters its own output will be checked by.
 */
export type MelodicSpelling = {
  /** How the chord being left is written. */
  from: SpellingTable;
  /** How the chord being reached is written. */
  to: SpellingTable;
};

/**
 * Count the voices that move by an augmented interval between two consecutive
 * voicings, reading both through the spelling
 * {@link spellVoicing} gives them.
 */
export function augmentedMelodicCount(
  spelling: MelodicSpelling,
  prev: ArrayLike<number>,
  prevOffset: number,
  cur: ArrayLike<number>,
  curOffset: number,
  voices: number,
): number {
  let count = 0;
  for (let voice = 0; voice < voices; voice += 1) {
    const from = prev[prevOffset + voice];
    const to = cur[curOffset + voice];
    if (from === undefined || to === undefined) {
      continue;
    }
    if (movesByAugmentedInterval(spelling.from, from, spelling.to, to)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Count counterpoint violations between two consecutive voicings of equal
 * length: parallel perfects (fifths and octaves alike, since octaves are the
 * perfect-class-zero case of {@link createsParallelPerfect}) on every voice
 * pair, and voice overlaps on adjacent pairs.
 *
 * Voice crossing and over-wide spacing are not counted: {@link
 * enumerateVoicings} rejects both while building a candidate, so a candidate
 * that reaches here cannot exhibit either. Overlap involves the previous
 * voicing and so is still live.
 */
export function violationCount(
  prev: ArrayLike<number>,
  prevOffset: number,
  cur: ArrayLike<number>,
  curOffset: number,
  voices: number,
): number {
  let count = 0;
  for (let lower = 0; lower < voices; lower += 1) {
    for (let upper = lower + 1; upper < voices; upper += 1) {
      const prevLower = prev[prevOffset + lower];
      const prevUpper = prev[prevOffset + upper];
      const curLower = cur[curOffset + lower];
      const curUpper = cur[curOffset + upper];
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
      if (upper === lower + 1) {
        if (createsVoiceOverlap(prevUpper, curUpper, prevLower, curLower)) {
          count += 1;
        }
      }
    }
  }
  return count;
}

/**
 * Everything a move onto one chord is scored against, worked out once per chord
 * and then read for each of the candidates weighed against it.
 */
export type MoveScoring = {
  /** The arriving chord's structural tables. */
  structure: StructuralTables;
  /** The tendency-tone tables, absent when no chord is being left. */
  resolution: ResolutionTables | undefined;
  /** How both chords are written, absent when no key names the letters. */
  spelling: MelodicSpelling | undefined;
};

/**
 * Build the scoring context of a move onto `chord`.
 *
 * The letters are only decidable against a key, so the augmented-interval rule
 * joins the search wherever one was given — the same condition the leading-tone
 * rules are under.
 *
 * @param prevChord The chord being left, or undefined when nothing precedes it.
 * @param chord The chord being reached.
 * @param key The prevailing key, or undefined when none was given.
 */
export function moveScoring(
  prevChord: Chord | undefined,
  chord: Chord,
  key?: KeyScale,
): MoveScoring {
  return {
    structure: structuralTables(chord, key),
    resolution: prevChord === undefined ? undefined : resolutionTables(prevChord, chord, key),
    spelling:
      key === undefined
        ? undefined
        : { from: spellingTable(key, prevChord), to: spellingTable(key, chord) },
  };
}

/**
 * The rule-violation weight of one move: the counterpoint violations, the
 * tendency tones left unresolved, the augmented intervals written, and a direct
 * perfect reached by the outer voices.
 *
 * This is the part of a move's score that a shorter line cannot buy back, which
 * is also what makes it the part worth looking a chord ahead for: a candidate
 * that spares its successor a broken rule is worth reaching for, while one that
 * merely spares it a few semitones of motion is not.
 */
export function violationWeight(
  scoring: MoveScoring,
  prev: ArrayLike<number>,
  prevOffset: number,
  cur: ArrayLike<number>,
  curOffset: number,
  voices: number,
): number {
  const { resolution, spelling } = scoring;
  const unresolved =
    resolution === undefined
      ? 0
      : resolutionViolations(resolution, prev, prevOffset, cur, curOffset, voices);
  const augmented =
    spelling === undefined
      ? 0
      : augmentedMelodicCount(spelling, prev, prevOffset, cur, curOffset, voices);
  return (
    VIOLATION_PENALTY * violationCount(prev, prevOffset, cur, curOffset, voices) +
    RESOLUTION_PENALTY * unresolved +
    AUGMENTED_MELODIC_PENALTY * augmented +
    (createsOuterHiddenPerfect(prev, prevOffset, cur, curOffset, voices)
      ? HIDDEN_PERFECT_PENALTY
      : 0)
  );
}

/**
 * The whole score of one move: its rule-violation weight, the structural
 * quality of the chord arrived on, and the distance the voices travelled.
 */
export function moveScore(
  scoring: MoveScoring,
  prev: ArrayLike<number>,
  prevOffset: number,
  cur: ArrayLike<number>,
  curOffset: number,
  voices: number,
): number {
  return (
    structuralPenalty(scoring.structure, cur, curOffset, voices) +
    leadingCost(prev, prevOffset, cur, curOffset, voices) +
    violationWeight(scoring, prev, prevOffset, cur, curOffset, voices)
  );
}
