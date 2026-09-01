/**
 * Spelling: derive letter-name notes for scales and chords from a spelled tonic.
 *
 * The theory core works in pitch classes, which cannot choose between (say) a
 * G# and an Ab. Given a spelled tonic, this module assigns diatonic letters to
 * scale degrees and chord tones so a C major scale spells as C D E F G A B and
 * A harmonic minor spells its seventh as G#.
 *
 * Every entry point takes the spelled tonic *of the key it spells*: a tonic
 * sounding a pitch class other than `key.rootPc` is rejected rather than
 * spelled, because the letters counted from it name no reading of the key.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { Note, NoteLike } from '../../core/pitch/index.js';
import {
  formatNote,
  diatonicLetterOf as mod7,
  pitchClassOf as mod12,
  naturalPitchClassOf as naturalPc,
  toNoteData,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { type Chord, chordToneSpellings } from '../chord/index.js';
import { isScaleTone, type KeyLike, scaleTonesInDegreeOrder, toKeyScale } from '../scale/index.js';

/**
 * Conventional degree assignment for each chromatic offset above the tonic.
 *
 * The letter is derived from the tonic's letter plus `degreeOffset` (so the
 * spelling follows the key's diatonic letters), and the accidental is recomputed
 * for that letter. The table covers the whole octave, so a pitch class that is
 * not a degree of the scale — a chromatic tone in a heptatonic key, or any tone
 * outside a pentatonic or blues scale — still spells from the tonic's letter
 * rather than falling back to a fixed sharp table.
 *
 * Offsets follow the conventional ascending chromatic spelling: b2, M2, b3, M3,
 * P4, #4, P5, b6, #6, b7, #7. The raised sixth and leading tone keep sharp-side
 * minor keys spelling their raised degrees with the key-correct letter (e.g. F#
 * minor spells its leading tone E#, not F).
 */
const CHROMATIC_SPELLING: Record<number, number> = {
  1: 1, // b2
  2: 1, // M2
  3: 2, // b3
  4: 2, // M3
  5: 3, // P4
  6: 3, // #4
  7: 4, // P5
  8: 5, // b6
  9: 5, // #6 (raised sixth of a minor key)
  10: 6, // b7
  11: 6, // #7 (raised leading tone of a minor key)
};

/**
 * Flat-side table for scales that are not heptatonic.
 *
 * Identical to {@link CHROMATIC_SPELLING} except at the tritone, which a
 * flat-side scale spells as a diminished fifth rather than the augmented fourth
 * a lydian mode wants: C blues spells C Eb F Gb G Bb.
 */
const CHROMATIC_SPELLING_FLAT: Record<number, number> = {
  ...CHROMATIC_SPELLING,
  6: 4, // b5
};

/**
 * Sharp-side counterpart, used for scales that are not heptatonic and lean
 * sharp: C whole-tone spells C D E F# G# A#.
 */
const CHROMATIC_SPELLING_SHARP: Record<number, number> = {
  1: 0, // #1
  2: 1, // M2
  3: 1, // #2
  4: 2, // M3
  5: 3, // P4
  6: 3, // #4
  7: 4, // P5
  8: 4, // #5
  9: 5, // M6
  10: 5, // #6
  11: 6, // M7
};

/** The pitch class a spelled note sounds. */
function notePitchClass(note: Note): number {
  return mod12(naturalPc(note.letter) + note.alter);
}

/**
 * Reject a tonic that does not spell the key's own root.
 *
 * Every letter these functions assign is counted from the tonic's letter, so a
 * tonic naming a different pitch class than `key.rootPc` does not produce
 * another spelling of the same scale: it produces letters no reading of the key
 * supports, and a heptatonic scale that names one letter twice. The class API
 * rejects the pair in its `Key` constructor, so the functions that take the two
 * apart check it here and both surfaces answer the same way.
 *
 * Not part of the package's public surface: it guards the entry points rather
 * than being one.
 *
 * @param tonic The spelled tonic.
 * @param key The key/scale the tonic is meant to spell.
 * @param source The name of the function that received the pair.
 * @throws If the tonic sounds a pitch class other than the key's root.
 */
