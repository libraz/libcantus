/**
 * Species counterpoint: mark a two-voice exercise against the sixteenth-century
 * rules.
 *
 * This is the conservatory exercise, not a general style checker. It grades a
 * counterpoint written above or below a given cantus firmus in one of the five
 * species, and reports what it finds as the same {@link PartWritingViolation}
 * the four-part checker uses.
 *
 * Both voices arrive as spelled notes, because half of what the rules forbid is
 * invisible in a pitch: the augmented second of the harmonic minor is a minor
 * third by ear, and the diminished fourth that may not stand as a consonance is
 * a major third by ear.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import { ConsonanceClass } from '../../core/interval/index.js';
import { BEAT_EPS } from '../../core/meter/index.js';
import type { Note, SpelledInterval } from '../../core/pitch/index.js';
import {
  noteToMidi,
  noteToPitchClass,
  pitchClassOf,
  spelledInterval,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { describeRejected } from '../../core/validation/index.js';
import {
  classifySpelledInterval,
  createsBattuta,
  createsHiddenParallelPerfect,
  createsParallelPerfect,
  createsVoiceCrossing,
  isAugmentedMelodicInterval,
  isForbiddenMelodicLeap,
} from '../counterpoint/index.js';
import { simpleIntervalNumber } from '../counterpoint/internal.js';
import { type KeyLike, toKeyScale } from '../scale/index.js';
import type { PartWritingViolation } from './index.js';
import { intervalWord, violation } from './internal.js';

/**
 * Which species an exercise is written in: note against note, two, three or
 * four notes against one, suspensions, or the florid mixture of them all.
 *
 * @category Voicing & Counterpoint
 */
export type Species = 1 | 2 | 3 | 4 | 5;

/**
 * Options controlling {@link checkSpecies}.
 *
 * @category Voicing & Counterpoint
 */
export type SpeciesOptions = {
  /**
   * Length of each counterpoint note, measured in cantus-firmus notes: 1 is a
   * whole note filling a measure, 0.5 a half, 0.25 a quarter.
   *
   * The first four species have a fixed ratio, so the durations are implied by
   * the note count and this is only needed to describe something unusual. The
   * fifth species mixes note values by definition and cannot be read without it.
   */
  durations?: readonly number[];
  /**
   * Which side of the cantus firmus the counterpoint is written on. Defaults to
   * whichever side it actually lies on, by mean pitch.
   */
  counterpointAbove?: boolean;
};

/** Notes of counterpoint per cantus-firmus note, by species. */
const SPECIES_RATIO: Readonly<Record<Species, number>> = { 1: 1, 2: 2, 3: 4, 4: 2, 5: 0 };

/** The species there are, read from the ratio table rather than listed twice. */
const SPECIES_NUMBERS: readonly number[] = Object.keys(SPECIES_RATIO).map(Number);

/** The smallest note value the fifth species may write, in cantus-firmus notes. */
const MIN_FLORID_VALUE = 0.125;

/**
 * One counterpoint note against one cantus-firmus note. A note that is still
 * sounding when the next cantus-firmus note is struck meets both of them, and
 * so has one entry per measure it sounds in: the first struck, the rest held.
 */
type Entry = {
  /** The counterpoint note itself. */
  note: Note;
  /** Its index in the counterpoint array. */
  index: number;
  /** Where this stretch of it begins, in cantus-firmus notes from the start. */
  onset: number;
  /** How long it goes on sounding from there, in cantus-firmus notes. */
  duration: number;
  /**
   * Whether the note is sounding on from an earlier attack rather than being
   * struck here — a ligature carried across the bar line. What it forms against
   * the new measure is judged as any other interval is; the melodic rules read
   * the attacks alone, since nothing was sung twice.
   */
  held: boolean;
  /** The cantus-firmus note sounding under it. */
  against: Note;
  /** Index of that cantus-firmus note. */
  againstIndex: number;
  /** Whether the note falls on the downbeat of its measure. */
  downbeat: boolean;
  /** The interval between the two voices, read from the lower note upward. */
  interval: SpelledInterval;
  /** How that interval sounds in two-voice counterpoint. */
  consonance: ConsonanceClass;
};

/** Mean sounding pitch of a line, for deciding which voice lies above. */
function meanPitch(notes: readonly Note[]): number {
  if (notes.length === 0) {
    return 0;
  }
  return notes.reduce((sum, note) => sum + noteToMidi(note), 0) / notes.length;
}

/**
 * Note lengths implied by the species when the caller gives none.
 *
 * Every measure but the last carries the species' full ratio; whatever notes
 * are left share the closing measure, which lets an exercise end on the single
 * whole note convention asks for without being described note by note.
 */
