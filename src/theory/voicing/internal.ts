import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';

export { pitchClassOf as pitchClass } from '../../core/pitch/index.js';

import { NoSolutionError } from '../../core/errors/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../chord/index.js';
import { chordPitchClasses, chordToneRole } from '../chord/index.js';
import { createsParallelPerfect, createsVoiceOverlap } from '../counterpoint/index.js';
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
export const RESOLUTION_PENALTY = 40;
/** Hard cap on candidate voicings evaluated per chord, keeping the search bounded. */
const MAX_CANDIDATES = 4000;
/**
 * Hard cap on search-tree nodes visited per chord. The candidate cap alone only
 * counts completed voicings, so a search whose upper voices admit no chord tone
 * would expand the whole cartesian product without ever reaching a leaf.
 */
const MAX_SEARCH_NODES = MAX_CANDIDATES * 16;

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
 * Enumeration is deterministic and capped at {@link MAX_CANDIDATES} completed
 * voicings and {@link MAX_SEARCH_NODES} visited nodes.
 *
 * Each voice's admissible pitches are resolved once up front rather than
 * recomputed at every node, and a voice that admits no chord tone at all fails
 * immediately: continuing would explore every combination of the voices below
 * it only to reach no leaf.
 *
 * @throws If any voice's range contains no pitch of any chord tone.
 */
export function enumerateVoicings(
  chord: Chord,
  ranges: VoiceRange[],
  maxSpacing: number,
): number[][] {
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
  const results: number[][] = [];
  const current: number[] = [];
  let nodes = 0;
  const build = (voice: number): void => {
    nodes += 1;
    if (results.length >= MAX_CANDIDATES || nodes > MAX_SEARCH_NODES) {
      return;
    }
    if (voice === ranges.length) {
      results.push([...current]);
      return;
    }
    const prev = current[voice - 1];
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
      current.push(pitch);
      build(voice + 1);
      current.pop();
    }
  };
  build(0);
  return results;
}

/**
 * Structural quality penalty of a single voicing: heavily penalize missing
 * chord tones (mildly for the fifth, which carries no identity), mildly
 * penalize doubling anything other than the root or fifth, and — when a key is
 * known — heavily penalize doubling its leading tone.
 *
 * The exempt fifth is the chord's own fifth, whatever its size: a diminished,
 * augmented, or absent fifth would leave the root as the only freely doubled
 * tone, which is what forces a doubled leading tone in a `viio` chord.
 */
export function structuralPenalty(pitches: number[], chord: Chord, key?: KeyScale): number {
  const counts = new Map<number, number>();
  for (const pitch of pitches) {
    const pc = pitchClass(pitch);
    counts.set(pc, (counts.get(pc) ?? 0) + 1);
  }
  let penalty = 0;
  for (const pc of chordPitchClasses(chord)) {
    if (!counts.has(pc)) {
      penalty +=
        chordToneRole(pc, chord) === 'fifth' ? MISSING_FIFTH_PENALTY : MISSING_TONE_PENALTY;
    }
  }
  const rootPc = pitchClass(chord.rootPc);
  const leadingTonePc = key === undefined ? undefined : pitchClass(key.rootPc - 1);
  for (const [pc, count] of counts) {
    if (count <= 1) {
      continue;
    }
    if (pc === leadingTonePc) {
      penalty += (count - 1) * LEADING_TONE_DOUBLING_PENALTY;
      continue;
    }
    if (pc !== rootPc && chordToneRole(pc, chord) !== 'fifth') {
      penalty += (count - 1) * POOR_DOUBLING_PENALTY;
    }
  }
  return penalty;
}

/** The chord's own seventh as a pitch class, or undefined when it has none. */
function seventhPcOf(chord: Chord): number | undefined {
  for (const interval of chord.intervals) {
    const pc = pitchClass(chord.rootPc + interval);
    if (chordToneRole(pc, chord) === 'seventh') {
      return pc;
    }
  }
  return undefined;
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
  prev: number[],
  cur: number[],
  prevChord: Chord,
  nextChord: Chord,
  key?: KeyScale,
): number {
  const seventhPc = seventhPcOf(prevChord);
  const leadingTonePc = key === undefined ? undefined : pitchClass(key.rootPc - 1);
  const tonicPc = key === undefined ? undefined : pitchClass(key.rootPc);
  const nextPcs = new Set(chordPitchClasses(nextChord));
  let count = 0;
  for (let voice = 0; voice < prev.length && voice < cur.length; voice += 1) {
    const from = prev[voice];
    const to = cur[voice];
    if (from === undefined || to === undefined) {
      continue;
    }
    const fromPc = pitchClass(from);
    const motion = to - from;
    if (fromPc === seventhPc && !nextPcs.has(fromPc) && motion !== -1 && motion !== -2) {
      count += 1;
    }
    if (
      fromPc === leadingTonePc &&
      tonicPc !== undefined &&
      nextPcs.has(tonicPc) &&
      !nextPcs.has(fromPc) &&
      motion !== 1
    ) {
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
export function violationCount(prev: number[], cur: number[]): number {
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
      if (upper === lower + 1) {
        if (createsVoiceOverlap(prevUpper, curUpper, prevLower, curLower)) {
          count += 1;
        }
      }
    }
  }
  return count;
}