export function assertTonicOf(tonic: Note, key: KeyScale, source: string): void {
  const tonicPc = notePitchClass(tonic);
  const rootPc = mod12(key.rootPc);
  if (tonicPc !== rootPc) {
    const name = formatNote({ letter: mod7(tonic.letter), alter: tonic.alter });
    throw new InvalidInputError(
      `${source}: tonic ${name} sounds pitch class ${tonicPc}, not the key root ${rootPc}; ` +
        'pass a tonic that spells the key root, or take one from spelledKeyOf',
    );
  }
}

/** Shortest signed alteration (in [-6, 6]) taking a letter's natural pc to `pc`. */
function alterFor(letter: number, pc: number): number {
  let d = mod12(pc - naturalPc(letter));
  if (d > 6) {
    d -= 12;
  }
  return d;
}

/** Spell `pc` on the letter `degreeOffset` steps above the tonic's letter. */
function letterFor(tonic: Note, degreeOffset: number | undefined, pc: number): Note | undefined {
  if (degreeOffset === undefined) {
    return undefined;
  }
  const letter = mod7(tonic.letter + degreeOffset);
  return { letter, alter: alterFor(letter, pc) };
}

/** The lighter-accidental of two candidate spellings; ties go to `preferFlat`. */
function pickSpelling(
  flat: Note | undefined,
  sharp: Note | undefined,
  preferFlat: boolean,
): Note | undefined {
  if (flat === undefined || sharp === undefined) {
    return flat ?? sharp;
  }
  if (Math.abs(flat.alter) !== Math.abs(sharp.alter)) {
    return Math.abs(flat.alter) < Math.abs(sharp.alter) ? flat : sharp;
  }
  return preferFlat ? flat : sharp;
}

/**
 * Keep a conventional chromatic degree unless its key-letter spelling costs
 * two or more accidentals than the enharmonic alternative. This preserves Db
 * for C-major bII while avoiding Bbb in Ab major, where A is more readable.
 */
function capChromaticAccidentals(preferred: Note, alternative: Note | undefined): Note {
  return alternative !== undefined && Math.abs(preferred.alter) - Math.abs(alternative.alter) >= 2
    ? alternative
    : preferred;
}

/**
 * How many letters a spelling has to share out: one per diatonic letter name.
 *
 * A scale with more tones than this cannot give every tone a letter of its own
 * however it is read, so the octatonic and chromatic sets are spelled tone by
 * tone instead.
 */
const DIATONIC_LETTER_COUNT = 7;

/** Whether the key's scale is a seven-note (heptatonic) scale. */
function isHeptatonic(key: KeyScale): boolean {
  return scaleTonesInDegreeOrder(key).length === DIATONIC_LETTER_COUNT;
}

/** Whether the scale has a minor third and no major third — it leans flat. */
function hasMinorThird(key: KeyScale): boolean {
  const tones = scaleTonesInDegreeOrder(key);
  const root = mod12(key.rootPc);
  return tones.includes(mod12(root + 3)) && !tones.includes(mod12(root + 4));
}

/** Which way a scale leans: a flat tonic and a minor third both mean flats. */
function leansFlat(tonic: Note, key: KeyScale): boolean {
  return tonic.alter < 0 || hasMinorThird(key);
}

/**
 * The conventional spellings of the tone `offset` semitones above the tonic,
 * the side the scale leans towards first.
 *
 * The two chromatic tables name at most two letters for an offset — the flat
 * side's and the sharp side's — and an offset both tables agree on has only the
 * one. Nothing outside them is offered, so a tone is never pushed onto a letter
 * no reading of the interval supports.
 */
function gappedCandidates(tonic: Note, offset: number, pc: number, preferFlat: boolean): Note[] {
  const flat = letterFor(tonic, CHROMATIC_SPELLING_FLAT[offset], pc);
  const sharp = letterFor(tonic, CHROMATIC_SPELLING_SHARP[offset], pc);
  const preferred = pickSpelling(flat, sharp, preferFlat);
  if (preferred === undefined) {
    return [];
  }
  const alternative = preferred === flat ? sharp : flat;
  return alternative === undefined || alternative.letter === preferred.letter
    ? [preferred]
    : [preferred, alternative];
}

