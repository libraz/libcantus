/**
 * Line spelling: name every note of a melodic line in one pass.
 *
 * {@link spellPitch} decides one note from the key, the root of the chord under
 * it and its two immediate neighbours. That is enough for a single note, but a
 * line spelled note by note can zig-zag between the two readings of one idea —
 * a rising whole-tone figure comes out F# Ab Bb, with a diminished third in the
 * middle of it.
 *
 * This module solves the whole line at once. The theory layer's own judgment
 * becomes the cost of emitting a spelling, the melodic rules become the cost of
 * moving from one spelling to the next, and a dynamic program takes the
 * cheapest path across the line. Nothing here re-decides what
 * {@link spellPitchClass} and {@link spellChord} already decide: it only weighs
 * their answers against the shape of the line they sit in.
 */

import type { Note, NoteLike } from '../../core/pitch/index.js';
import {
  diatonicLetterOf as mod7,
  pitchClassOf as mod12,
  naturalPitchClassOf as naturalPc,
  toNoteData,
} from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import { assertGenerationBudget, assertNoteEvents } from '../../core/validation/index.js';
import type { Chord } from '../../theory/chord/index.js';
import { isScaleTone, type KeyLike, resolveKey } from '../../theory/scale/index.js';
import { assertTonicOf, spellChord, spellPitchClass } from '../../theory/spelling/index.js';
import type { ChordTimeline } from '../timeline/index.js';

/**
 * The four rules, and what happens where they pull against each other.
 *
 * The costs below are spread far enough apart that a rule can never be
 * outvoted by any number of the rules under it, which fixes the precedence:
 *
 * 1. **The sounding chord.** A note the chord names takes the chord's own
 *    spelling of that tone. This is the one place the line departs from
 *    {@link spellPitchClass}, which never respells a tone of the key: over a
 *    Db7 the seventh has to read Cb even in C major, where B is a scale tone,
 *    because a dominant seventh spelled as a sixth is not the chord that was
 *    played.
 * 2. **The key's scale.** Anything else the key itself spells — a scale tone,
 *    and the tonic — keeps that spelling, exactly as the note-by-note path
 *    keeps it. No amount of melodic pressure moves it.
 * 3. **The shape of the line, then its direction.** A chromatic note is spelled
 *    so the letters of the intervals around it match the intervals actually
 *    sounding, and a stepwise line then prefers sharps rising and flats
 *    falling. Shape outranks direction because a rising line spelled with
 *    sharps is still wrong if it spells a whole tone as a diminished third.
 * 4. **The key's chromatic convention, then the fewest accidentals.** What the
 *    key alone would have said, as the tiebreak it is: the direction rule beats
 *    it, which is why a chromatic ascent in C major spells C# D# G# A# rather
 *    than the flats the key prefers, but one-sided evidence — a chromatic note
 *    with only one stepwise neighbour — does not.
 */

/** Emission cost for a spelling the chord sounding under the note does not name. */
const CHORD_MISMATCH = 64;

/** Emission cost for respelling a tone the key's own scale already names. */
const SCALE_TONE_MISMATCH = 32;

/** Transition cost per diatonic step an interval's letters miss its written size by. */
const LETTER_STEP_DEVIATION = 4;

/**
 * How many steps of deviation are counted before the cost stops growing.
 *
 * Two letters out is already an interval no reading supports, and capping there
 * keeps the whole melodic term below {@link SCALE_TONE_MISMATCH}, so a badly
 * shaped line can never argue a scale tone out of its key spelling.
 */
const MAX_COUNTED_DEVIATION = 2;

/** Transition cost for an accidental leaning against the direction of a stepwise line. */
const AGAINST_DIRECTION = 3;

/** Emission cost for a chromatic spelling the key alone would not choose. */
const KEY_MISMATCH = 4;

/** Emission cost per semitone of alteration: what minimises accidentals overall. */
const ACCIDENTAL = 1;

/** Widest melodic interval still counted as a step, where the direction rule applies. */
const MAX_STEP = 2;

/** Widest alteration a spelling may carry: a double accidental. */
const MAX_ALTER = 2;

/**
 * Spellings each pitch class has within a double accidental.
 *
 * Always exactly three — a natural or its accidental, one letter above, one
 * letter below (C is C, B# and Dbb) — which is what bounds the work the dynamic
 * program is allowed to do.
 */
const SPELLINGS_PER_PITCH = 3;

