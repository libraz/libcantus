import {
  formatNote,
  midiToNote,
  type Note,
  type NoteNameSystem,
  noteToPitchClass,
  spelledInterval,
  transposeByInterval,
} from '../../core/pitch/index.js';
import type { PitchSpelling } from '../chord/index.js';

/**
 * How a chord symbol writes a pitch, and which spellings a chart will take.
 *
 * One module because it is one judgement. Formatting a symbol and transposing
 * one both have to answer "can this be written down", and both used to answer
 * it for themselves: transposition checked, formatting did not, and a slash
 * bass carried by the root's own letters came out as `Db7/Ebb`. What decides it
 * lives here, and both read it.
 */

/** Drop the octave from a note, leaving the spelling alone. */
export function bareSpelling(note: Note): PitchSpelling {
  return { letter: note.letter, alter: note.alter };
}

/** A pitch class named from the table, on the side asked for. */
export function plainSpelling(pc: number, asFlat: boolean): PitchSpelling {
  return bareSpelling(midiToNote(60 + pc, asFlat ? 'flat' : 'sharp'));
}

/**
 * A root or bass written the way a chord symbol writes it.
 *
 * German note names are lowercase, but a German chord symbol capitalizes its
 * root — `Es`, `Fis`, `H7` — and leaves the quality suffix to say major or
 * minor. Since case means nothing here, reading ignores it and writing settles
 * on the capitalized form charts use. Every other system writes its name as the
 * naming layer does.
 */
export function symbolName(note: Note, system: NoteNameSystem): string {
  const name = formatNote(note, { system });
  return system === 'german' ? `${name.slice(0, 1).toUpperCase()}${name.slice(1)}` : name;
}

/**
 * Whether a spelling is one a chart writes for a root or a slash bass.
 *
 * The vocabulary is exactly what {@link pitchClassName} draws from with no hint
 * to follow: a natural or a single accidental, and never the accidental that
 * merely renames a natural letter — no C flat, F flat, B sharp or E sharp root,
 * and no double accidental at all.
 */
export function isWrittenSpelling(spelling: PitchSpelling): boolean {
  const written = midiToNote(
    60 + noteToPitchClass(spelling),
    spelling.alter < 0 ? 'flat' : 'sharp',
  );
  return written.letter === spelling.letter && written.alter === spelling.alter;
}

/**
 * Name a pitch class, preferring a spelling hint when it is still valid.
 *
 * A hint is used only when no explicit sharp/flat preference was given and the
 * hint still resolves to `pc` (a stale hint left over after transposition is
 * ignored). Otherwise the pitch class is respelled from the requested table,
 * falling back to `inheritFlats` so an unhinted slash bass follows the side its
 * root was spelled on rather than flipping to sharps inside one symbol.
 */
export function pitchClassName(
  pc: number,
  hint: PitchSpelling | undefined,
  system: NoteNameSystem,
  flats?: boolean,
  inheritFlats?: boolean,
): string {
  if (flats === undefined && hint !== undefined && noteToPitchClass(hint) === pc) {
    return symbolName(hint, system);
  }
  return symbolName(plainSpelling(pc, flats ?? inheritFlats ?? false), system);
}

/**
 * Whether a spelling is written on the side of the staff the caller asked for.
 *
 * A natural sits on both sides, so it never forces a respelling; with no
 * preference given every spelling qualifies.
 */
export function onAccidentalSide(spelling: PitchSpelling, flats: boolean | undefined): boolean {
  return flats === undefined || spelling.alter === 0 || spelling.alter < 0 === flats;
}

/**
 * Move a spelling by the step that carries `from` to `to`.
 *
 * This is the one step a whole symbol moves by, whether it is being transposed
 * or respelled onto the other side of the staff: taking the bass and the tones
 * through it is what keeps them inside the chord the root names.
 */
export function bySameStep(
  spelling: PitchSpelling,
  from: PitchSpelling,
  to: PitchSpelling,
): PitchSpelling {
  return bareSpelling(transposeByInterval(spelling, spelledInterval(from, to)));
}

/**
 * A slash bass carried by the root's own step, kept to what a chart writes.
 *
 * The step is what keeps the bass inside the chord the root names, so it is
 * taken first; but carried far enough it lands on a spelling no chart writes —
 * a `C#7/D` asked for on the flat side becomes `Db7` over a bass spelled E
 * double flat. Where that happens the bass falls back to the plain name of its
 * pitch class on the side already in force, which is the reading a chart would
 * have written in the first place.
 *
 * A bass that is one of the chord's own tones is left alone whatever it spells.
 * The augmented fifth of a G sharp is a D double sharp, and writing the first
 * inversion of that chord over an E would name a note the chord does not
 * contain: the odd spelling is what the chord is, not a failure to write it
 * down. The fallback is for the other bass — the one under the chord rather
 * than in it, which the step moved somewhere no chart would have put it.
 *
 * @param spelling The bass as it is written now.
 * @param from The root as it is written now.
 * @param to The root as it is being written.
 * @param asFlat Which side to fall back to when the carried spelling is not one
 *   a chart writes.
 * @param isChordTone Whether a pitch class is one of the chord's own tones.
 * @returns The carried bass: a chord tone as the chord spells it, otherwise a
 *   spelling {@link isWrittenSpelling} takes.
 */
export function carriedBass(
  spelling: PitchSpelling,
  from: PitchSpelling,
  to: PitchSpelling,
  asFlat: boolean,
  isChordTone: (pc: number) => boolean,
): PitchSpelling {
  const carried = bySameStep(spelling, from, to);
  const pc = noteToPitchClass(carried);
  return isChordTone(pc) || isWrittenSpelling(carried) ? carried : plainSpelling(pc, asFlat);
}

/** A spelling hint, or undefined when it no longer names `pc`. */
export function hintFor(hint: PitchSpelling | undefined, pc: number): PitchSpelling | undefined {
  return hint !== undefined && noteToPitchClass(hint) === pc ? hint : undefined;
}

/**
 * The spelling a symbol writes its root in.
 *
 * A hint is kept when it still names the root and already sits on the side the
 * caller asked for; otherwise the pitch class is named from that side's table.
 */
export function rootSpellingFor(
  pc: number,
  hint: PitchSpelling | undefined,
  flats: boolean | undefined,
): PitchSpelling {
  return hint !== undefined && onAccidentalSide(hint, flats)
    ? hint
    : plainSpelling(pc, flats ?? false);
}