/**
 * Choose one candidate per tone so that no two share a letter, or undefined
 * when no such choice exists.
 *
 * `reserved` is the letter the tonic has already taken. Every tone offers at
 * most two candidates, so the whole space is small enough to walk: the lightest
 * assignment wins — fewest accidentals overall, and on a tie the one that keeps
 * most tones on the side the scale leans.
 *
 * Because each tone's leading candidate is already its lightest, the
 * tone-by-tone spelling is itself the winner whenever its letters happen to be
 * distinct, which is what keeps a scale of whole tones or wider spelled exactly
 * as it always reads.
 */
function assignDistinctLetters(candidates: Note[][], reserved: number): Note[] | undefined {
  let best: Note[] | undefined;
  let bestAlter = 0;
  let bestDeviations = 0;
  for (let choice = 0; choice < 1 << candidates.length; choice += 1) {
    const picked: Note[] = [];
    let letters = reserved;
    let alter = 0;
    let deviations = 0;
    for (const [index, options] of candidates.entries()) {
      const preferred = options[0];
      const note = options[(choice >> index) & 1] ?? preferred;
      if (note === undefined || (letters & (1 << note.letter)) !== 0) {
        break;
      }
      letters |= 1 << note.letter;
      alter += Math.abs(note.alter);
      deviations += note === preferred ? 0 : 1;
      picked.push(note);
    }
    if (picked.length !== candidates.length) {
      continue;
    }
    if (
      best === undefined ||
      alter < bestAlter ||
      (alter === bestAlter && deviations < bestDeviations)
    ) {
      best = picked;
      bestAlter = alter;
      bestDeviations = deviations;
    }
  }
  return best;
}

/**
 * Spell every tone of a scale that is not heptatonic, one letter per tone.
 *
 * A heptatonic key spells by degree, which hands every tone its own letter for
 * free. A gapped scale has no such rule, so its tones are spelled together
 * rather than one at a time: the semitone above the tonic of a hemitonic
 * pentatonic is a flattened second (C miyako-bushi spells C Db F G Ab) because
 * the tonic already holds the C, not because a table said so.
 *
 * The answer is undefined — and the caller falls back to spelling tone by tone
 * — when the scale has more tones than there are letters, and when its tones
 * cannot be told apart by letter at all: the blues scale sounds both the fifth
 * and the flattened fifth against a fourth that fixes the letter below them, so
 * one letter is bound to be used twice however the scale is read.
 *
 * @returns A spelling per scale pitch class, or undefined if there is no
 *   one-letter-per-tone reading.
 */
function spellGappedScale(tonic: Note, key: KeyScale): Map<number, Note> | undefined {
  const tones = scaleTonesInDegreeOrder(key);
  if (tones.length > DIATONIC_LETTER_COUNT) {
    return undefined;
  }
  const tonicPc = mod12(naturalPc(tonic.letter) + tonic.alter);
  const tonicNote: Note = { letter: mod7(tonic.letter), alter: tonic.alter };
  const preferFlat = leansFlat(tonic, key);
  const rest = tones.filter((pc) => mod12(pc - tonicPc) !== 0);
  const chosen = assignDistinctLetters(
    rest.map((pc) => gappedCandidates(tonic, mod12(pc - tonicPc), pc, preferFlat)),
    1 << tonicNote.letter,
  );
  if (chosen === undefined) {
    return undefined;
  }
  const spellings = new Map<number, Note>([[tonicPc, tonicNote]]);
  for (const [index, pc] of rest.entries()) {
    const note = chosen[index];
    if (note !== undefined) {
      spellings.set(mod12(pc), note);
    }
  }
  return spellings;
}

/**
 * Spell a single pitch class from the key alone, with no surrounding context.
 *
 * The tonic always spells as itself. In a heptatonic key each scale degree takes
 * the next letter above the tonic, so the scale spells with one letter per
 * degree. A gapped scale reaches the same one-letter-per-tone spelling through
 * {@link spellGappedScale} wherever its pitch set allows one. Every other pitch
 * class — a chromatic tone, or a tone of a scale whose letters cannot all
 * differ — takes the conventional interval spelling above the tonic's letter,
 * so a flat-side key keeps flat-side names.
 */
