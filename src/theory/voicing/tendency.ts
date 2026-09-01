/**
 * Tendency tones: which pitch class of a chord owes its next move to a rule.
 *
 * The voicing search and the part-writing checker both need this, and they have
 * to agree on it. A generator resolving a tone the checker does not recognize —
 * or holding one the checker thinks must move — would report its own output as
 * faulty, so both read the same predicates from here.
 */

import type { Note } from '../../core/pitch/index.js';
import { noteToMidi, pitchClassOf } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordQuality } from '../chord/index.js';
import { chordToneRole } from '../chord/index.js';
import { isAugmentedMelodicInterval } from '../counterpoint/index.js';
import { spelledKeyOf } from '../scale/index.js';
import { spellPitchClass } from '../spelling/index.js';

/** The key's leading tone as a pitch class. */
export function leadingTonePcOf(key: KeyScale): number {
  return pitchClassOf(key.rootPc - 1);
}

/** The qualities a leading-tone chord takes: the diminished triad and sevenths. */
const LEADING_TONE_QUALITIES: ReadonlySet<ChordQuality> = new Set(['dim', 'dim7', 'm7b5']);

/**
 * Whether the key's leading tone is functioning as one in a chord.
 *
 * The tendency is the dominant's, not the pitch class's: the leading tone must
 * rise where it is the third of a chord built on the dominant degree, or the
 * root of a leading-tone chord, which are the two places it carries dominant
 * function. The same pitch class is an ordinary chord tone elsewhere — the
 * fifth of iii, or the seventh of Imaj7 — and is free to move as the line asks,
 * which for a seventh means falling by step.
 */
export function isFunctioningLeadingTone(chord: Chord, key: KeyScale): boolean {
  const role = chordToneRole(leadingTonePcOf(key), chord);
  if (role === 'third') {
    return pitchClassOf(chord.rootPc) === pitchClassOf(key.rootPc + 7);
  }
  if (role === 'root') {
    return LEADING_TONE_QUALITIES.has(chord.quality);
  }
  return false;
}

/**
 * The chord's own seventh as a pitch class, or undefined when it has none.
 *
 * "Seventh" means the tone the chord itself writes as one, which is what
 * {@link chordToneRole} answers: a chord carrying its own spelling is read by
 * that spelling, so the augmented sixth of an Italian or German sixth — ten
 * semitones above the root but five letters up — is a sixth resolving outward
 * and owes nothing to the seventh's downward rule. The French sixth is rooted
 * on the supertonic, where its ten semitones really are a chordal seventh, and
 * keeps that obligation.
 */
export function seventhPcOf(chord: Chord): number | undefined {
  for (const interval of chord.intervals) {
    const pc = pitchClassOf(chord.rootPc + interval);
    if (chordToneRole(pc, chord) === 'seventh') {
      return pc;
    }
  }
  return undefined;
}

/** The chord's own fifth as a pitch class, or undefined when it has none. */
export function fifthPcOf(chord: Chord): number | undefined {
  for (const interval of chord.intervals) {
    const pc = pitchClassOf(chord.rootPc + interval);
    if (chordToneRole(pc, chord) === 'fifth') {
      return pc;
    }
  }
  return undefined;
}

/** The two thirds a frustrated leading tone may fall by, in semitones. */
const THIRD_SEMITONES: readonly number[] = [3, 4];

/**
 * Whether a leading tone that does not rise is nevertheless left the way the
 * classical norm allows: the frustrated leading tone.
 *
 * An inner voice may drop a third from the leading tone onto the fifth of the
 * arriving chord, which is what completes a triad the rising resolution would
 * leave without one — the standard answer to a complete dominant seventh
 * moving to a complete tonic. The exemption is the inner voices' alone: in the
 * bass or the top voice the leading tone is exposed and must rise, so callers
 * ask this only about a voice that is neither.
 *
 * @param fromPitch The sounding leading tone.
 * @param toPitch Where the voice went.
 * @param nextChord The chord arrived on, supplying the fifth.
 * @returns True when the voice falls a third onto that chord's fifth.
 */
export function isFrustratedLeadingTone(
  fromPitch: number,
  toPitch: number,
  nextChord: Chord,
): boolean {
  if (!THIRD_SEMITONES.includes(fromPitch - toPitch)) {
    return false;
  }
  const fifthPc = fifthPcOf(nextChord);
  return fifthPc !== undefined && pitchClassOf(toPitch) === fifthPc;
}

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
 * @param key The prevailing key.
 * @param chord The chord sounding, or undefined to let the key alone decide.
 * @returns The table, indexed by pitch class.
 */
export function spellingTable(key: KeyScale, chord?: Chord): SpellingTable {
  const { tonic } = spelledKeyOf(key);
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
