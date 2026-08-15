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
 * @param from The penultimate chord.
 * @param to The final chord.
 * @param key The prevailing key.
 * @param opts Voice-leading detail; see {@link DetectCadenceOptions}.
 * @returns The cadence, its strength, and the facts behind them.
 * @example
 * ```ts
 * import { detectCadence, makeChord, majorKey } from '@libraz/libcantus';
 * detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), majorKey(0));
 * // { type: 'authentic', strength: null, rootPosition: true, evaded: false }
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
  const result: CadenceResult = {
    type,
    strength:
      type === 'authentic'
        ? authenticStrength(
            isLeadingToneOf(from, key),
            rootPosition,
            toOuter.soprano !== undefined,
            soprano,
          )
        : null,
    rootPosition,
    // The dominant resolved, but onto an inverted tonic: the arrival the ear was
    // promised is the one it does not get.
    evaded: type === 'authentic' && !toRootPosition,
  };
  if (soprano !== null) {
    result.soprano = soprano;
  }
  return result;
}