function spellByKey(pc: number, tonic: Note, key: KeyScale): Note {
  const tonicPc = mod12(naturalPc(tonic.letter) + tonic.alter);
  const offset = mod12(pc - tonicPc);

  // The tonic spells as itself, whatever the scale: a caller that asked for Eb
  // major pentatonic must not be handed back a D#.
  if (offset === 0) {
    return { letter: mod7(tonic.letter), alter: tonic.alter };
  }

  const heptatonic = isHeptatonic(key);
  if (heptatonic) {
    const degree = scaleTonesInDegreeOrder(key).indexOf(mod12(pc));
    if (degree >= 0) {
      const letter = mod7(tonic.letter + degree);
      return { letter, alter: alterFor(letter, pc) };
    }
    const degreeOffset = CHROMATIC_SPELLING[offset];
    const preferred = letterFor(tonic, degreeOffset, pc);
    if (preferred !== undefined) {
      const flat = letterFor(tonic, CHROMATIC_SPELLING_FLAT[offset], pc);
      const sharp = letterFor(tonic, CHROMATIC_SPELLING_SHARP[offset], pc);
      // The conventional heptatonic degree is usually the flat-side candidate;
      // use the other side only when it avoids a double (or worse) accidental.
      const alternative =
        flat?.letter === preferred.letter
          ? sharp
          : sharp?.letter === preferred.letter
            ? flat
            : undefined;
      return capChromaticAccidentals(preferred, alternative);
    }
  } else {
    // A scale that is not heptatonic has no letter-per-degree spelling to
    // follow, so its own tones are spelled together, one letter each.
    if (isScaleTone(pc, key)) {
      const assigned = spellGappedScale(tonic, key)?.get(mod12(pc));
      if (assigned !== undefined) {
        return assigned;
      }
    }
    // Anything that joint spelling does not reach — a chromatic tone, or a
    // scale whose tones cannot each hold a letter — takes whichever
    // conventional letter needs the smaller accidental. Ties go to the side the
    // scale itself leans: a flat tonic or a minor third both mean flats (C
    // blues spells Gb and Bb, not F# and A#).
    const [preferred] = gappedCandidates(tonic, offset, pc, leansFlat(tonic, key));
    if (preferred !== undefined) {
      return preferred;
    }
  }

  // Unreachable for a pitch class, since both tables cover offsets 1..11 and
  // offset 0 returns above; kept so a non-integral input still names something.
  const belowLetter = mod7([0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][mod12(pc)] ?? 0);
  return { letter: belowLetter, alter: alterFor(belowLetter, pc) };
}

/**
 * The musical evidence around a pitch, used to refine an enharmonic choice the
 * key alone cannot make.
 *
 * Every field is optional and every field is only ever advisory: a context that
 * says nothing about the pitch leaves its key spelling untouched.
 *
 * @category Pitch & Intervals
 */
export type SpellingContext = {
  /** Root pitch class of the chord sounding under the pitch, when known. */
  chordRoot?: number;
  /** The pitch immediately before this one (MIDI pitch or bare pitch class). */
  previous?: number;
  /** The pitch immediately after this one (MIDI pitch or bare pitch class). */
  next?: number;
};

/**
 * Letter distance above a chord root for the chord-tone intervals that spell
 * unambiguously: root, minor third, major third, perfect fifth, minor seventh,
 * major seventh.
 *
 * Both thirds sit two letters above the root and both sevenths six, which is
 * what makes the third of a D7 in C major an F# rather than a Gb. The intervals
 * left out are the ones a chord tone does not fix — the tritone, the augmented
 * fifth and the tensions all have two defensible spellings, so they are left to
 * the melodic rules and, failing those, to the key.
 */
const CHORD_TONE_LETTER_STEPS: Record<number, number> = {
  0: 0, // root
  3: 2, // minor third
  4: 2, // major third
  7: 4, // perfect fifth
  10: 6, // minor seventh
  11: 6, // major seventh
};

/** Widest alteration a context-derived spelling may carry: a double accidental. */
const MAX_CONTEXT_ALTER = 2;

/** Spell `pc` as a chord tone, on the letter its interval above the root implies. */
function chordToneSpelling(
  pc: number,
  chordRoot: number | undefined,
  tonic: Note,
  key: KeyScale,
): Note | undefined {
  if (chordRoot === undefined) {
    return undefined;
  }
  const root = spellByKey(mod12(chordRoot), tonic, key);
  return letterFor(root, CHORD_TONE_LETTER_STEPS[mod12(pc - chordRoot)], pc);
}

