/**
 * Spelling: derive letter-name notes for scales and chords from a spelled tonic.
 *
 * The theory core works in pitch classes, which cannot choose between (say) a
 * G# and an Ab. Given a spelled tonic, this module assigns diatonic letters to
 * scale degrees and chord tones so a C major scale spells as C D E F G A B and
 * A harmonic minor spells its seventh as G#.
 */

import type { Chord } from '../chord/index.js';
import type { Note } from '../pitch/index.js';
import { formatNote } from '../pitch/index.js';
import { scaleTonesInDegreeOrder } from '../scale/index.js';
import type { KeyScale } from '../types.js';

/** Semitone offset of each natural letter above C: C D E F G A B. */
const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/** Conventional accidental spelling for each chromatic offset above the tonic. */
const CHROMATIC_SPELLING: Record<number, { degreeOffset: number; alter: number }> = {
  1: { degreeOffset: 1, alter: -1 }, // b2
  3: { degreeOffset: 2, alter: -1 }, // b3
  6: { degreeOffset: 3, alter: 1 }, // #4
  8: { degreeOffset: 5, alter: -1 }, // b6
  10: { degreeOffset: 6, alter: -1 }, // b7
};

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

function mod7(n: number): number {
  return ((n % 7) + 7) % 7;
}

/** Natural pitch class of a letter (0 = C .. 6 = B). */
function naturalPc(letter: number): number {
  return LETTER_SEMITONES[mod7(letter)] ?? 0;
}

/** Shortest signed alteration (in [-6, 6]) taking a letter's natural pc to `pc`. */
function alterFor(letter: number, pc: number): number {
  let d = mod12(pc - naturalPc(letter));
  if (d > 6) {
    d -= 12;
  }
  return d;
}

/** Whether the key's scale is a seven-note (heptatonic) scale. */
function isHeptatonic(key: KeyScale): boolean {
  return scaleTonesInDegreeOrder(key).length === 7;
}

/**
 * Spell a single pitch class relative to a spelled tonic and key.
 *
 * Diatonic pitch classes take the scale's letter for their degree; the common
 * chromatic tones (b2, b3, #4, b6, b7) take their conventional accidental
 * spelling; anything else falls back to a sharp spelling of the nearest natural.
 *
 * @param pc The pitch class to spell.
 * @param tonic The spelled tonic (its letter anchors the spelling).
 * @param key The key/scale.
 * @returns The spelled note (without octave).
 */
export function spellPitchClass(pc: number, tonic: Note, key: KeyScale): Note {
  const tonicPc = mod12(naturalPc(tonic.letter) + tonic.alter);
  const offset = mod12(pc - tonicPc);
  const tones = scaleTonesInDegreeOrder(key);

  if (isHeptatonic(key)) {
    const degree = tones.indexOf(mod12(pc));
    if (degree >= 0) {
      const letter = mod7(tonic.letter + degree);
      return { letter, alter: alterFor(letter, pc) };
    }
    const chromatic = CHROMATIC_SPELLING[offset];
    if (chromatic) {
      const letter = mod7(tonic.letter + chromatic.degreeOffset);
      return { letter, alter: alterFor(letter, pc) };
    }
  }

  // Fallback: name the pitch class from the nearest natural, preferring a sharp.
  for (let letter = 0; letter < 7; letter += 1) {
    if (naturalPc(letter) === mod12(pc)) {
      return { letter, alter: 0 };
    }
  }
  const belowLetter = mod7([0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][mod12(pc)] ?? 0);
  return { letter: belowLetter, alter: alterFor(belowLetter, pc) };
}

/**
 * Spell every pitch class of a scale, in ascending scale-degree order.
 *
 * Correct for heptatonic scales (each degree gets the next letter). Non-standard
 * scales are spelled tone-by-tone with a sharp preference.
 *
 * @param tonic The spelled tonic.
 * @param key The key/scale.
 * @returns Spelled notes, one per scale degree.
 */
export function spellScale(tonic: Note, key: KeyScale): Note[] {
  return scaleTonesInDegreeOrder(key).map((pc) => spellPitchClass(pc, tonic, key));
}

/**
 * Spell an arbitrary list of pitch classes relative to a key.
 *
 * @param pcs The pitch classes.
 * @param tonic The spelled tonic.
 * @param key The key/scale.
 * @returns Spelled notes, in input order.
 */
export function spellPitchClasses(pcs: number[], tonic: Note, key: KeyScale): Note[] {
  return pcs.map((pc) => spellPitchClass(pc, tonic, key));
}

/**
 * Spell a chord's tones, in the chord's own (tertian) order, relative to a key.
 *
 * Diatonic chords spell exactly (e.g. G7 in C major -> G B D F). Chromatic chord
 * tones take their conventional spelling; enharmonically ambiguous altered
 * tensions may be spelled by the general convention rather than by chord
 * function.
 *
 * @param chord The chord.
 * @param tonic The spelled tonic of the key.
 * @param key The key/scale.
 * @returns Spelled chord tones, root first.
 */
export function spellChord(chord: Chord, tonic: Note, key: KeyScale): Note[] {
  return chord.intervals.map((interval) =>
    spellPitchClass(mod12(chord.rootPc + interval), tonic, key),
  );
}

/**
 * Convenience: render spelled notes as letter-name strings.
 *
 * @param notes The notes.
 * @returns Their formatted names.
 */
export function noteNames(notes: Note[]): string[] {
  return notes.map(formatNote);
}
