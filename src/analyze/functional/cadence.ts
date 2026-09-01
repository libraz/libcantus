/**
 * Cadence detection between two successive chords.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordToneRole } from '../../theory/chord/index.js';
import { chordToneRole } from '../../theory/chord/index.js';
import { isScaleTone, type KeyLike, scaleSystemOf, toKeyScale } from '../../theory/scale/index.js';
import { type ChordLike, toChordData } from '../../theory/symbol/index.js';
import { isDominantChordOf, isLeadingToneChordOf } from '../../theory/tendency/index.js';
import {
  degreeRootPc,
  hasMajorThird,
  isMinorScale,
  mod12,
  parallelScale,
  romanReference,
} from './internal.js';
import type { RejectedCandidate } from './rationale.js';

/** The scale degrees the cadence rules are stated in. */
const SUBDOMINANT_DEGREE = 4;
const DOMINANT_DEGREE = 5;
const SUBMEDIANT_DEGREE = 6;

/**
 * How far above the tonic a scale degree lies, read in the heptatonic frame the
 * key's degrees are numbered in.
 *
 * Which semitone a degree lands on is the mode's business — the submediant is a
 * major sixth in dorian and a minor sixth in aeolian — so a cadence stated in
 * semitones would hold for two modes and miss the rest. A key with no
 * degree-for-degree numbering of its own is read against its parallel major,
 * the same frame its numerals use.
 */
function degreeOffset(degreeNumber: number, key: KeyScale): number {
  return mod12(degreeRootPc(degreeNumber, romanReference(key)) - key.rootPc);
}

/** Whether the chord's own third — major or minor — is a tone of the key. */
function thirdBelongsToKey(chord: Chord, key: KeyScale): boolean {
  return chord.intervals.some(
    (interval) =>
      (mod12(interval) === 3 || mod12(interval) === 4) &&
      isScaleTone(mod12(chord.rootPc + interval), key),
  );
}

/**
 * The offsets a deceptive cadence may land on: the key's own submediant, and in
 * a major key the borrowed lowered submediant as well, since the flat-side
 * arrival evades the tonic the same way.
 */
function deceptiveTargets(key: KeyScale): number[] {
  const submediant = degreeOffset(SUBMEDIANT_DEGREE, key);
  if (isMinorScale(key)) {
    return [submediant];
  }
  const borrowed = degreeOffset(SUBMEDIANT_DEGREE, parallelScale(key));
  return borrowed === submediant ? [submediant] : [submediant, borrowed];
}

/**
 * Whether an arrival on the dominant degree rests there as a half cadence.
 *
 * The dominant of a key functional harmony was built on carries the leading
 * tone, and that major third is what the cadence is heard through, so a
 * borrowed minor `v` is not the chord the ear was left on. A mode is held
 * together by something other than a dominant-to-tonic cadence and has only the
 * dominant it does have, so there the arrival's own third serves, provided the
 * key contains it.
 *
 * The relaxation follows the scale system rather than the mask alone. A natural
 * minor key writes no raised seventh in its signature either, yet it cadences
 * through one: reading the bare mask would let every minor `i - v` be reported
 * as a half cadence and put a phrase boundary where the music has none.
 */
function restsOnDominant(to: Chord, key: KeyScale): boolean {
  if (hasMajorThird(to)) {
    return true;
  }
  if (scaleSystemOf(key) !== 'modal') {
    return false;
  }
  const dominantPc = mod12(key.rootPc + degreeOffset(DOMINANT_DEGREE, key));
  const leadingToneDominant = isScaleTone(mod12(dominantPc + 4), key);
  return !leadingToneDominant && thirdBelongsToKey(to, key);
}

/** Whether a chord is the key's tonic triad standing on its own fifth. */
function isTonicSixFour(chord: Chord, key: KeyScale): boolean {
  if (mod12(chord.rootPc - key.rootPc) !== 0 || chord.bassPc === undefined) {
    return false;
  }
  const isTriad =
    chord.intervals.length === 3 && chord.intervals.some((interval) => mod12(interval) === 7);
  return isTriad && mod12(chord.bassPc - chord.rootPc) === 7;
}