/**
 * Spell `pc` relative to a neighbouring pitch, when that neighbour lies `gap`
 * semitones away from it.
 *
 * The neighbour is spelled by the key alone — the pitch being spelled is the
 * ambiguous one, so letting it influence its own evidence would be circular —
 * and `pc` then takes the letter `letterStep` steps from it. A `letterStep` of
 * zero keeps the neighbour's own letter, which spells `pc` as that note
 * inflected by an accidental. Neighbours compare as pitch classes, so a MIDI
 * pitch and a bare pitch class both work.
 */
function neighbourSpelling(
  neighbour: number | undefined,
  gap: number,
  letterStep: number,
  pc: number,
  tonic: Note,
  key: KeyScale,
): Note | undefined {
  if (neighbour === undefined || mod12(neighbour - pc) !== mod12(gap)) {
    return undefined;
  }
  return letterFor(spellByKey(mod12(neighbour), tonic, key), letterStep, pc);
}

/**
 * Refine a key spelling with the surrounding evidence, in rule priority order.
 *
 * A scale tone and the tonic itself are never touched: the key already spells
 * them, and a context must not turn the third of the scale into something else.
 * For anything chromatic the rules are tried in order and the first spelling
 * that stays within a double accidental wins; when none does, the key spelling
 * stands.
 */
function refineByContext(
  pc: number,
  tonic: Note,
  key: KeyScale,
  context: SpellingContext,
  keySpelling: Note,
): Note {
  const tonicPc = mod12(naturalPc(tonic.letter) + tonic.alter);
  if (mod12(pc) === tonicPc || isScaleTone(pc, key)) {
    return keySpelling;
  }
  const { chordRoot, previous, next } = context;
  const candidates = [
    // The sounding chord names the pitch by its interval above the root.
    chordToneSpelling(pc, chordRoot, tonic, key),
    // A semitone below what follows: the pitch is its leading tone, a letter down.
    neighbourSpelling(next, 1, -1, pc, tonic, key),
    // A semitone above what preceded: the pitch is that note inflected upward,
    // so it keeps its letter and a chromatic ascent spells with sharps.
    neighbourSpelling(previous, -1, 0, pc, tonic, key),
    // A semitone above what follows: the pitch leans on it from a letter up,
    // so a falling line spells with flats.
    neighbourSpelling(next, -1, 1, pc, tonic, key),
    // Failing that, a semitone below what preceded: that note inflected downward,
    // again on its own letter.
    neighbourSpelling(previous, 1, 0, pc, tonic, key),
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && Math.abs(candidate.alter) <= MAX_CONTEXT_ALTER) {
      return candidate;
    }
  }
  return keySpelling;
}

/**
 * Spell a single pitch class relative to a spelled tonic and key, optionally
 * refined by the music around it.
 *
 * Without a context the key decides alone: the tonic spells as itself, each
 * degree of a heptatonic key takes the next letter above the tonic, a gapped
 * scale gives each of its own tones a letter wherever its pitch set allows one,
 * and every other pitch class takes the conventional interval spelling above
 * the tonic's letter, so a flat-side key keeps flat-side names.
 *
 * A context only ever refines a pitch class the key leaves ambiguous — one that
 * is not a tone of `key`. Scale tones, and the tonic, keep their key spelling
 * whatever the context says.
 *
 * The melodic rules read the two neighbours differently, because a chromatic
 * note is an inflection of the note it came from but a leading tone into the
 * note it goes to: `next` moves the letter, `previous` keeps it. For a chromatic
 * pitch class the evidence is weighed in this order, and the first spelling
 * within a double accidental wins:
 *
 * 1. The sounding chord, when `chordRoot` is given and the pitch is an
 *    unambiguous chord tone above it (root, third, fifth or seventh) — the third
 *    of a secondary dominant D7 in C major spells F#, not Gb.
 * 2. Resolution: `next` a semitone above makes the pitch a leading tone into it,
 *    one letter below — the C# rising to D in D minor.
 * 3. Approach: `previous` a semitone below inflects that note upward, keeping
 *    its letter, so a chromatic ascent spells with sharps — F F# G in C major.
 * 4. Descent: `next` a semitone below puts the pitch one letter above it, so a
 *    falling chromatic line spells with flats — A Ab G in C major. Failing that,
 *    `previous` a semitone above inflects that note downward on its own letter,
 *    which spells the same line from the note before instead.
 *
 * If no rule applies, or every candidate would need more than a double
 * accidental, the key spelling stands.
 *
 * @param pc The pitch class to spell.
 * @param tonic The spelled tonic (its letter anchors the spelling), as a note
 *   name, a MIDI number, note data, or a `Note`.
 * @param key The key/scale, as a key name, a key/scale, or a `Key`.
 * @param context Optional surrounding evidence; an absent or empty context
 *   spells exactly as the key alone does.
 * @returns The spelled note (without octave).
 * @throws If `tonic` does not sound the key's root pitch class.
 * @example
 * ```ts
 * import { spellPitchClass, formatNote, parseNote, majorKey } from '@libraz/libcantus';
 * const c = parseNote('C');
 * formatNote(spellPitchClass(6, c, majorKey(0))); // 'F#'
 * // The third of D7, the secondary dominant of G.
 * formatNote(spellPitchClass(6, 'C', 'C major', { chordRoot: 2 })); // 'F#'
 * // A chromatic passing tone falling from G to F.
 * formatNote(spellPitchClass(6, c, majorKey(0), { previous: 7, next: 5 })); // 'Gb'
 * ```
 * @category Pitch & Intervals
 */