function impliedDurations(count: number, measures: number, ratio: number): number[] {
  const full = ratio * Math.max(measures - 1, 0);
  const closing = Math.max(count - full, 1);
  return Array.from({ length: count }, (_, index) => (index < full ? 1 / ratio : 1 / closing));
}

/** Whether a melodic interval is a diatonic step. */
function isStep(interval: SpelledInterval): boolean {
  return interval.number === 2;
}

/** The direction a melodic interval moves: 1 up, -1 down, 0 for a repetition. */
function direction(interval: SpelledInterval): number {
  return Math.sign(interval.semitones);
}

/** Whether two spelled notes are the same note, so a tie joins them. */
function sameNote(a: Note, b: Note): boolean {
  return a.letter === b.letter && a.alter === b.alter && a.octave === b.octave;
}

/**
 * Whether a dissonance is passed through: approached and left by step in one
 * direction (a passing note) or by step and back (a neighbour note).
 *
 * The two are not licensed by the same species. A passing dissonance fills the
 * step between two consonances and every moving species writes one; a neighbour
 * turns back on the note it left, which belongs to the quarter-note line of the
 * third and fifth species. The second species moves a note against each half of
 * the measure and the only dissonance it may write is the passing one, so the
 * neighbour is read there as the dissonance it is.
 */
function isPassedThrough(entries: readonly Entry[], position: number, species: Species): boolean {
  const previous = entries[position - 1];
  const current = entries[position];
  const next = entries[position + 1];
  if (previous === undefined || current === undefined || next === undefined) {
    return false;
  }
  const incoming = spelledInterval(previous.note, current.note);
  const outgoing = spelledInterval(current.note, next.note);
  if (!isStep(incoming) || !isStep(outgoing)) {
    return false;
  }
  if (direction(incoming) === direction(outgoing)) {
    return true;
  }
  return sameNote(previous.note, next.note) && (species === 3 || species === 5);
}

/** Whether a melodic interval leaps a third, the only leap the figures write. */
function isThird(interval: SpelledInterval): boolean {
  return interval.number === 3;
}

/** The four notes of a figure, starting at one position, if the line has them. */
function figureAt(
  entries: readonly Entry[],
  start: number,
): [Entry, Entry, Entry, Entry] | undefined {
  const first = entries[start];
  const second = entries[start + 1];
  const third = entries[start + 2];
  const fourth = entries[start + 3];
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    return undefined;
  }
  return [first, second, third, fourth];
}

/**
 * Whether four notes spell the *nota cambiata*: a consonance, a dissonance
 * stepped down onto, a leap of a third down onto a consonance, and a step back
 * up.
 *
 * Fux grants the figure by name. The dissonance is quitted by leap, which every
 * other licence forbids, and the ear hears the note leapt to as the resolution
 * the step would have reached.
 */
function isCambiata(entries: readonly Entry[], start: number): boolean {
  const figure = figureAt(entries, start);
  if (figure === undefined) {
    return false;
  }
  const [first, second, third, fourth] = figure;
  if (
    first.consonance === ConsonanceClass.Dissonance ||
    third.consonance === ConsonanceClass.Dissonance
  ) {
    return false;
  }
  const approach = spelledInterval(first.note, second.note);
  const leap = spelledInterval(second.note, third.note);
  const answer = spelledInterval(third.note, fourth.note);
  return (
    isStep(approach) &&
    direction(approach) < 0 &&
    isThird(leap) &&
    direction(leap) < 0 &&
    isStep(answer) &&
    direction(answer) > 0
  );
}

/**
 * Whether four notes spell the double neighbour: a step to one side of a note,
 * a leap of a third across to the other side, and a step back to the note the
 * figure left.
 *
 * Both notes in the middle decorate the same consonance, so either of them may
 * be the dissonance even though the figure moves between them by leap.
 */
function isDoubleNeighbour(entries: readonly Entry[], start: number): boolean {
  const figure = figureAt(entries, start);
  if (figure === undefined) {
    return false;
  }
  const [first, second, third, fourth] = figure;
  if (first.consonance === ConsonanceClass.Dissonance || !sameNote(first.note, fourth.note)) {
    return false;
  }
  const away = spelledInterval(first.note, second.note);
  const across = spelledInterval(second.note, third.note);
  const back = spelledInterval(third.note, fourth.note);
  return (
    isStep(away) &&
    isThird(across) &&
    isStep(back) &&
    direction(away) !== 0 &&
    direction(across) === -direction(away)
  );
}

