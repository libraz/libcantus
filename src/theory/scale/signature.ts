import type { Note, NoteLike } from '../../core/pitch/index.js';
import {
  diatonicLetterOf,
  pitchClassOf as mod12,
  naturalPitchClassOf,
  toNoteData,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertInteger, assertOneOf } from '../../core/validation/index.js';
import { majorKey, minorKey } from './key.js';
import { HARMONIC_MINOR_MASK, MAJOR_MASK, MELODIC_MINOR_MASK } from './masks.js';

/**
 * Which of the two modes a key signature is read in.
 *
 * A signature names two keys — three sharps is both A major and F# minor — so
 * every entry point that turns a signature into a key, or that names the mode
 * of a key relation, selects between them with this.
 *
 * @example
 * ```ts
 * import type { KeyMode } from '@libraz/libcantus';
 * const mode: KeyMode = 'minor';
 * ```
 * @category Scales
 */
export type KeyMode = 'major' | 'minor';

/** Position of each natural letter on the circle of fifths: F=-1, C=0, ... B=5. */
const LETTER_FIFTHS = [0, 2, 4, -1, 1, 3, 5] as const;

/** The letters of the circle of fifths from F upward, as letter numbers. */
const FIFTHS_LETTERS = [3, 0, 4, 1, 5, 2, 6] as const;

/** How many fifths a sharp or a flat on the tonic moves its signature. */
const FIFTHS_PER_ALTERATION = 7;

/** Signature offset of the natural-minor mode: three fifths below its parallel major. */
const MINOR_MODE_OFFSET = -3;

/** Widest signature this module builds a key for, including theoretical ones. */
const MAX_FIFTHS = 12;

/** Rotate a 12-bit mode mask down by `semitones`, wrapping at the octave. */
function rotateMask(mask: number, semitones: number): number {
  const steps = ((semitones % 12) + 12) % 12;
  return ((mask >> steps) | (mask << (12 - steps))) & 0b111111111111;
}

/**
 * Signature offset of each diatonic mode, keyed by its mode mask.
 *
 * The offset is how many fifths the mode's signature sits from the major key on
 * the same tonic, which is exactly the mode's own position in the circle: D
 * dorian is two fifths flatter than D major, and so carries no accidentals.
 */
const DIATONIC_MODE_OFFSETS = new Map<number, number>([
  [rotateMask(MAJOR_MASK, 5), 1], // lydian
  [MAJOR_MASK, 0], // ionian / major
  [rotateMask(MAJOR_MASK, 7), -1], // mixolydian
  [rotateMask(MAJOR_MASK, 2), -2], // dorian
  [rotateMask(MAJOR_MASK, 9), MINOR_MODE_OFFSET], // aeolian / natural minor
  [rotateMask(MAJOR_MASK, 4), -4], // phrygian
  [rotateMask(MAJOR_MASK, 11), -5], // locrian
]);

/** Whether a mode mask has a minor third and no major third — it leans flat. */
function hasMinorThird(modeMask12: number): boolean {
  return ((modeMask12 >> 3) & 1) === 1 && ((modeMask12 >> 4) & 1) === 0;
}

/**
 * How many fifths a key's signature sits from the major key on the same tonic.
 *
 * A diatonic mode has its own answer. Anything else — harmonic and melodic
 * minor, and every scale that is not heptatonic — takes the signature of its
 * parallel major or minor instead, since its remaining tones are written as
 * accidentals rather than in the signature.
 */
function modeOffset(key: KeyScale): number {
  const diatonic = DIATONIC_MODE_OFFSETS.get(key.modeMask12);
  if (diatonic !== undefined) {
    return diatonic;
  }
  return hasMinorThird(key.modeMask12) ? MINOR_MODE_OFFSET : 0;
}

/**
 * Whether a key is one that is actually written with a key signature.
 *
 * Each of the seven diatonic modes has a signature of its own, and the harmonic
 * and melodic minor are the minor key with a degree or two raised: G# harmonic
 * minor is written with G# minor's five sharps and an F## in front of the note,
 * which is why it is spelled G# and not Ab. Every other scale only borrows the
 * signature of its parallel major or minor as an approximation, so nothing
 * about how it is written follows from that signature — and how such a scale is
 * spelled has to be decided from the scale itself.
 *
 * @param key The key/scale.
 * @returns True when the signature is the key's own rather than a stand-in.
 */