export function spellPitchClass(
  pc: number,
  tonic: NoteLike,
  key: KeyLike,
  context?: SpellingContext,
): Note {
  const note = toNoteData(tonic);
  const scale = toKeyScale(key);
  assertTonicOf(note, scale, 'spellPitchClass');
  return spelledPitchClass(pc, note, scale, context);
}

/** Spell a pitch class from an already-resolved tonic and key. */
function spelledPitchClass(
  pc: number,
  tonic: Note,
  key: KeyScale,
  context?: SpellingContext,
): Note {
  const keySpelling = spellByKey(pc, tonic, key);
  return context === undefined
    ? keySpelling
    : refineByContext(pc, tonic, key, context, keySpelling);
}

/**
 * Spell every pitch class of a scale, in ascending scale-degree order.
 *
 * Correct for heptatonic scales (each degree gets the next letter). A gapped
 * scale gives each of its tones a letter of its own wherever its pitch set
 * allows one — C miyako-bushi spells C Db F G Ab — and is spelled tone by tone,
 * on the accidental side the scale leans towards, where it does not: the blues
 * scale has to name one letter twice however it is read.
 *
 * @param tonic The spelled tonic, as a note name, a MIDI number, note data, or a
 *   `Note`.
 * @param key The key/scale, as a key name, a key/scale, or a `Key` — the same
 *   forms its sibling spellers take.
 * @returns Spelled notes, one per scale degree.
 * @throws If `key` names no key, or if `tonic` does not sound the key's root
 *   pitch class.
 * @example
 * ```ts
 * import { spellScale, noteNames, parseNote, majorKey } from '@libraz/libcantus';
 * noteNames(spellScale(parseNote('C'), majorKey(0)));
 * // ['C', 'D', 'E', 'F', 'G', 'A', 'B']
 * ```
 * @category Pitch & Intervals
 */
export function spellScale(tonic: NoteLike, key: KeyLike): Note[] {
  const note = toNoteData(tonic);
  const scale = toKeyScale(key);
  assertTonicOf(note, scale, 'spellScale');
  return scaleTonesInDegreeOrder(scale).map((pc) => spelledPitchClass(pc, note, scale));
}

/**
 * Spell an arbitrary list of pitch classes relative to a key.
 *
 * @param pcs The pitch classes.
 * @param tonic The spelled tonic, as a note name, a MIDI number, note data, or a
 *   `Note`.
 * @param key The key/scale, as a key name, a key/scale, or a `Key`.
 * @returns Spelled notes, in input order.
 * @throws If `tonic` does not sound the key's root pitch class.
 * @category Pitch & Intervals
 */
export function spellPitchClasses(pcs: number[], tonic: NoteLike, key: KeyLike): Note[] {
  const note = toNoteData(tonic);
  const scale = toKeyScale(key);
  assertTonicOf(note, scale, 'spellPitchClasses');
  return pcs.map((pc) => spelledPitchClass(pc, note, scale));
}

/**
 * Diatonic letter distance implied by a chord interval.
 *
 * Chord intervals are not merely pitch-class distances: 6 is a diminished
 * fifth in the basic chord templates while 18 is an augmented eleventh, and 9
 * is a diminished seventh in `dim7` but a sixth elsewhere. Keeping that
 * distinction is what prevents functional chord tones from being respelled by
 * their nearest key pitch (for example G# becoming Ab in E7).
 */