/**
 * Whether a dissonance stands inside one of the figures that quit a dissonance
 * by leap: the *nota cambiata* or the double neighbour.
 *
 * Both belong to the quarter-note line, so they are read in the third and fifth
 * species only. The second species moves a note against each half of the
 * measure and writes neither.
 */
function isFiguredDissonance(
  entries: readonly Entry[],
  position: number,
  species: Species,
): boolean {
  if (species !== 3 && species !== 5) {
    return false;
  }
  return (
    isCambiata(entries, position - 1) ||
    isDoubleNeighbour(entries, position - 1) ||
    isDoubleNeighbour(entries, position - 2)
  );
}

/** Where a species allows a dissonance to fall. */
type DissonanceLicence = 'none' | 'passing' | 'suspension';

/** The licence a species grants at one metric position. */
function licenceFor(species: Species, downbeat: boolean): DissonanceLicence {
  if (species === 1) {
    return 'none';
  }
  if (species === 4) {
    return downbeat ? 'suspension' : 'none';
  }
  if (species === 5) {
    return downbeat ? 'suspension' : 'passing';
  }
  return downbeat ? 'none' : 'passing';
}

/**
 * The rules judged on one counterpoint note: the vertical interval it forms,
 * and whether the voices have crossed.
 */
function verticalViolations(
  entries: readonly Entry[],
  position: number,
  species: Species,
  counterpointAbove: boolean,
): PartWritingViolation[] {
  const entry = entries[position];
  if (entry === undefined) {
    return [];
  }
  const found: PartWritingViolation[] = [];
  const upper = counterpointAbove ? entry.note : entry.against;
  const lower = counterpointAbove ? entry.against : entry.note;
  if (createsVoiceCrossing(upper, lower)) {
    found.push(
      violation(
        'voiceCrossing',
        [0, 1],
        entry.index,
        entry.index,
        'The counterpoint crosses to the wrong side of the cantus firmus',
      ),
    );
  }
  if (entry.consonance !== ConsonanceClass.Dissonance) {
    return found;
  }
  const licence = licenceFor(species, entry.downbeat);
  if (
    licence === 'passing' &&
    (isPassedThrough(entries, position, species) || isFiguredDissonance(entries, position, species))
  ) {
    return found;
  }
  if (licence === 'suspension') {
    found.push(...suspensionViolations(entries, position));
    return found;
  }
  found.push(
    violation(
      'unpreparedDissonance',
      [0, 1],
      entry.index,
      entry.index,
      licence === 'none'
        ? `A ${entry.interval.quality}${entry.interval.number} falls where this species allows only a consonance`
        : 'The dissonance is not passed through by step',
    ),
  );
  return found;
}

/**
 * The rules judged on a dissonant downbeat where the species writes
 * suspensions: it must be tied over from a consonance and fall by step onto the
 * next note.
 */
function suspensionViolations(entries: readonly Entry[], position: number): PartWritingViolation[] {
  const entry = entries[position];
  if (entry === undefined) {
    return [];
  }
  const previous = entries[position - 1];
  const next = entries[position + 1];
  const prepared =
    previous !== undefined &&
    sameNote(previous.note, entry.note) &&
    previous.consonance !== ConsonanceClass.Dissonance;
  if (!prepared) {
    return [
      violation(
        'unpreparedDissonance',
        [0, 1],
        entry.index,
        entry.index,
        'The suspended dissonance is not tied over from a consonance',
      ),
    ];
  }
  const resolution = next === undefined ? undefined : spelledInterval(entry.note, next.note);
  if (
    next === undefined ||
    resolution === undefined ||
    !isStep(resolution) ||
    direction(resolution) >= 0
  ) {
    return [
      violation(
        'unresolvedSuspension',
        [0, 1],
        entry.index,
        next === undefined ? entry.index : next.index,
        'The suspension does not fall by step onto its resolution',
      ),
    ];
  }
  // The step down is only half of the resolution: what it falls onto has to be
  // the consonance the ear was waiting for. A suspension resolving to another
  // dissonance is reported here, on the suspension itself, rather than left to
  // whatever the note it lands on is charged with — in the fifth species that
  // note may be excused as a passing dissonance and nothing would be said at all.
  if (next.consonance === ConsonanceClass.Dissonance) {
    return [
      violation(
        'unresolvedSuspension',
        [0, 1],
        entry.index,
        next.index,
        `The suspension falls onto a ${next.interval.quality}${next.interval.number}, which is no resolution`,
      ),
    ];
  }
  return [];
}