/**
 * Whether a chord is the cadential six-four of the chord that follows it.
 *
 * The cadential six-four is not an inverted tonic. Its bass has already
 * arrived on the dominant, and the tonic and third sounding above it are
 * appoggiaturas that resolve down onto the dominant's own leading tone and
 * fifth — so the harmony is the dominant from the moment the six-four sounds,
 * and a cadence it opens begins there rather than at the dominant's arrival.
 *
 * The reading rests on the bass: the tonic triad has to stand on the same
 * pitch class the dominant does. A six-four the bass leaves — the passing
 * `IV-I64-IV`, a neighbouring one over the tonic — is an ordinary inverted
 * tonic and answers false, which is what keeps this from swallowing every
 * second-inversion tonic in sight.
 *
 * The chord pair is enough to answer, so the layers that see time — cadence
 * detection over a timeline, harmonic reduction — can all ask the same
 * question of the same two chords instead of each deciding for itself.
 *
 * @param chord The candidate six-four.
 * @param next The chord it moves to.
 * @param key The prevailing key.
 * @returns True when `chord` is the cadential six-four of `next`.
 */
export function isCadentialSixFour(chord: Chord, next: Chord, key: KeyScale): boolean {
  return (
    isTonicSixFour(chord, key) &&
    isDominantChordOf(next, key) &&
    mod12(chord.bassPc ?? chord.rootPc) === mod12(next.bassPc ?? next.rootPc)
  );
}

/**
 * The outer voices of a voicing: its lowest and highest sounding pitches.
 *
 * Non-finite entries name no pitch, so they are skipped rather than dragging
 * the bass or the soprano to a value nothing sounds.
 */
function outerPitches(voicing: readonly number[]): { bass?: number; soprano?: number } {
  let bass: number | undefined;
  let soprano: number | undefined;
  for (const pitch of voicing) {
    if (!Number.isFinite(pitch)) {
      continue;
    }
    if (bass === undefined || pitch < bass) {
      bass = pitch;
    }
    if (soprano === undefined || pitch > soprano) {
      soprano = pitch;
    }
  }
  return { bass, soprano };
}

/**
 * The pitch class sounding in a chord's bass.
 *
 * A voicing settles it outright: whatever is written, the lowest sounding pitch
 * is the bass. Without one the chord's own `bassPc` answers, and a chord naming
 * no bass stands on its root.
 */
function bassPcOf(chord: Chord, voicedBass: number | undefined): number {
  return mod12(voicedBass ?? chord.bassPc ?? chord.rootPc);
}

/**
 * A recognized cadence, with the voice-leading facts its reading rests on.
 *
 * @category Functional Harmony
 */
export type CadenceResult = {
  /**
   * The cadence the chord pair forms, or null when it forms none.
   *
   * `'phrygian'` and `'modal'` are the two named species: the first is a
   * specific half cadence and is reported in place of `'half'`, the second is
   * the bVII-to-I arrival that no common-practice type covers. Code counting
   * half cadences has to count `'phrygian'` alongside `'half'`.
   */
  type: 'authentic' | 'plagal' | 'half' | 'deceptive' | 'phrygian' | 'modal' | null;
  /**
   * How conclusive an authentic cadence is: `'perfect'` when it is a PAC,
   * `'imperfect'` when it is an IAC.
   *
   * Null for every other cadence type — the distinction is only defined for the
   * authentic cadence — and null for an authentic cadence whose soprano is
   * unknown, which is the case whenever no `voicing` is given.
   */
  strength: 'perfect' | 'imperfect' | null;
  /**
   * The role the final chord's highest sounding pitch plays in that chord.
   *
   * Omitted when no `voicing` was given, and when the top voice is a tension
   * with no basic chord-tone role.
   */
  soprano?: ChordToneRole;
  /**
   * True when both chords stand on their own root — the inversion condition a
   * perfect authentic cadence has to meet.
   */
  rootPosition: boolean;
  /**
   * True when the dominant resolved onto an inverted tonic (V to I6 and its
   * relatives) instead of the root-position arrival it prepared, so the
   * cadential weight is withheld even though the type still holds.
   */
  evaded: boolean;
  /**
   * Why the pair reads this way: the motion the type rests on, what graded an
   * authentic cadence, and what a null type failed to be. Always present, in
   * the phrasing {@link analyzeVoice} uses for a note.
   */
  rationale: string;
  /**
   * The cadences that were considered and rejected, empty unless
   * {@link DetectCadenceOptions.alternatives} asked for them.
   *
   * These are the near misses — the readings a condition or two away from
   * holding — rather than every type that did not fire, which for most pairs
   * would be all of them.
   */
  alternatives: RejectedCandidate[];
};