function chordLetterOffset(interval: number, chord: Chord): number {
  switch (interval) {
    case 0:
    case 12:
      return 0;
    case 1:
    case 2:
    case 13:
    case 14:
      return 1;
    case 3:
    case 4:
    case 16:
      return 2;
    case 15:
      // A raised ninth over a chord that already has a third is a ninth, not a
      // second third: C7#9 spells D#, not a duplicate E.
      return chord.intervals.some((i) => i === 3 || i === 4) ? 1 : 2;
    case 5:
    case 17:
    case 18:
      return 3;
    case 6:
    case 7:
    case 8:
    case 19:
      return 4;
    case 9:
      return chord.quality === 'dim7' ? 6 : 5;
    case 20:
    case 21:
      return 5;
    case 10:
    case 11:
    case 22:
    case 23:
      return 6;
    default: {
      // Unknown/custom interval data gets the nearest conventional diatonic
      // distance. Public builders use the explicit cases above.
      const octaves = Math.floor(Math.max(0, interval) / 12);
      const simple = mod12(interval);
      const simpleOffset = [0, 1, 1, 2, 2, 3, 4, 4, 4, 5, 6, 6][simple] ?? 0;
      return octaves * 7 + simpleOffset;
    }
  }
}

/**
 * The letter distance above the root each of a chord's own tone spellings
 * implies, or undefined when the chord names none this function can trust.
 *
 * This is the one route by which a chord can spell a tone {@link chordLetterOffset}
 * cannot: the augmented sixth over the lowered submediant is ten semitones like
 * a minor seventh, but five letters above its root rather than six, and no
 * rotation of the chord makes that a stack of thirds. Distances are read out of
 * the hint rather than letters, and the distances are measured from the hint's
 * own root tone, so the tones follow whichever spelling of the root is in
 * force: the German sixth spells Ab C Eb F# from an Ab root and G# B# D# E##
 * from a G# one.
 */
function hintedLetterOffsets(chord: Chord): number[] | undefined {
  const hints = chordToneSpellings(chord);
  const rootHint = hints?.[chord.intervals.findIndex((interval) => mod12(interval) === 0)];
  if (hints === undefined || rootHint === undefined) {
    return undefined;
  }
  return hints.map((hint) => mod7(hint.letter - rootHint.letter));
}

/**
 * Spell chord tones from an already chosen root spelling.
 *
 * This is public for callers that already know the desired root spelling;
 * {@link spellChord} instead derives that spelling from the chord and key.
 *
 * Letters follow the chord's own tone spellings when it carries a usable set,
 * and otherwise the diatonic distance each interval implies in a stack of
 * thirds. Accidentals are always recomputed from the sounding pitch class, so
 * the tones name exactly the chord's own pitch classes either way.
 *
 * @param chord The chord whose tones are spelled.
 * @param root The chosen root spelling, as a note name, a MIDI number, note
 *   data, or a `Note`.
 */
export function spellChordFromRoot(chord: Chord, root: NoteLike): Note[] {
  return chordTonesFromRoot(chord, toNoteData(root));
}

/** Spell chord tones from an already-resolved root spelling. */
function chordTonesFromRoot(chord: Chord, root: Note): Note[] {
  if (mod12(naturalPc(root.letter) + root.alter) !== mod12(chord.rootPc)) {
    throw new InvalidInputError('chord root spelling must match chord.rootPc');
  }
  const hinted = hintedLetterOffsets(chord);
  return chord.intervals.map((interval, index) => {
    const letter = mod7(root.letter + (hinted?.[index] ?? chordLetterOffset(interval, chord)));
    const pc = mod12(chord.rootPc + interval);
    return { letter, alter: alterFor(letter, pc) };
  });
}

