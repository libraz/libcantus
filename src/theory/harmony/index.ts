import { pitchClassOf } from '../../core/pitch/index.js';
import { type Chord, type ChordToneRole, chordSpecOf, chordToneRole } from '../chord/index.js';
import { type ChordLike, toChordData } from '../symbol/index.js';

/**
 * Harmonic role a pitch plays within a chord.
 *
 * @category Functional Harmony
 */
export type HarmonyRole = ChordToneRole | 'tension' | 'doubling';

/**
 * How firmly a pitch is locked to the chord's identity.
 *
 * - `identity`: moving it produces a different chord (the root).
 * - `quality`: moving it flips the chord quality (the third).
 * - `voicing`: it can move freely without changing chord identity or quality.
 *
 * @category Functional Harmony
 */
export type LockLevel = 'identity' | 'quality' | 'voicing';

/**
 * A pitch's role, lock level, and owning chord.
 *
 * @category Functional Harmony
 */
export type VoicedRole = {
  role: HarmonyRole;
  lock: LockLevel;
  belongsToChordId: number;
};

/**
 * The one interval class standing in for a chord's absent third, if any.
 *
 * Read from the chord's structure rather than from its sounding pitch classes:
 * an eleventh chord's tensions fold onto 2 and 5 in pitch-class space, so a set
 * of folded intervals cannot say which of them replaced the third — and both
 * would answer, leaving one chord with two quality-defining tones. The
 * suspension a `sus4` or `sus2` names is its fourth or its second; an eleventh
 * chord's is the eleventh, the tone its omitted third gave way to.
 */
function suspendedIntervalOf(chord: Chord): number | undefined {
  const sounds = (ic: number): boolean =>
    chord.intervals.some((interval) => pitchClassOf(interval) === ic);
  if (sounds(3) || sounds(4)) {
    return undefined;
  }
  const spec = chordSpecOf(chord);
  if (spec.base === 'sus4') {
    return sounds(5) ? 5 : undefined;
  }
  if (spec.base === 'sus2') {
    return sounds(2) ? 2 : undefined;
  }
  return spec.omissions.includes(3) && sounds(5) ? 5 : undefined;
}

/**
 * Classify a pitch's harmonic role and lock level within a chord.
 *
 * The role comes from the pitch's interval class above the chord root, read
 * against the chord's own template: root (0), third (3/4), fifth (6/7/8),
 * sixth or seventh (9/10/11). Every pitch the template does not claim is
 * `'tension'` — including one that is simply foreign to the chord, which this
 * single-pitch query cannot tell from a colour tone. The root locks the chord
 * identity, the third locks its quality, and everything else is free voicing.
 * Where a chord has no third, the tone standing in its place — the fourth of a
 * `sus4`, the second of a `sus2`, the eleventh of an eleventh chord — takes the
 * third's slot and is locked to `quality`, since moving it changes the chord.
 * At most one interval class of a chord is ever reported as its third, so a
 * consumer reading `lock: 'quality'` as "this tone identifies the chord" gets
 * one answer rather than two. Detecting an octave doubling requires the
 * surrounding voicing, which this query does not carry, so `'doubling'` is part
 * of the type — the shared vocabulary of harmonic roles — but is never returned
 * here.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param chord The chord providing the root reference, as a chord symbol, chord
 *   data, or a `Chord`.
 * @param chordId Identifier stored on the result (defaults to 0).
 * @returns The pitch's role, lock level, and owning chord id.
 * @example
 * ```ts
 * import { roleOf, makeChord } from '@libraz/libcantus';
 * roleOf(64, makeChord(0, 'maj')); // E over C major
 * // { role: 'third', lock: 'quality', belongsToChordId: 0 }
 * ```
 * @category Functional Harmony
 */
export function roleOf(pitch: number, chord: ChordLike, chordId = 0): VoicedRole {
  const data = toChordData(chord);
  const interval = (pitchClassOf(pitch) - pitchClassOf(data.rootPc) + 12) % 12;
  const suspended = suspendedIntervalOf(data);
  const isSuspendedTone = suspended !== undefined && interval === suspended;
  const chordRole = chordToneRole(pitch, data);
  let role: HarmonyRole;
  let lock: LockLevel;
  if (isSuspendedTone) {
    role = 'third'; // suspended tone occupies the third's quality-defining slot
    lock = 'quality';
  } else if (chordRole !== null) {
    role = chordRole;
    lock = chordRole === 'root' ? 'identity' : chordRole === 'third' ? 'quality' : 'voicing';
  } else {
    role = 'tension';
    lock = 'voicing';
  }
  return { role, lock, belongsToChordId: chordId };
}