/**
 * The diatonic letter distances a melodic interval of a given size is
 * conventionally written with, indexed by its semitone class.
 *
 * Most sizes read only one way: a whole tone is a second, a minor third is a
 * third, so spelling one as anything else costs. Two sizes read two ways and
 * both are free — a semitone is either a chromatic inflection of one letter
 * (F to F#) or a diatonic step (E to F), and the tritone is either an augmented
 * fourth or a diminished fifth. Direction chooses between those.
 */
const CONVENTIONAL_LETTER_STEPS: readonly (readonly number[])[] = [
  [0], // unison
  [0, 1], // chromatic semitone or diatonic semitone
  [1], // second
  [2], // minor third
  [2], // major third
  [3], // fourth
  [3, 4], // augmented fourth or diminished fifth
  [4], // fifth
  [5], // minor sixth
  [5], // major sixth
  [6], // minor seventh
  [6], // major seventh
];

/**
 * Options for {@link spellLine}.
 *
 * @category Arrangement & Analysis
 */
export type SpellLineOptions = {
  /**
   * Tonic spelling to anchor the key, for a caller that already knows how the
   * piece is written. It must sound the key's own root pitch class; anything
   * else is rejected rather than spelled. Defaults to the conventional
   * spelling the key itself is written with. Accepted as a note name, a MIDI
   * number, note data, or a `Note`.
   */
  tonic?: NoteLike;
  /** Upper bound on the work the line may cost; defaults to the generation budget. */
  budget?: number;
};

/** Shortest signed alteration (in [-6, 6]) taking a letter's natural pc to `pc`. */
function alterationFor(letter: number, pc: number): number {
  const distance = mod12(pc - naturalPc(letter));
  return distance > 6 ? distance - 12 : distance;
}

/** The octave that reproduces `pitch` from a letter and its alteration. */
function octaveFor(pitch: number, letter: number, alter: number): number {
  return (pitch - naturalPc(letter) - alter) / 12 - 1;
}

/** Whether two spellings name the same letter with the same alteration. */
function sameSpelling(a: Note, b: Note): boolean {
  return a.letter === b.letter && a.alter === b.alter;
}

/**
 * Every spelling of `pitch` within a double accidental, `preferred` first.
 *
 * The order is what settles a tie: two readings that cost the same are equally
 * defensible, and the one the theory layer would have chosen alone is then the
 * one that stands.
 */
function candidatesFor(pitch: number, preferred: Note): Note[] {
  const pc = mod12(pitch);
  const rest: Note[] = [];
  for (let letter = 0; letter < 7; letter += 1) {
    const alter = alterationFor(letter, pc);
    if (Math.abs(alter) > MAX_ALTER || letter === preferred.letter) {
      continue;
    }
    rest.push({ letter, alter, octave: octaveFor(pitch, letter, alter) });
  }
  rest.sort((a, b) => Math.abs(a.alter) - Math.abs(b.alter) || a.letter - b.letter);
  return [
    {
      letter: preferred.letter,
      alter: preferred.alter,
      octave: octaveFor(pitch, preferred.letter, preferred.alter),
    },
    ...rest,
  ];
}

/**
 * The chord's own spelling of a pitch class, or undefined when the chord does
 * not sound it.
 *
 * The tones come from {@link spellChord}, so a chord carrying its own spellings
 * — a parsed symbol, an augmented sixth — is read by them; a slash bass outside
 * the chord's tones is spelled from its hint when it has one.
 */
function chordSpellingOf(pc: number, chord: Chord, tonic: Note, key: KeyScale): Note | undefined {
  for (const tone of spellChord(chord, tonic, key)) {
    if (mod12(naturalPc(tone.letter) + tone.alter) === pc) {
      return tone;
    }
  }
  const bass = chord.bassPc;
  if (bass === undefined || mod12(bass) !== pc) {
    return undefined;
  }
  const hint = chord.bassSpelling;
  return hint !== undefined && mod12(naturalPc(hint.letter) + hint.alter) === pc
    ? { letter: mod7(hint.letter), alter: hint.alter }
    : spellPitchClass(pc, tonic, key);
}

/** One note of the line, with the spellings open to it and what each costs. */
type LineState = {
  pitch: number;
  /** True when the key does not already spell this pitch, so direction may decide. */
  chromatic: boolean;
  candidates: Note[];
  emissions: number[];
  /** The spelling the note-by-note path would have chosen, used as the fallback. */
  reference: Note;
};

/**
 * Weigh every spelling open to one note against what the chord and the key say
 * about it.
 *
 * The reference spelling is the theory layer's own answer — the chord's, when
 * the chord names the note, and the key's otherwise — and the cost of departing
 * from it is what ranks the three rules that do not depend on the neighbours.
 */