/**
 * Spell a chord's tones, in the chord's own (tertian) order, relative to a key.
 *
 * Diatonic chords spell exactly (e.g. G7 in C major -> G B D F). Chromatic chord
 * tones take their conventional spelling; enharmonically ambiguous altered
 * tensions may be spelled by the general convention rather than by chord
 * function.
 *
 * A chord carrying its own tone spellings is spelled by them, since a chord
 * whose letters do not follow from stacking thirds can say so no other way:
 * that is what keeps the German sixth of C major on its F#, the note that
 * resolves outward to the dominant, rather than the Gb a dominant seventh
 * would put there.
 *
 * @param chord The chord.
 * @param tonic The spelled tonic of the key, as a note name, a MIDI number,
 *   note data, or a `Note`.
 * @param key The key/scale, as a key name, a key/scale, or a `Key`.
 * @returns Spelled chord tones, root first.
 * @throws If `tonic` does not sound the key's root pitch class.
 * @example
 * ```ts
 * import { spellChord, noteNames, parseNote, majorKey, makeChord } from '@libraz/libcantus';
 * // G7 in C major
 * noteNames(spellChord(makeChord(7, 'dom7'), parseNote('C'), majorKey(0)));
 * // ['G', 'B', 'D', 'F']
 * ```
 * @category Pitch & Intervals
 */
export function spellChord(chord: Chord, tonic: NoteLike, key: KeyLike): Note[] {
  const note = toNoteData(tonic);
  const scale = toKeyScale(key);
  assertTonicOf(note, scale, 'spellChord');
  return chordTonesFromRoot(chord, chordRootSpelling(chord, note, scale));
}

/**
 * The root spelling to use for a chord: the chord's own hint when it still
 * matches the root pitch class, otherwise the key's spelling of that pitch
 * class.
 *
 * Honouring the hint is what keeps a chord's spelled tones agreeing with the
 * symbol it renders as — `parseChordSymbol('C#7')` must spell C# E# G# B even
 * when analysed in a flat-side key.
 */
function chordRootSpelling(chord: Chord, tonic: Note, key: KeyScale): Note {
  const hint = chord.rootSpelling;
  if (hint !== undefined && mod12(naturalPc(hint.letter) + hint.alter) === mod12(chord.rootPc)) {
    return { letter: mod7(hint.letter), alter: hint.alter };
  }
  return spelledPitchClass(chord.rootPc, tonic, key);
}

/**
 * Spell a MIDI pitch relative to a key, keeping its octave.
 *
 * The octave-less sibling of this function, {@link spellPitchClass}, is enough
 * for chord and scale spelling; this one is for naming actual sounding pitches
 * (a generated line, an imported track) without losing the register.
 *
 * The octave is the one that reproduces `pitch` from the chosen spelling, so a
 * context that changes the letter changes the octave with it: MIDI 60 spelled
 * B# is B#3, not B#4.
 *
 * @param pitch The MIDI pitch; rounded to the nearest integer.
 * @param tonic The spelled tonic of the key, as a note name, a MIDI number,
 *   note data, or a `Note`.
 * @param key The key/scale, as a key name, a key/scale, or a `Key`.
 * @param context Optional surrounding evidence, weighed exactly as
 *   {@link spellPitchClass} weighs it.
 * @returns The spelled note, carrying the octave that reproduces `pitch`.
 * @throws If `tonic` does not sound the key's root pitch class.
 * @example
 * ```ts
 * import { spellPitch, formatNote, parseNote, majorKey } from '@libraz/libcantus';
 * formatNote(spellPitch(70, parseNote('Eb'), majorKey(3))); // 'Bb4'
 * ```
 * @category Pitch & Intervals
 */
export function spellPitch(
  pitch: number,
  tonic: NoteLike,
  key: KeyLike,
  context?: SpellingContext,
): Note {
  const note = toNoteData(tonic);
  const scale = toKeyScale(key);
  assertTonicOf(note, scale, 'spellPitch');
  const rounded = Math.round(pitch);
  const spelled = spelledPitchClass(mod12(rounded), note, scale, context);
  const octave = (rounded - naturalPc(spelled.letter) - spelled.alter) / 12 - 1;
  return { letter: spelled.letter, alter: spelled.alter, octave };
}

/**
 * Convenience: render spelled notes as letter-name strings.
 *
 * @param notes The notes, each a note name, a MIDI number, note data, or a
 *   `Note`.
 * @returns Their formatted names.
 * @category Pitch & Intervals
 */
export function noteNames(notes: readonly NoteLike[]): string[] {
  // Wrapped rather than passed by reference: `map` supplies an index that
  // `formatNote`'s options parameter would read as a naming system.
  return notes.map((note) => formatNote(toNoteData(note)));
}