export function isSignatureKey(key: KeyScale): boolean {
  return (
    DIATONIC_MODE_OFFSETS.has(key.modeMask12) ||
    key.modeMask12 === HARMONIC_MINOR_MASK ||
    key.modeMask12 === MELODIC_MINOR_MASK
  );
}

/**
 * The key signature of a key, as a signed count of sharps (positive) or flats
 * (negative) — the `fifths` value a notation format such as MusicXML writes.
 *
 * The tonic's letter and accidental place the key on the circle of fifths, and
 * the mode moves it from there: lydian +1, major 0, mixolydian -1, dorian -2,
 * natural minor -3, phrygian -4, locrian -5.
 *
 * A scale that is not a diatonic mode has no signature of its own, so it takes
 * the signature of its parallel major or minor: a scale with a minor third and
 * no major third counts as minor (-3), everything else as major (0). This is
 * why A harmonic minor reports 0 — its G# is written as an accidental, not in
 * the signature — and why A melodic minor reports 0 as well.
 *
 * The result is not clamped: a theoretical key such as Fb major reports -8.
 * Clamp to ±7 if the consuming format cannot express more.
 *
 * @param tonic The spelled tonic, as a note name, note data, or a `Note`; its
 *   accidental is worth seven fifths.
 * @param key The key/scale. This one stays a plain key/scale: it reads any
 *   12-bit mask, including the tonic-less ones a key name cannot describe.
 * @returns The signed number of sharps (positive) or flats (negative).
 * @example
 * ```ts
 * import { keySignatureFifths, majorKey, minorKey, parseNote } from '@libraz/libcantus';
 * keySignatureFifths(parseNote('Bb'), majorKey(10)); // -2
 * keySignatureFifths('A', minorKey(9)); // 0
 * ```
 * @category Scales
 */
export function keySignatureFifths(tonic: NoteLike, key: KeyScale): number {
  const note = toNoteData(tonic);
  const scale = key;
  const letter = diatonicLetterOf(note.letter);
  assertInteger(note.alter, 'tonic.alter');
  assertInteger(scale.modeMask12, 'key.modeMask12', 1, 0b111111111111);
  return (LETTER_FIFTHS[letter] ?? 0) + FIFTHS_PER_ALTERATION * note.alter + modeOffset(scale);
}

/**
 * The key a signature denotes: the inverse of {@link keySignatureFifths} for
 * the two modes a signature is conventionally read in.
 *
 * A signature names two keys — three sharps is both A major and F# minor — so
 * the mode decides which one is built. The tonic is spelled the way that key is
 * written, including the theoretical keys past ±7 (nine sharps is D# major).
 *
 * @param fifths The signed number of sharps (positive) or flats (negative).
 * @param mode Which of the signature's two keys to build; defaults to major.
 * @returns The spelled tonic and the matching key/scale.
 * @throws If `fifths` is not an integer in [-12, 12], or `mode` is not one of
 *   `'major'` or `'minor'`.
 * @example
 * ```ts
 * import { keyFromFifths, formatNote } from '@libraz/libcantus';
 * formatNote(keyFromFifths(-2).tonic); // 'Bb'
 * formatNote(keyFromFifths(-2, 'minor').tonic); // 'G'
 * ```
 * @category Scales
 */
export function keyFromFifths(
  fifths: number,
  mode: KeyMode = 'major',
): { tonic: Note; key: KeyScale } {
  assertInteger(fifths, 'fifths', -MAX_FIFTHS, MAX_FIFTHS);
  const which = assertOneOf(mode, ['major', 'minor'], 'mode');
  // The circle of fifths starts at F, so the major tonic of `fifths` sharps is
  // one step along it; a minor key is the relative minor, three fifths further.
  const index = fifths + 1 + (which === 'minor' ? -MINOR_MODE_OFFSET : 0);
  const letter = FIFTHS_LETTERS[((index % 7) + 7) % 7] ?? 0;
  const alter = Math.floor(index / 7);
  const rootPc = mod12(naturalPitchClassOf(letter) + alter);
  return {
    tonic: { letter, alter },
    key: which === 'minor' ? minorKey(rootPc) : majorKey(rootPc),
  };
}