/** The rules judged along the counterpoint line itself. */
function melodicViolations(from: Entry, to: Entry): PartWritingViolation[] {
  const interval = spelledInterval(from.note, to.note);
  if (isAugmentedMelodicInterval(from.note, to.note)) {
    return [
      violation(
        'augmentedMelodicInterval',
        [1],
        from.index,
        to.index,
        `The counterpoint moves by an augmented ${intervalWord(interval.number)}`,
      ),
    ];
  }
  if (isForbiddenMelodicLeap(from.note, to.note)) {
    return [
      violation(
        'illegalLeap',
        [1],
        from.index,
        to.index,
        `The counterpoint leaps by a ${interval.quality}${interval.number}`,
      ),
    ];
  }
  return [];
}

/** How many leaps in a row may carry the line the same way. */
const MAX_LEAPS_IN_ONE_DIRECTION = 2;

/** How far leaps in one direction may carry the line in total, in semitones. */
const MAX_LEAP_CHAIN_SPAN = 12;

/** The smallest leap that must be answered by a step the other way. */
const LEAP_NEEDING_ANSWER = 6;

/** The tritone, in semitones, whichever way it is spelled. */
const TRITONE_SEMITONES = 6;

/** One melodic move of the counterpoint, as the shape rules read it. */
type Move = {
  /** The note moved from. */
  from: Entry;
  /** The note moved to. */
  to: Entry;
  /** The interval between them. */
  interval: SpelledInterval;
};

/** Whether a melodic interval leaps rather than steps or repeats the note. */
function isLeap(interval: SpelledInterval): boolean {
  return interval.number > 2;
}

/** Every move of the counterpoint, in order. */
function melodicMoves(entries: readonly Entry[]): Move[] {
  const moves: Move[] = [];
  for (let position = 1; position < entries.length; position += 1) {
    const from = entries[position - 1];
    const to = entries[position];
    if (from === undefined || to === undefined) {
      continue;
    }
    moves.push({ from, to, interval: spelledInterval(from.note, to.note) });
  }
  return moves;
}

/**
 * The one high point: the line reaches its highest note once and does not
 * return to it.
 *
 * A note repeated in place is one arrival, and the closing note is left out of
 * the comparison — where the counterpoint ends is fixed by the cadence rather
 * than by the shape of the line, so a line that climbs to its final is not
 * charged with reaching its peak twice.
 */
function climaxViolations(entries: readonly Entry[]): PartWritingViolation[] {
  const body = entries.slice(0, -1);
  const peak = body.reduce(
    (high, entry) => Math.max(high, noteToMidi(entry.note)),
    Number.NEGATIVE_INFINITY,
  );
  const arrivals = body.filter((entry, position) => {
    const previous = body[position - 1];
    return (
      noteToMidi(entry.note) === peak &&
      (previous === undefined || noteToMidi(previous.note) !== peak)
    );
  });
  const first = arrivals[0];
  const second = arrivals[1];
  if (first === undefined || second === undefined) {
    return [];
  }
  return [
    violation(
      'melodicShape',
      [1],
      first.index,
      second.index,
      'The line reaches its highest note more than once, so it has no one climax',
    ),
  ];
}

/**
 * Leaps taken one after another the same way: two at most, spanning an octave
 * at most, so that a chain of leaps still outlines a chord the ear can follow.
 */
function leapChainViolations(moves: readonly Move[]): PartWritingViolation[] {
  const found: PartWritingViolation[] = [];
  let run: Move[] = [];
  const close = (): void => {
    const first = run[0];
    const last = run[run.length - 1];
    const span = run.reduce((total, move) => total + Math.abs(move.interval.semitones), 0);
    if (first !== undefined && last !== undefined) {
      if (run.length > MAX_LEAPS_IN_ONE_DIRECTION) {
        found.push(
          violation(
            'melodicShape',
            [1],
            first.from.index,
            last.to.index,
            `The counterpoint leaps ${run.length} times in a row in the same direction`,
          ),
        );
      } else if (run.length > 1 && span > MAX_LEAP_CHAIN_SPAN) {
        found.push(
          violation(
            'melodicShape',
            [1],
            first.from.index,
            last.to.index,
            'Two leaps in the same direction carry the line further than an octave',
          ),
        );
      }
    }
    run = [];
  };
  for (const move of moves) {
    if (!isLeap(move.interval)) {
      close();
      continue;
    }
    const previous = run[run.length - 1];
    if (previous !== undefined && direction(previous.interval) !== direction(move.interval)) {
      close();
    }
    run.push(move);
  }
  close();
  return found;
}

/**
 * A wide leap is answered by a step the other way, which fills the gap it tore
 * open. Thirds, fourths and fifths are free to carry on: the wider the leap,
 * the stronger the style asks for the turn, and it asks outright from the sixth
 * upward.
 */