function stateFor(pitch: number, chord: Chord | null, tonic: Note, key: KeyScale): LineState {
  const pc = mod12(pitch);
  const fromChord = chord === null ? undefined : chordSpellingOf(pc, chord, tonic, key);
  const scaleTone = isScaleTone(pc, key);
  const reference = fromChord ?? spellPitchClass(pc, tonic, key);
  const mismatch =
    fromChord !== undefined ? CHORD_MISMATCH : scaleTone ? SCALE_TONE_MISMATCH : KEY_MISMATCH;
  const candidates = candidatesFor(pitch, reference);
  return {
    pitch,
    chromatic: !scaleTone,
    candidates,
    emissions: candidates.map(
      (candidate) =>
        (sameSpelling(candidate, reference) ? 0 : mismatch) +
        ACCIDENTAL * Math.abs(candidate.alter),
    ),
    reference,
  };
}

/** A spelling's position on the diatonic ladder, octave included. */
function diatonicIndex(note: Note): number {
  return note.letter + 7 * (note.octave ?? 0);
}

/**
 * What the letters of a melodic interval cost when they do not match the
 * interval that actually sounds.
 *
 * Both notes are already spelled, so the sounding interval and the written one
 * are both known: a whole tone written F# to Ab is two letters apart where a
 * second is one, and pays for the difference.
 */
function letterStepCost(from: Note, to: Note, semitones: number): number {
  const written = diatonicIndex(to) - diatonicIndex(from);
  const size = Math.abs(semitones);
  const octaves = Math.floor(size / 12);
  const direction = semitones < 0 ? -1 : 1;
  let deviation = Number.POSITIVE_INFINITY;
  for (const steps of CONVENTIONAL_LETTER_STEPS[size % 12] ?? []) {
    deviation = Math.min(deviation, Math.abs(written - direction * (octaves * 7 + steps)));
  }
  if (!Number.isFinite(deviation)) {
    return 0;
  }
  return LETTER_STEP_DEVIATION * Math.min(deviation, MAX_COUNTED_DEVIATION);
}

/**
 * What an accidental costs for leaning the wrong way in a stepwise line: a
 * rising line is written with sharps and a falling one with flats.
 *
 * Only steps are judged. The rule describes chromatic motion, and a leap onto a
 * flat says nothing about the flat — the key and the chord have the whole story
 * there.
 */
function directionCost(note: Note, chromatic: boolean, semitones: number): number {
  if (!chromatic || semitones === 0 || Math.abs(semitones) > MAX_STEP) {
    return 0;
  }
  const rising = semitones > 0;
  return (rising && note.alter < 0) || (!rising && note.alter > 0) ? AGAINST_DIRECTION : 0;
}

/**
 * The cost of following one spelling with another.
 *
 * Direction is charged to both notes: a chromatic note is judged by the step it
 * arrives on and by the step it leaves on, so a note inside a run collects the
 * rule twice and a note at the end of one collects it once.
 */
function transitionCost(from: LineState, source: Note, to: LineState, target: Note): number {
  const semitones = to.pitch - from.pitch;
  return (
    letterStepCost(source, target, semitones) +
    directionCost(target, to.chromatic, semitones) +
    directionCost(source, from.chromatic, semitones)
  );
}

