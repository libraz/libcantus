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
import { isMinorKey } from './function.js';
import { mod12 } from './internal.js';
import type { RejectedCandidate } from './rationale.js';

/** Whether a chord carries a major third above its root. */
function hasMajorThird(chord: Chord): boolean {
  return chord.intervals.some((interval) => mod12(interval) === 4);
}

/** Whether a leading-tone chord is a diminished-family resolution chord. */
function isLeadingToneDiminished(chord: Chord): boolean {
  return chord.quality === 'dim' || chord.quality === 'dim7' || chord.quality === 'm7b5';
}

/** Whether a chord is the key's dominant, heard through its major third. */
function isDominantOf(chord: Chord, key: KeyScale): boolean {
  return mod12(chord.rootPc - key.rootPc) === 7 && hasMajorThird(chord);
}

/** Whether a chord is a leading-tone chord standing in for the dominant. */
function isLeadingToneOf(chord: Chord, key: KeyScale): boolean {
  return mod12(chord.rootPc - key.rootPc) === 11 && isLeadingToneDiminished(chord);
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
};

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
  const dominant = isDominantOf(from, key);
  if ((dominant || isLeadingToneOf(from, key)) && toOffset === 0) {
    return 'authentic';
  }
  if (fromOffset === 5 && toOffset === 0) {
    return 'plagal';
  }
  // bVII to I: the modal cadence of rock and pop, which has no leading tone at
  // all and so is neither authentic nor plagal. The subtonic carries subdominant
  // function (see functionOf) whether or not it cadences; what makes this one a
  // cadence is the arrival on the tonic.
  if (fromOffset === 10 && toOffset === 0 && hasMajorThird(from)) {
    return 'modal';
  }
  // Deceptive targets: the diatonic submediant (vi at offset 9 in major, VI at
  // offset 8 in minor) plus, in a major key, the borrowed flat-submediant bVI
  // at offset 8.
  const deceptiveTargets = isMinorKey(key) ? [8] : [8, 9];
  if (dominant && deceptiveTargets.includes(toOffset)) {
    return 'deceptive';
  }
  // A move to the dominant is a half cadence, but a no-root-motion V-to-V repeat
  // is not a cadence at all.
  const half = toOffset === 7 && hasMajorThird(to) && fromOffset !== 7;
  // The Phrygian cadence is that half cadence approached by a semitone descent
  // in the bass, b6 to 5, which is what iv6 to V sounds in a minor key.
  if (
    half &&
    isMinorKey(key) &&
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
    return 'No cadence: the arrival stands on the fifth degree but sounds no major third, so it is not the dominant a half cadence rests on';
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
      text = 'Half cadence: the motion comes to rest on the dominant';
      break;
    case null:
      text = describeNonCadence(facts);
      break;
  }
  return facts.evaded
    ? `${text}; the tonic arrives inverted, so the arrival the ear was promised is withheld`
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
        'The arrival stands on the fifth degree, but a half cadence rests on a major dominant',
    });
  }
  return out;
}

/**
 * Classify the cadence formed by moving from one chord to the next.
 *
 * - authentic: V (dominant a fifth above the tonic) to I
 * - plagal: IV (a fourth above the tonic) to I
 * - modal: bVII to I, the cadence of rock and modal writing
 * - deceptive: V to the submediant (diatonic vi or borrowed bVI in major, VI in
 *   minor)
 * - phrygian: iv6 to V of a minor key, the half cadence whose bass falls a
 *   semitone from b6 to 5
 * - half: any other chord than the dominant itself to V
 *
 * A static V-to-V repeat with no root motion is not a cadence and yields a null
 * type.
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
 * @param from The penultimate chord.
 * @param to The final chord.
 * @param key The prevailing key.
 * @param opts Voice-leading detail and whether to collect the rejected
 *   readings; see {@link DetectCadenceOptions}.
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
 * ```
 * @category Functional Harmony
 */
export function detectCadence(
  from: Chord,
  to: Chord,
  key: KeyScale,
  opts: DetectCadenceOptions = {},
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
  const leadingTone = isLeadingToneOf(from, key);
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
    minor: isMinorKey(key),
    onFifthDegree: mod12(to.rootPc - key.rootPc) === 7,
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