function leapAnswerViolations(moves: readonly Move[]): PartWritingViolation[] {
  const found: PartWritingViolation[] = [];
  for (let position = 0; position < moves.length; position += 1) {
    const leap = moves[position];
    const answer = moves[position + 1];
    if (leap === undefined || answer === undefined || leap.interval.number < LEAP_NEEDING_ANSWER) {
      continue;
    }
    if (isStep(answer.interval) && direction(answer.interval) === -direction(leap.interval)) {
      continue;
    }
    const word = intervalWord(leap.interval.number);
    found.push(
      violation(
        'melodicShape',
        [1],
        leap.from.index,
        answer.to.index,
        `The leap of ${word === 'octave' ? 'an' : 'a'} ${word} is not answered by a step the other way`,
      ),
    );
  }
  return found;
}

/**
 * The tritone the line may not leap is also the tritone it may not draw: a run
 * of notes moving one way, however it is filled in, may not turn around on the
 * interval between its own extremes.
 *
 * A repeated note does not end the run, and a run of a single interval is left
 * to the leap rule, which already forbids it.
 */
function tritoneOutlineViolations(entries: readonly Entry[]): PartWritingViolation[] {
  const found: PartWritingViolation[] = [];
  let run: Move[] = [];
  const close = (): void => {
    const first = run[0];
    const last = run[run.length - 1];
    if (first !== undefined && last !== undefined && run.length > 1) {
      const outline = spelledInterval(first.from.note, last.to.note);
      if (Math.abs(outline.semitones) === TRITONE_SEMITONES) {
        found.push(
          violation(
            'melodicShape',
            [1],
            first.from.index,
            last.to.index,
            'The line turns around on a tritone, outlining the interval it may not leap',
          ),
        );
      }
    }
    run = [];
  };
  for (const move of melodicMoves(entries)) {
    if (direction(move.interval) === 0) {
      continue;
    }
    const previous = run[run.length - 1];
    if (previous !== undefined && direction(previous.interval) !== direction(move.interval)) {
      close();
    }
    run.push(move);
  }
  close();
  return found;
}

/**
 * The moving species do not repeat a note: the second and third species are
 * written to keep the line going, and the repetition that carries a fourth or
 * fifth species phrase is a tie rather than a second attack.
 *
 * The closing measure is exempt. An exercise that writes its final measure in
 * the species' own note values rather than as the single whole note convention
 * asks for is holding the final, not attacking it again.
 */
function repeatedNoteViolations(
  moves: readonly Move[],
  closingMeasure: number,
): PartWritingViolation[] {
  return moves
    .filter(
      (move) => sameNote(move.from.note, move.to.note) && move.from.againstIndex < closingMeasure,
    )
    .map((move) =>
      violation(
        'melodicShape',
        [1],
        move.from.index,
        move.to.index,
        'The counterpoint repeats a note where this species keeps the line moving',
      ),
    );
}

/**
 * The rules judged on the shape of the counterpoint rather than on any one of
 * its intervals: the single climax, the chain of leaps and the step that
 * answers a wide one, the tritone outlined between turning points, and the
 * repeated note the moving species do not write.
 *
 * These belong to the species exercise, whose whole subject is the line. The
 * four-part exercise is judged chord by chord and lets a voice leap where the
 * harmony asks, so {@link checkPartWriting} does not apply them.
 */
function melodicShapeViolations(
  entries: readonly Entry[],
  species: Species,
): PartWritingViolation[] {
  const moves = melodicMoves(entries);
  const closingMeasure = entries[entries.length - 1]?.againstIndex ?? 0;
  const found = [
    ...climaxViolations(entries),
    ...leapChainViolations(moves),
    ...leapAnswerViolations(moves),
    ...tritoneOutlineViolations(entries),
    ...(species === 2 || species === 3 ? repeatedNoteViolations(moves, closingMeasure) : []),
  ];
  return found.sort((left, right) => left.fromIndex - right.fromIndex);
}

/**
 * The violations in the order the exercise commits them: by the note the fault
 * starts on, then by the note it ends on.
 *
 * The rules are accumulated rule by rule, since each reads the line its own way,
 * but a marked exercise is read from the top — so they are put back into time
 * order before they are handed out. The sort is stable, so two faults on the
 * same note keep the order the rules found them in and the same exercise always
 * marks the same way.
 */
function inTimeOrder(violations: readonly PartWritingViolation[]): PartWritingViolation[] {
  return [...violations].sort(
    (left, right) => left.fromIndex - right.fromIndex || left.toIndex - right.toIndex,
  );
}