/**
 * Options for {@link detectCadence}.
 *
 * @category Functional Harmony
 */
export type DetectCadenceOptions = {
  /**
   * The pitches actually sounding, as MIDI note numbers: the penultimate
   * chord's voicing first, then the final chord's.
   *
   * The lowest pitch of each is its bass and so decides inversion, overriding
   * whatever the chords' own `bassPc` says; the highest pitch of the final
   * chord is the soprano. Without a voicing the soprano is unknown, and a
   * perfect authentic cadence cannot be told from an imperfect one.
   */
  voicing?: [number[], number[]];
  /**
   * Report the cadences this pair came close to forming and why each was
   * turned down.
   *
   * Off by default: the rationale is built from facts the classification
   * already established, while a rival has to be phrased against conditions
   * that did not fire, and most callers read the type only.
   *
   * @defaultValue false
   */
  alternatives?: boolean;
  /**
   * The chord before `from`, which is what tells a cadential six-four from an
   * inverted tonic.
   *
   * A dominant reached from the tonic triad standing on its own bass was
   * already sounding when that six-four did, so the cadence began there. Only
   * the chord before the dominant settles that, and a caller reading a pair at
   * a time has it to hand; without it the pair is classified on its own, as
   * before.
   *
   * Accepted as a chord symbol, chord data, or a `Chord`.
   */
  approach?: ChordLike;
};

/** {@link DetectCadenceOptions} with its approach chord already coerced. */
type CadenceOptions = Omit<DetectCadenceOptions, 'approach'> & { approach?: Chord };

/**
 * Classify the motion between two chords, before inversion is weighed.
 *
 * The bass pitch classes are needed here for one case only: the Phrygian
 * cadence is defined by its bass line, not by its roots.
 */
function cadenceType(
  from: Chord,
  to: Chord,
  key: KeyScale,
  fromBassPc: number,
  toBassPc: number,
): CadenceResult['type'] {
  const tonic = mod12(key.rootPc);
  const fromOffset = mod12(from.rootPc - tonic);
  const toOffset = mod12(to.rootPc - tonic);
  const dominant = isDominantChordOf(from, key);
  if ((dominant || isLeadingToneChordOf(from, key)) && toOffset === 0) {
    return 'authentic';
  }
  // The subdominant is the chord on the key's own fourth degree, which lydian
  // puts a tritone above the tonic. A fixed five semitones would miss that
  // arrival and name a chord the key does not contain in its place.
  if (fromOffset === degreeOffset(SUBDOMINANT_DEGREE, key) && toOffset === 0) {
    return 'plagal';
  }
  // bVII to I: the modal cadence of rock and pop, which has no leading tone at
  // all and so is neither authentic nor plagal. The subtonic carries subdominant
  // function (see functionOf) whether or not it cadences; what makes this one a
  // cadence is the arrival on the tonic.
  if (fromOffset === 10 && toOffset === 0 && hasMajorThird(from)) {
    return 'modal';
  }
  if (dominant && deceptiveTargets(key).includes(toOffset)) {
    return 'deceptive';
  }
  // A move to the dominant is a half cadence, but a no-root-motion V-to-V repeat
  // is not a cadence at all.
  const dominantOffset = degreeOffset(DOMINANT_DEGREE, key);
  const half =
    toOffset === dominantOffset && restsOnDominant(to, key) && fromOffset !== dominantOffset;
  // The Phrygian cadence is that half cadence approached by a semitone descent
  // in the bass, b6 to 5, which is what iv6 to V sounds in a minor key.
  if (
    half &&
    isMinorScale(key) &&
    fromOffset === 5 &&
    mod12(fromBassPc - tonic) === 8 &&
    mod12(toBassPc - tonic) === 7
  ) {
    return 'phrygian';
  }
  return half ? 'half' : null;
}

