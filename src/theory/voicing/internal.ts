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
 * Hard cap on search-tree nodes visited per chord. The candidate cap alone only
 * counts completed voicings, so a search whose upper voices admit no chord tone
 * would expand the whole cartesian product without ever reaching a leaf.
 */
const SEARCH_NODES_PER_CANDIDATE = 16;

/**
 * Moderate penalty for a hidden/direct perfect fifth or octave reached on the
 * outer-voice (bass–soprano) pair. Unlike a true parallel perfect it is
 * discouraged rather than forbidden, so the weight sits alongside voice-leading
 * motion rather than the hard {@link VIOLATION_PENALTY}.
 */
const HIDDEN_PERFECT_PENALTY = 6;

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
 * doubling anything other than the root or fifth, and — when a key is known —
 * heavily penalize doubling its leading tone.
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
  const leadingTonePc = key === undefined ? -1 : pitchClass(key.rootPc - 1);
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

/** The chord's own seventh as a pitch class, or -1 when it has none. */
function seventhPcOf(chord: Chord): number {
  for (const interval of chord.intervals) {
    const pc = pitchClass(chord.rootPc + interval);
    if (chordToneRole(pc, chord) === 'seventh') {
      return pc;
    }
  }
  return -1;
}

/**
 * The per-chord-pair tables {@link resolutionViolations} reads, worked out once
 * per chord rather than once per candidate.
 */
export type ResolutionTables = {
  /** The leaving chord's seventh, or -1 when it has none. */
  seventhPc: number;
  /** The key's leading tone, or -1 without a key. */
  leadingTonePc: number;
  /** The key's tonic, or -1 without a key. */
  tonicPc: number;
  /** Whether the arriving chord contains each pitch class 0-11. */
  nextHas: Uint8Array;
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
    seventhPc: seventhPcOf(prevChord),
    leadingTonePc: key === undefined ? -1 : pitchClass(key.rootPc - 1),
    tonicPc: key === undefined ? -1 : pitchClass(key.rootPc),
    nextHas,
  };
}

/**
 * Count the tendency tones that fail to resolve between two consecutive
 * voicings of the same progression.
 *
 * A chordal seventh is a dissonance: unless the next chord holds it as a common
 * tone, the voice carrying it must fall by step. A leading tone must rise to
 * the tonic whenever the next chord contains one; without a key there is no
 * leading tone to speak of, so that half of the rule is skipped.
 */
export function resolutionViolations(
  tables: ResolutionTables,
  prev: ArrayLike<number>,
  prevOffset: number,
  cur: ArrayLike<number>,
  curOffset: number,
  voices: number,
): number {
  const { seventhPc, leadingTonePc, tonicPc, nextHas } = tables;
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
    if (
      fromPc === leadingTonePc &&
      tonicPc >= 0 &&
      nextHas[tonicPc] === 1 &&
      nextHas[fromPc] === 0 &&
      motion !== 1
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * Total voice-leading cost from the voicing at `prevOffset` to the one at
 * `curOffset`: summed absolute semitone motion, plus
 * {@link HIDDEN_PERFECT_PENALTY} when the outer-voice pair reaches a
 * hidden/direct perfect fifth or octave by similar motion.
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
  // Discourage hidden/direct perfects between the outermost voices, where they
  // are most audible. True parallels are handled (and forbidden) elsewhere.
  if (voices >= 2) {
    const bassPrev = prev[prevOffset];
    const bassCur = cur[curOffset];
    const sopPrev = prev[prevOffset + voices - 1];
    const sopCur = cur[curOffset + voices - 1];
    if (
      bassPrev !== undefined &&
      bassCur !== undefined &&
      sopPrev !== undefined &&
      sopCur !== undefined &&
      createsHiddenParallelPerfect(bassPrev, bassCur, sopPrev, sopCur)
    ) {
      total += HIDDEN_PERFECT_PENALTY;
    }
  }
  return total;
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