/** The rules judged between two voices moving together. */
function motionViolations(
  from: Entry,
  to: Entry,
  counterpointAbove: boolean,
): PartWritingViolation[] {
  const found: PartWritingViolation[] = [];
  const upperPrev = counterpointAbove ? from.note : from.against;
  const upperCur = counterpointAbove ? to.note : to.against;
  const lowerPrev = counterpointAbove ? from.against : from.note;
  const lowerCur = counterpointAbove ? to.against : to.note;
  if (createsParallelPerfect(upperPrev, upperCur, lowerPrev, lowerCur)) {
    const fifth = simpleIntervalNumber(to.interval.number) === 5;
    found.push(
      violation(
        fifth ? 'parallelFifth' : 'parallelOctave',
        [0, 1],
        from.index,
        to.index,
        fifth
          ? 'The two voices move into consecutive perfect fifths'
          : 'The two voices move into consecutive perfect octaves',
      ),
    );
  }
  // Two voices and nothing between them: the sixteenth-century rule forbids the
  // arrival however the upper voice reached it, so the step exception the
  // four-part chorale grants its outer voices is not applied here.
  if (createsHiddenParallelPerfect(upperPrev, upperCur, lowerPrev, lowerCur, 'twoVoice')) {
    found.push(
      violation(
        'hiddenPerfect',
        [0, 1],
        from.index,
        to.index,
        'The voices move into a perfect interval by similar motion',
      ),
    );
  }
  if (createsBattuta(upperPrev, upperCur, lowerPrev, lowerCur)) {
    found.push(
      violation(
        'battuta',
        [0, 1],
        from.index,
        to.index,
        'The upper voice leaps down into an octave against the lower voice',
      ),
    );
  }
  return found;
}

/**
 * The last counterpoint note sounding against an earlier cantus-firmus note
 * than the given one.
 *
 * The closing formula is a motion from one measure into the next, so it is read
 * by measure rather than by position in the array. A closing measure written in
 * the species' own note values holds more than one counterpoint note, and the
 * note before the last one then lies inside the final measure, which would
 * judge the cadence against itself.
 */
function lastEntryBefore(entries: readonly Entry[], againstIndex: number): Entry | undefined {
  for (let position = entries.length - 1; position >= 0; position -= 1) {
    const entry = entries[position];
    if (entry !== undefined && entry.againstIndex < againstIndex) {
      return entry;
    }
  }
  return undefined;
}

/**
 * The opening and closing formulas.
 *
 * An exercise begins on a perfect consonance and ends on the octave or unison,
 * approached by step in the counterpoint from the major sixth above the cantus
 * firmus, or the minor third below it — the sixth or third that carries the
 * leading tone.
 */
function cadenceViolations(
  entries: readonly Entry[],
  mode: KeyScale,
  counterpointAbove: boolean,
): PartWritingViolation[] {
  const found: PartWritingViolation[] = [];
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (first === undefined || last === undefined) {
    return found;
  }
  if (classifySpelledInterval(first.interval) !== ConsonanceClass.PerfectConsonance) {
    found.push(
      violation(
        'missingCadence',
        [0, 1],
        first.index,
        first.index,
        'The exercise does not begin on a perfect consonance',
      ),
    );
  }
  if (noteToPitchClass(last.note) !== pitchClassOf(mode.rootPc)) {
    found.push(
      violation(
        'missingCadence',
        [0, 1],
        last.index,
        last.index,
        'The counterpoint does not close on the final of the mode',
      ),
    );
  }
  const closing = last.interval;
  if (closing.quality !== 'P' || simpleIntervalNumber(closing.number) !== 1) {
    found.push(
      violation(
        'missingCadence',
        [0, 1],
        last.index,
        last.index,
        'The exercise does not close on an octave or unison',
      ),
    );
    return found;
  }
  const penultimate = lastEntryBefore(entries, last.againstIndex);
  if (penultimate === undefined) {
    return found;
  }
  const arrival = entries.find((entry) => entry.againstIndex === last.againstIndex) ?? last;
  const approach = spelledInterval(penultimate.note, arrival.note);
  const expected = counterpointAbove ? { quality: 'M', number: 6 } : { quality: 'm', number: 3 };
  if (
    penultimate.interval.quality !== expected.quality ||
    simpleIntervalNumber(penultimate.interval.number) !== expected.number ||
    !isStep(approach)
  ) {
    found.push(
      violation(
        'missingCadence',
        [0, 1],
        penultimate.index,
        arrival.index,
        counterpointAbove
          ? 'The close is not the major sixth stepping out to the octave'
          : 'The close is not the minor third stepping in to the unison',
      ),
    );
  }
  return found;
}

