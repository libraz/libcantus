/**
 * Tendency tones: which pitch class of a chord owes its next move to a rule.
 *
 * The voicing search and the part-writing checker both need this, and they have
 * to agree on it. A generator resolving a tone the checker does not recognize —
 * or holding one the checker thinks must move — would report its own output as
 * faulty, so both read the same predicates from here.
 */

import type { Note } from '../../core/pitch/index.js';
import { noteToMidi, pitchClassOf, spelledInterval } from '../../core/pitch/index.js';
import type { Chord } from '../chord/index.js';
import { isAugmentedMelodicInterval } from '../counterpoint/index.js';
import { type KeyLike, resolveKey } from '../scale/index.js';
import { spellPitchClass } from '../spelling/index.js';
import { isDescendingStep } from '../tendency/index.js';

/**
 * How one chord's tones are written: one spelling per pitch class, and the MIDI
 * pitch each of those spellings sounds at octave 0.
 *
 * The search reads a candidate's letters thousands of times per chord, and a
 * spelling depends on the pitch class alone once the chord and the key are
 * fixed, so the twelve of them are worked out once and the octave is arithmetic.
 */
export type SpellingTable = {
  /** The octave-less spelling of each pitch class 0-11. */
  notes: readonly Note[];
  /** The MIDI pitch each of those spellings sounds at octave 0. */
  bases: readonly number[];
};

/**
 * Name every pitch class the way {@link spellVoicing} names it under one chord.
 *
 * The generator and the checker have to read the same letters — an augmented
 * second is a minor third by ear, so a generator spelling its own output by
 * another rule would write intervals its checker forbids — and both go through
 * {@link spellPitchClass} with the chord as context.
 *
 * @param keyLike The prevailing key, in any form a key is held in.
 * @param chord The chord sounding, or undefined to let the key alone decide.
 * @returns The table, indexed by pitch class.
 */
export function spellingTable(keyLike: KeyLike, chord?: Chord): SpellingTable {
  // Read whole rather than reduced: an exercise written in Ab minor is judged on
  // the letters it is written with, and a key that arrived carrying its tonic
  // would otherwise have that tonic derived back from the pitch classes.
  const { tonic, scale: key } = resolveKey(keyLike);
  const notes: Note[] = [];
  const bases: number[] = [];
  for (let pc = 0; pc < 12; pc += 1) {
    const note =
      chord === undefined
        ? spellPitchClass(pc, tonic, key)
        : spellPitchClass(pc, tonic, key, { chord });
    notes.push(note);
    bases.push(noteToMidi({ letter: note.letter, alter: note.alter, octave: 0 }));
  }
  return { notes, bases };
}

/** The spelled note a table gives a sounding pitch, carrying its octave. */
export function spelledAt(table: SpellingTable, pitch: number): Note | undefined {
  const pc = pitchClassOf(pitch);
  const note = table.notes[pc];
  const base = table.bases[pc];
  if (note === undefined || base === undefined) {
    return undefined;
  }
  return { letter: note.letter, alter: note.alter, octave: (pitch - base) / 12 };
}

/**
 * Whether a voice moving between two sounding pitches writes an augmented
 * interval, read through the same spelling the checker applies to the result.
 *
 * @param from The table of the chord left.
 * @param fromPitch The pitch the voice sang.
 * @param to The table of the chord arrived on.
 * @param toPitch The pitch it moved to.
 * @returns True when the written interval is augmented.
 */
export function movesByAugmentedInterval(
  from: SpellingTable,
  fromPitch: number,
  to: SpellingTable,
  toPitch: number,
): boolean {
  const earlier = spelledAt(from, fromPitch);
  const later = spelledAt(to, toPitch);
  if (earlier === undefined || later === undefined) {
    return false;
  }
  return isAugmentedMelodicInterval(earlier, later);
}

/**
 * Whether a voice moving between two sounding pitches falls by a diatonic step,
 * which is how a chordal seventh resolves.
 *
 * Read through the same spelling the checker applies to the result: two
 * semitones down is a diminished third as often as a major second once the
 * letters are settled, and only one of the two is a resolution.
 *
 * @param from The table of the chord left.
 * @param fromPitch The pitch the voice sang.
 * @param to The table of the chord arrived on.
 * @param toPitch The pitch it moved to.
 * @returns True when the written interval is a descending second.
 */
export function movesByDescendingStep(
  from: SpellingTable,
  fromPitch: number,
  to: SpellingTable,
  toPitch: number,
): boolean {
  const earlier = spelledAt(from, fromPitch);
  const later = spelledAt(to, toPitch);
  if (earlier === undefined || later === undefined) {
    return false;
  }
  return isDescendingStep(spelledInterval(earlier, later));
}