/**
 * Spell a whole melodic line at once, so its notes agree with each other.
 *
 * Every note is spelled together with the rest of the line rather than one at a
 * time: each pitch offers the three spellings a double accidental allows, the
 * chord and the key price them, the intervals between neighbours price the
 * pairs, and the cheapest reading of the whole line wins. Ties fall to the
 * spelling {@link spellPitchClass} would have chosen alone, so the answer never
 * drifts from the theory layer without a reason.
 *
 * Four rules decide, in this order:
 *
 * 1. A note the sounding chord names takes that chord's spelling of it, even
 *    when the key spells the pitch otherwise — the seventh of a Db7 reads Cb in
 *    C major, not B.
 * 2. Anything else the key's scale spells keeps its key spelling, exactly as
 *    the note-by-note path keeps it.
 * 3. A chromatic note is spelled so the written intervals around it match the
 *    sounding ones, and then so a rising step carries a sharp and a falling
 *    step a flat.
 * 4. Failing all of that, the key's own chromatic spelling stands, and the
 *    fewest accidentals win.
 *
 * Without a timeline — pass `null` — rules 2 to 4 still apply in full, so a
 * diatonic line and a chromatic run come out the same. What is lost is rule 1:
 * a chromatic chord can no longer name its own tones, so the tones of a
 * borrowed or altered chord fall back to the key's convention (that Cb becomes
 * B), and an enharmonically ambiguous tone under a chord that would have fixed
 * it is decided by the line's direction instead.
 *
 * @param notes The line, monophonic and in time order. Notes sharing an onset
 *   are read as consecutive, so split polyphonic material into voices first.
 * @param timeline The chords sounding under the line, or null when only the key
 *   is known. Each note is judged against the chord at its own onset.
 * @param key The key the line is written in, as a key name, a key/scale, or a
 *   `Key`.
 * @param opts Optional tonic spelling and work budget.
 * @returns One spelled note per input note, in input order, each carrying the
 *   octave that reproduces its pitch.
 * @throws If `opts.tonic` does not sound the key's root pitch class, if a note
 *   event is malformed, or if the line is longer than the budget allows.
 * @example
 * ```ts
 * import { chordTimelineFromChords, majorKey, noteNames, spellLine } from '@libraz/libcantus';
 * // A chromatic ascent spells with sharps, whatever the key would say alone.
 * const rising = [60, 61, 62, 63, 64].map((pitch, index) => ({
 *   pitch,
 *   startBeat: index,
 *   durationBeat: 1,
 * }));
 * noteNames(spellLine(rising, null, majorKey(0)));
 * // ['C4', 'C#4', 'D4', 'D#4', 'E4']
 * // Under a Db7 the same B sounds as the chord's seventh.
 * const timeline = chordTimelineFromChords([{ rootPc: 1, quality: 'dom7', startBeat: 0 }], 4);
 * noteNames(spellLine([{ pitch: 71, startBeat: 0, durationBeat: 1 }], timeline, majorKey(0)));
 * // ['Cb5']
 * ```
 * @category Arrangement & Analysis
 */
export function spellLine(
  notes: readonly NoteEvent[],
  timeline: ChordTimeline | null,
  key: KeyLike,
  opts: SpellLineOptions = {},
): Note[] {
  // Read whole rather than reduced: a line in Ab minor is written on flats, and
  // a key handed in spelled that way would otherwise have its spelling derived
  // back from the pitch classes and come out in G# minor.
  const resolved = resolveKey(key);
  const scale = resolved.scale;
  const given = opts.tonic === undefined ? undefined : toNoteData(opts.tonic);
  assertNoteEvents(notes, 'line notes', {
    allowNonPositiveDuration: true,
    budget: opts.budget,
  });
  // The dynamic program compares every spelling of a note with every spelling
  // of the one before it, so the work is bounded before any of it is done.
  assertGenerationBudget(
    notes.length * SPELLINGS_PER_PITCH * SPELLINGS_PER_PITCH,
    'line spelling states',
    opts.budget,
  );
  if (given !== undefined) {
    assertTonicOf(given, scale, 'spellLine');
  }
  if (notes.length === 0) {
    return [];
  }
  const tonic = given ?? resolved.tonic;
  const states = notes.map((note) =>
    stateFor(note.pitch, timeline?.at(note.startBeat) ?? null, tonic, scale),
  );

  // Viterbi across the line: `costs` holds the cheapest path reaching each
  // spelling of the current note, and `back` remembers which spelling of the
  // previous note that path came through.
  let costs: number[] = [];
  let previous: LineState | undefined;
  const back: number[][] = [];
  for (const current of states) {
    if (previous === undefined) {
      costs = [...current.emissions];
      back.push(current.candidates.map(() => 0));
      previous = current;
      continue;
    }
    const reached: number[] = [];
    const chosen: number[] = [];
    for (const [target, candidate] of current.candidates.entries()) {
      let best = Number.POSITIVE_INFINITY;
      let bestSource = 0;
      for (const [source, sourceNote] of previous.candidates.entries()) {
        const total =
          (costs[source] ?? Number.POSITIVE_INFINITY) +
          transitionCost(previous, sourceNote, current, candidate);
        if (total < best) {
          best = total;
          bestSource = source;
        }
      }
      reached.push(best + (current.emissions[target] ?? 0));
      chosen.push(bestSource);
    }
    costs = reached;
    back.push(chosen);
    previous = current;
  }

  let cursor = 0;
  for (const [index, cost] of costs.entries()) {
    if (cost < (costs[cursor] ?? Number.POSITIVE_INFINITY)) {
      cursor = index;
    }
  }
  const picked: number[] = new Array(states.length).fill(0);
  for (let index = states.length - 1; index >= 0; index -= 1) {
    picked[index] = cursor;
    cursor = back[index]?.[cursor] ?? 0;
  }
  return states.map((state, index) => state.candidates[picked[index] ?? 0] ?? state.reference);
}