/** The note lengths to read the exercise by, or the reason they cannot be read. */
function resolveDurations(
  counterpoint: readonly Note[],
  measures: number,
  species: Species,
  opts: SpeciesOptions | undefined,
): { durations: number[] } | { problem: string } {
  const given = opts?.durations;
  if (given !== undefined) {
    if (given.length !== counterpoint.length) {
      return {
        problem: `The exercise gives ${given.length} durations for ${counterpoint.length} notes`,
      };
    }
    for (const duration of given) {
      const units = duration / MIN_FLORID_VALUE;
      if (!(duration > 0) || duration > 1 || Math.abs(units - Math.round(units)) > BEAT_EPS) {
        return {
          problem: `A note lasts ${duration} of a measure, which this style does not write`,
        };
      }
    }
    const total = given.reduce((sum, duration) => sum + duration, 0);
    if (Math.abs(total - measures) > BEAT_EPS) {
      return { problem: `The counterpoint fills ${total} of the ${measures} measures` };
    }
    return { durations: [...given] };
  }
  if (species === 5) {
    throw new InvalidInputError(
      'checkSpecies needs durations for the fifth species, whose note values are not fixed',
    );
  }
  const ratio = SPECIES_RATIO[species];
  const full = ratio * measures;
  // A closing measure written as one whole note is the convention rather than
  // an exception, so both note counts read as the correct ratio.
  if (counterpoint.length !== full && counterpoint.length !== full - ratio + 1) {
    return {
      problem: `Species ${species} sets ${ratio} notes against each of the ${measures} cantus firmus notes, and the counterpoint has ${counterpoint.length}`,
    };
  }
  return { durations: impliedDurations(counterpoint.length, measures, ratio) };
}

/**
 * Place every counterpoint note against the cantus-firmus notes it sounds with.
 *
 * A note is measured against each cantus-firmus note struck while it is still
 * sounding, not only the one it was struck over: the syncopation that defines
 * the fourth and fifth species holds a note across the bar line, and the
 * interval it forms in the measure it arrives in is the whole point of the
 * figure. Leaving it unread would let a bare dissonance on a downbeat pass for
 * a clean exercise.
 */
function buildEntries(
  cantusFirmus: readonly Note[],
  counterpoint: readonly Note[],
  durations: readonly number[],
  counterpointAbove: boolean,
): Entry[] {
  const entries: Entry[] = [];
  let onset = 0;
  for (let index = 0; index < counterpoint.length; index += 1) {
    const note = counterpoint[index];
    const duration = durations[index] ?? 0;
    if (note === undefined) {
      continue;
    }
    const struckOver = Math.min(Math.floor(onset + BEAT_EPS), cantusFirmus.length - 1);
    const lastOver = Math.min(
      Math.max(Math.ceil(onset + duration - BEAT_EPS) - 1, struckOver),
      cantusFirmus.length - 1,
    );
    for (let againstIndex = struckOver; againstIndex <= lastOver; againstIndex += 1) {
      const against = cantusFirmus[againstIndex];
      if (against === undefined) {
        continue;
      }
      const held = againstIndex > struckOver;
      // A held stretch begins where the measure does; the first begins wherever
      // the note was struck, which is what makes it a weak-beat note or not.
      const begins = held ? againstIndex : onset;
      const interval = counterpointAbove
        ? spelledInterval(against, note)
        : spelledInterval(note, against);
      entries.push({
        note,
        index,
        onset: begins,
        duration: onset + duration - begins,
        held,
        against,
        againstIndex,
        downbeat: Math.abs(begins - Math.round(begins)) < BEAT_EPS,
        interval,
        consonance: classifySpelledInterval(interval),
      });
    }
    onset += duration;
  }
  return entries;
}

/**
 * The pairs of counterpoint notes the motion rules are judged over: the
 * successive attacks that cross a bar line. It is given the notes actually
 * struck, since a note held on across the bar line is not a motion at all.
 *
 * Two counterpoint notes over one unmoving cantus-firmus note are oblique
 * motion, which no parallel rule can touch, so the pairs that can break a rule
 * are the ones where the lower voice has moved too. Perfect intervals on two
 * successive downbeats with other notes in between are deliberately not judged
 * here: whether the intervening note excuses them is exactly what the sources
 * disagree about, and the fourth species is built on the ligature that does.
 */
function motionPairs(entries: readonly Entry[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let position = 1; position < entries.length; position += 1) {
    const previous = entries[position - 1];
    const current = entries[position];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (previous.againstIndex !== current.againstIndex) {
      pairs.push([position - 1, position]);
    }
  }
  return pairs;
}