/**
 * Perfect or imperfect, for a cadence already known to be authentic.
 *
 * A perfect authentic cadence needs all three of: the dominant itself rather
 * than a leading-tone chord standing in for it, both chords on their roots, and
 * the tonic in the soprano. The first two are answered by the chords; the third
 * needs a voicing, and without one the answer is unknown rather than assumed.
 */
function authenticStrength(
  leadingTone: boolean,
  rootPosition: boolean,
  voiced: boolean,
  soprano: ChordToneRole | null,
): CadenceResult['strength'] {
  if (leadingTone || !rootPosition) {
    return 'imperfect';
  }
  if (!voiced) {
    return null;
  }
  return soprano === 'root' ? 'perfect' : 'imperfect';
}

/**
 * The facts a rationale and its rejected rivals are phrased from: the reading
 * that was reached, plus the conditions the rules were testing when they did.
 */
type CadenceFacts = {
  type: CadenceResult['type'];
  strength: CadenceResult['strength'];
  rootPosition: boolean;
  evaded: boolean;
  /** The approach is a leading-tone chord standing in for the dominant. */
  leadingTone: boolean;
  fromOffset: number;
  toOffset: number;
  minor: boolean;
  /** The arrival stands on the fifth degree, whatever its third. */
  onFifthDegree: boolean;
  /** The dominant was reached as a cadential six-four over its own bass. */
  sixFour: boolean;
  /** The pair is that six-four resolving inside the dominant it stands on. */
  withinSixFour: boolean;
};

/** Which of the three conditions of a perfect authentic cadence went unmet. */
function imperfectReason(facts: CadenceFacts): string {
  if (facts.leadingTone) {
    return 'the dominant root never sounds under the leading-tone chord';
  }
  if (!facts.rootPosition) {
    return 'a chord stands on something other than its own root';
  }
  return 'the soprano does not land on the tonic';
}

/** The rationale for a pair that forms no cadence at all. */
function describeNonCadence(facts: CadenceFacts): string {
  if (facts.fromOffset === facts.toOffset) {
    return 'No cadence: the harmony repeats, so there is no root motion to cadence with';
  }
  if (facts.toOffset === 0) {
    return 'No cadence: the tonic is approached by none of the chords that cadence onto it';
  }
  if (facts.onFifthDegree) {
    return 'No cadence: the arrival stands on the fifth degree but sounds no third the key rests on, so it is not the dominant a half cadence comes to';
  }
  return 'No cadence: the motion arrives on neither the tonic nor the dominant';
}

/** Build the rationale for a classified pair. */
function describeCadence(facts: CadenceFacts): string {
  let text: string;
  switch (facts.type) {
    case 'authentic': {
      const approach = facts.leadingTone ? 'leading-tone chord' : 'dominant';
      const head = `Authentic cadence: the ${approach} resolves onto the tonic`;
      text =
        facts.strength === 'perfect'
          ? `${head}, perfect with both chords on their roots and the tonic in the soprano`
          : facts.strength === 'imperfect'
            ? `${head}, imperfect because ${imperfectReason(facts)}`
            : `${head}; no voicing names the soprano, so it is graded neither perfect nor imperfect`;
      break;
    }
    case 'plagal':
      text = 'Plagal cadence: the subdominant falls onto the tonic';
      break;
    case 'modal':
      text =
        'Modal cadence: the major triad on the subtonic rises onto the tonic with no leading tone';
      break;
    case 'deceptive':
      text = 'Deceptive cadence: the dominant resolves onto the submediant in place of the tonic';
      break;
    case 'phrygian':
      text =
        'Phrygian cadence: the bass falls a semitone from the lowered submediant onto the dominant, and the motion rests there';
      break;
    case 'half':
      text = facts.withinSixFour
        ? 'Half cadence: the motion comes to rest on the dominant, which the tonic six-four standing on its bass was already sounding'
        : 'Half cadence: the motion comes to rest on the dominant';
      break;
    case null:
      text = describeNonCadence(facts);
      break;
  }
  if (facts.evaded) {
    text = `${text}; the tonic arrives inverted, so the arrival the ear was promised is withheld`;
  }
  // The six-four is the dominant already, so the cadence is one event that
  // started when it sounded — the numeral I64 names the chord, not the harmony.
  return facts.sixFour
    ? `${text}; the dominant was reached as a cadential six-four, a double appoggiatura over the same bass, so the cadence begins there rather than at the dominant's own arrival`
    : text;
}

