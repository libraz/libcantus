import { midiToNote, pitchClassOf as mod12, type Note as NoteData } from '../core/pitch/index.js';

export { pitchClassOf as mod12 } from '../core/pitch/index.js';

/** Spell a bare pitch class as an octave-less note with a sharp/flat preference. */
export function spellPitchClassBare(pc: number, spelling: 'sharp' | 'flat'): NoteData {
  const spelled = midiToNote(60 + mod12(pc), spelling);
  return { letter: spelled.letter, alter: spelled.alter };
}