/**
 * Check a species counterpoint exercise and report every rule it breaks.
 *
 * The cantus firmus is one note per measure. The counterpoint is aligned to it
 * by position rather than by written rhythm: the first four species have a fixed
 * number of notes per measure, so the note count alone says where each note
 * falls, and a closing measure written as a single whole note is accepted as the
 * convention it is. The fifth species mixes note values and therefore needs
 * `opts.durations`, given in cantus-firmus notes.
 *
 * Judged are the vertical intervals under each species' dissonance licence
 * (none in the first, a passing dissonance on the weak half in the second and
 * third, a prepared suspension on the downbeat in the fourth, both in the
 * fifth; the neighbour that turns back on its own note belongs to the
 * quarter-note line of the third and fifth species, which also write the *nota
 * cambiata* and the double neighbour, quitting a dissonance by leap). A note
 * still sounding when the next cantus-firmus note is struck is judged against
 * that note too, so a ligature carried across the bar line is read where it
 * lands as well as where it began. Judged besides are parallel and hidden
 * perfects and the *battuta* between the voices, augmented and otherwise
 * forbidden leaps along the counterpoint, the shape of the counterpoint as a
 * line, and the opening and closing formulas. Violations name the cantus firmus
 * as voice 0 and the counterpoint as voice 1, and index into the counterpoint.
 *
 * @param cantusFirmus The given voice, one spelled note per measure.
 * @param counterpoint The written voice, in spelled notes.
 * @param species Which species the exercise is written in.
 * @param mode The mode the exercise is in.
 * @param opts Note lengths, and which side the counterpoint is written on.
 * @returns Every violation found, in the order the exercise commits them; an
 *   empty array for a clean exercise.
 * @throws If the species is not one of the five, either voice is empty, a note
 *   carries no octave, or the fifth species is given without durations.
 * @example
 * ```ts
 * import { checkSpecies, majorKey, parseNote } from '@libraz/libcantus';
 * const cf = ['C4', 'D4', 'E4', 'D4', 'C4'].map((n) => parseNote(n));
 * const cp = ['C5', 'A4', 'G4', 'B4', 'C5'].map((n) => parseNote(n));
 * checkSpecies(cf, cp, 1, majorKey(0)); // [] — a clean first-species exercise
 * ```
 * @category Voicing & Counterpoint
 */
export function checkSpecies(
  cantusFirmus: readonly Note[],
  counterpoint: readonly Note[],
  species: Species,
  modeLike: KeyLike,
  opts?: SpeciesOptions,
): PartWritingViolation[] {
  const mode = toKeyScale(modeLike);
  if (!SPECIES_NUMBERS.includes(species)) {
    throw new InvalidInputError(
      `species must be one of ${SPECIES_NUMBERS.join(', ')}; received ${describeRejected(species)}`,
    );
  }
  if (cantusFirmus.length === 0 || counterpoint.length === 0) {
    throw new InvalidInputError('checkSpecies needs both a cantus firmus and a counterpoint');
  }
  const resolved = resolveDurations(counterpoint, cantusFirmus.length, species, opts);
  if ('problem' in resolved) {
    return inTimeOrder([
      violation('wrongRhythmicRatio', [1], 0, counterpoint.length - 1, resolved.problem),
    ]);
  }
  const counterpointAbove =
    opts?.counterpointAbove ?? meanPitch(counterpoint) >= meanPitch(cantusFirmus);
  const entries = buildEntries(cantusFirmus, counterpoint, resolved.durations, counterpointAbove);
  // Every interval the exercise sounds is judged, including the ones a held
  // note forms in the measure it is carried into. The line itself is read from
  // the attacks alone: a note going on sounding was not sung a second time, and
  // the motion the voices make across a bar line is the one from the note
  // struck before it to the note struck after.
  const struck = entries.filter((entry) => !entry.held);

  const violations: PartWritingViolation[] = [];
  for (let position = 0; position < entries.length; position += 1) {
    violations.push(...verticalViolations(entries, position, species, counterpointAbove));
  }
  for (let position = 1; position < struck.length; position += 1) {
    const previous = struck[position - 1];
    const current = struck[position];
    if (previous !== undefined && current !== undefined) {
      violations.push(...melodicViolations(previous, current));
    }
  }
  violations.push(...melodicShapeViolations(struck, species));
  for (const [from, to] of motionPairs(struck)) {
    const previous = struck[from];
    const current = struck[to];
    if (previous !== undefined && current !== undefined) {
      violations.push(...motionViolations(previous, current, counterpointAbove));
    }
  }
  violations.push(...cadenceViolations(struck, mode, counterpointAbove));
  return inTimeOrder(violations);
}