/** The cadences the pair came close to forming, and why each was turned down. */
function cadenceAlternatives(facts: CadenceFacts): RejectedCandidate[] {
  const out: RejectedCandidate[] = [];
  if (facts.type === 'deceptive') {
    out.push({
      label: 'authentic',
      reason: 'The dominant was prepared, but the arrival is the submediant rather than the tonic',
    });
  } else if (facts.type !== 'authentic' && facts.toOffset === 0) {
    out.push({
      label: 'authentic',
      reason:
        'The arrival is the tonic, but the chord before it is neither the dominant nor a leading-tone chord',
    });
  }
  if (facts.type === 'authentic' && facts.strength !== 'perfect') {
    out.push({
      label: 'perfect authentic',
      reason:
        facts.strength === null
          ? 'The chords meet every condition a voicing can be judged without, but no voicing names the soprano'
          : `The cadence is authentic, but ${imperfectReason(facts)}`,
    });
  }
  if (facts.type === 'half' && facts.minor && facts.fromOffset === 5) {
    out.push({
      label: 'phrygian',
      reason:
        'The dominant is approached from the subdominant, but the bass does not fall a semitone from the lowered submediant onto it',
    });
  }
  if (facts.type === null && facts.onFifthDegree && facts.fromOffset !== facts.toOffset) {
    out.push({
      label: 'half',
      reason:
        "The arrival stands on the fifth degree, but a half cadence rests on the dominant the key has: the major third, or the mode's own third where that dominant carries no leading tone",
    });
  }
  return out;
}

/**
 * Classify the cadence formed by moving from one chord to the next.
 *
 * - authentic: V (dominant a fifth above the tonic) to I
 * - plagal: IV, the chord on the key's own fourth degree, to I
 * - modal: bVII to I, the cadence of rock and modal writing
 * - deceptive: V to the key's own submediant, plus the borrowed bVI of a major
 *   key
 * - phrygian: iv6 to V of a minor key, the half cadence whose bass falls a
 *   semitone from b6 to 5
 * - half: any other chord than the dominant itself to V, the cadential six-four
 *   standing on the dominant's own bass included
 *
 * These are read as scale degrees rather than as semitone distances, so a mode
 * cadences from and onto the degrees it actually has: the deceptive arrival of
 * dorian is a major sixth above the tonic and that of phrygian a minor sixth,
 * and the subdominant a plagal cadence falls from is the tritone above the
 * tonic in lydian. The two borrowed types are the exception, and are stated as
 * the fixed offsets they name: `modal` is the flattened seventh whatever the
 * key writes on that degree, and the Phrygian bass falls from the lowered
 * submediant. A half cadence normally rests on the major third that carries
 * the leading tone, but where the key's own dominant has no leading tone — the
 * modal `v` of dorian, mixolydian and the pop writing built on them — the
 * arrival's own third suffices as long as the key contains it. That relaxation
 * belongs to the modes alone: a borrowed minor `v` in a major key is no half
 * cadence, and neither is the `v` of a minor key, which cadences through the
 * raised seventh it writes as an accidental rather than in its scale.
 *
 * A static V-to-V repeat with no root motion is not a cadence and yields a null
 * type. The tonic six-four resolving onto the dominant it stands on is a half
 * cadence, and the most ordinary one there is: `I - I64 - V` closes the
 * antecedent of a period, and the six-four is a double appoggiatura over the
 * dominant's own bass rather than a chord that keeps the motion going. Where
 * that dominant goes on to resolve, the pair and the resolution are one event —
 * passing the six-four as `approach` when the dominant is the `from` chord is
 * what lets it be reported as one, with the type and the beat still the
 * dominant's resolution while the `rationale` says the cadence began at the
 * six-four. A six-four the bass leaves instead (`IV-I64-IV`, or a neighbouring
 * one over the tonic) is an ordinary inverted tonic and is read as one.
 *
 * An authentic cadence is graded perfect or imperfect. Perfect takes the
 * dominant to the tonic with both chords in root position and the tonic in the
 * soprano; anything else authentic is imperfect, including the leading-tone
 * cadence, which has no dominant root to stand on. Only a `voicing` names the
 * soprano, so without one the grade is null — the pair could still be either,
 * and reporting perfect would be a guess.
 *
 * The `rationale` says which motion the reading rests on, including for a pair
 * that cadences not at all; `alternatives` is empty unless asked for, and then
 * names the cadences the pair came close to forming.
 *
 * @param from The penultimate chord, as a chord symbol, chord data, or a
 *   `Chord`.
 * @param to The final chord, in any of the same forms.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
 * @param opts Voice-leading detail, the chord before `from`, and whether to
 *   collect the rejected readings; see {@link DetectCadenceOptions}.
 * @returns The cadence, its strength, and the facts behind them.
 * @example
 * ```ts
 * import { detectCadence, makeChord, majorKey } from '@libraz/libcantus';
 * detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), majorKey(0));
 * // { type: 'authentic', strength: null, rootPosition: true, evaded: false, ... }
 * detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), majorKey(0), {
 *   voicing: [[55, 62, 71], [48, 64, 72]],
 * });
 * // { type: 'authentic', strength: 'perfect', soprano: 'root', ... }
 * const sixFour = detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), majorKey(0), {
 *   approach: makeChord(0, 'maj', 7), // C/G, the cadential six-four
 * });
 * sixFour.type; // 'authentic'
 * // The rationale says where the cadence began.
 * sixFour.rationale?.includes('cadential six-four'); // true
 * ```
 * @category Functional Harmony
 */
