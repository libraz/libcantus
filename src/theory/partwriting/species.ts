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
import type { Note, SpelledInterval } from '../../core/pitch/index.js';
import {
  noteToMidi,
  noteToPitchClass,
  pitchClassOf,
  spelledInterval,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
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

/** Tolerance for comparing positions measured in cantus-firmus notes. */
const EPS = 1e-9;

/** Notes of counterpoint per cantus-firmus note, by species. */
const SPECIES_RATIO: Readonly<Record<Species, number>> = { 1: 1, 2: 2, 3: 4, 4: 2, 5: 0 };

/** The smallest note value the fifth species may write, in cantus-firmus notes. */
const MIN_FLORID_VALUE = 0.125;

/** One counterpoint note, placed in time against the cantus firmus. */
type Entry = {
  /** The counterpoint note itself. */
  note: Note;
  /** Its index in the counterpoint array. */
  index: number;
  /** Onset, in cantus-firmus notes from the start of the exercise. */
  onset: number;
  /** Length, in cantus-firmus notes. */
  duration: number;
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
 */
function isPassedThrough(entries: readonly Entry[], position: number): boolean {
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
  const passing = direction(incoming) === direction(outgoing);
  const neighbour = sameNote(previous.note, next.note);
  return passing || neighbour;
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
  if (licence === 'passing' && isPassedThrough(entries, position)) {
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
  if (createsHiddenParallelPerfect(upperPrev, upperCur, lowerPrev, lowerCur)) {
    found.push(
      violation(
        'hiddenPerfect',
        [0, 1],
        from.index,
        to.index,
        'The voices leap into a perfect interval by similar motion',
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
  const penultimate = entries[entries.length - 2];
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
  if (penultimate === undefined) {
    return found;
  }
  const approach = spelledInterval(penultimate.note, last.note);
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
        last.index,
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
      if (!(duration > 0) || duration > 1 || Math.abs(units - Math.round(units)) > EPS) {
        return {
          problem: `A note lasts ${duration} of a measure, which this style does not write`,
        };
      }
    }
    const total = given.reduce((sum, duration) => sum + duration, 0);
    if (Math.abs(total - measures) > EPS) {
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

/** Place every counterpoint note against the cantus-firmus note it sounds with. */
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
    const againstIndex = Math.min(Math.floor(onset + EPS), cantusFirmus.length - 1);
    const against = cantusFirmus[againstIndex];
    if (against === undefined) {
      continue;
    }
    const interval = counterpointAbove
      ? spelledInterval(against, note)
      : spelledInterval(note, against);
    entries.push({
      note,
      index,
      onset,
      duration,
      against,
      againstIndex,
      downbeat: Math.abs(onset - Math.round(onset)) < EPS,
      interval,
      consonance: classifySpelledInterval(interval),
    });
    onset += duration;
  }
  return entries;
}

/**
 * The pairs of counterpoint notes the motion rules are judged over: the
 * successive attacks that cross a bar line.
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
 * fifth), parallel and hidden perfects and the *battuta* between the voices,
 * augmented and otherwise forbidden leaps along the counterpoint, and the
 * opening and closing formulas. Violations name the cantus firmus as voice 0
 * and the counterpoint as voice 1, and index into the counterpoint.
 *
 * @param cantusFirmus The given voice, one spelled note per measure.
 * @param counterpoint The written voice, in spelled notes.
 * @param species Which species the exercise is written in.
 * @param mode The mode the exercise is in.
 * @param opts Note lengths, and which side the counterpoint is written on.
 * @returns Every violation found, in the order the exercise commits them; an
 *   empty array for a clean exercise.
 * @throws If either voice is empty, a note carries no octave, or the fifth
 *   species is given without durations.
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
  mode: KeyScale,
  opts?: SpeciesOptions,
): PartWritingViolation[] {
  if (cantusFirmus.length === 0 || counterpoint.length === 0) {
    throw new InvalidInputError('checkSpecies needs both a cantus firmus and a counterpoint');
  }
  const resolved = resolveDurations(counterpoint, cantusFirmus.length, species, opts);
  if ('problem' in resolved) {
    return [violation('wrongRhythmicRatio', [1], 0, counterpoint.length - 1, resolved.problem)];
  }
  const counterpointAbove =
    opts?.counterpointAbove ?? meanPitch(counterpoint) >= meanPitch(cantusFirmus);
  const entries = buildEntries(cantusFirmus, counterpoint, resolved.durations, counterpointAbove);

  const violations: PartWritingViolation[] = [];
  for (let position = 0; position < entries.length; position += 1) {
    violations.push(...verticalViolations(entries, position, species, counterpointAbove));
    const previous = entries[position - 1];
    const current = entries[position];
    if (previous !== undefined && current !== undefined) {
      violations.push(...melodicViolations(previous, current));
    }
  }
  for (const [from, to] of motionPairs(entries)) {
    const previous = entries[from];
    const current = entries[to];
    if (previous !== undefined && current !== undefined) {
      violations.push(...motionViolations(previous, current, counterpointAbove));
    }
  }
  violations.push(...cadenceViolations(entries, mode, counterpointAbove));
  return violations;
}
