import { midiToNote, type Note as NoteData } from '../core/pitch/index.js';

/** Reduce any integer to a pitch class in [0, 11]. */
export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Spell a bare pitch class as an octave-less note with a sharp/flat preference. */
export function spellPitchClassBare(pc: number, spelling: 'sharp' | 'flat'): NoteData {
  const spelled = midiToNote(60 + mod12(pc), spelling);
  return { letter: spelled.letter, alter: spelled.alter };
}