export function detectCadence(
  from: ChordLike,
  to: ChordLike,
  key: KeyLike,
  opts: DetectCadenceOptions = {},
): CadenceResult {
  const { approach, ...rest } = opts;
  return cadenceBetween(
    toChordData(from),
    toChordData(to),
    toKeyScale(key),
    approach === undefined ? rest : { ...rest, approach: toChordData(approach) },
  );
}

/** {@link detectCadence} on data already read into its narrow form. */
export function cadenceBetween(
  from: Chord,
  to: Chord,
  key: KeyScale,
  opts: CadenceOptions = {},
): CadenceResult {
  const [fromVoicing, toVoicing] = opts.voicing ?? [];
  const fromOuter = outerPitches(fromVoicing ?? []);
  const toOuter = outerPitches(toVoicing ?? []);
  const fromBassPc = bassPcOf(from, fromOuter.bass);
  const toBassPc = bassPcOf(to, toOuter.bass);
  const toRootPosition = toBassPc === mod12(to.rootPc);
  const rootPosition = fromBassPc === mod12(from.rootPc) && toRootPosition;
  const soprano = toOuter.soprano === undefined ? null : chordToneRole(toOuter.soprano, to);

  const type = cadenceType(from, to, key, fromBassPc, toBassPc);
  const leadingTone = isLeadingToneChordOf(from, key);
  const facts: CadenceFacts = {
    type,
    strength:
      type === 'authentic'
        ? authenticStrength(leadingTone, rootPosition, toOuter.soprano !== undefined, soprano)
        : null,
    rootPosition,
    // The dominant resolved, but onto an inverted tonic: the arrival the ear was
    // promised is the one it does not get.
    evaded: type === 'authentic' && !toRootPosition,
    leadingTone,
    fromOffset: mod12(from.rootPc - key.rootPc),
    toOffset: mod12(to.rootPc - key.rootPc),
    minor: isMinorScale(key),
    onFifthDegree: mod12(to.rootPc - key.rootPc) === degreeOffset(DOMINANT_DEGREE, key),
    sixFour: opts.approach !== undefined && isCadentialSixFour(opts.approach, from, key),
    withinSixFour: isCadentialSixFour(from, to, key),
  };
  const result: CadenceResult = {
    type: facts.type,
    strength: facts.strength,
    rootPosition: facts.rootPosition,
    evaded: facts.evaded,
    rationale: describeCadence(facts),
    alternatives: opts.alternatives === true ? cadenceAlternatives(facts) : [],
  };
  if (soprano !== null) {
    result.soprano = soprano;
  }
  return result;
}
