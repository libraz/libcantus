import type { TimeSignature } from '../../core/meter/index.js';
import { metricWeight } from '../../core/meter/index.js';
import type { NoteEvent } from '../../core/types.js';
import { assertNoteEvents, assertTimeSignature } from '../../core/validation/index.js';

/**
 * What a melody note contributes to the harmony: either a structural tone the
 * chord has to account for, or the ornament figure that explains it away.
 *
 * @category Reharmonization
 */
export type MelodyToneRole =
  | 'structural'
  | 'passing'
  | 'neighbor'
  | 'appoggiatura'
  | 'suspension'
  | 'anticipation'
  | 'escape';

/**
 * One melody note's classification: its index in the classified melody, the
 * figure it forms, and whether that figure makes it ornamental.
 *
 * @category Reharmonization
 */
export type ClassifiedMelodyTone = {
  noteIndex: number;
  role: MelodyToneRole;
  /** True for every role but `'structural'`. */
  ornamental: boolean;
};

/** Maximum gap or overlap still heard as one note leading into the next. */
const ADJACENCY_TOLERANCE = 0.05;

/** Largest interval still heard as a step; anything wider is a leap. */
const STEP_SEMITONES = 2;

function isStep(a: number, b: number): boolean {
  const d = Math.abs(a - b);
  return d >= 1 && d <= STEP_SEMITONES;
}

function isLeap(a: number, b: number): boolean {
  return Math.abs(a - b) > STEP_SEMITONES;
}

/** Whether both notes move the same way, neither of them repeating a pitch. */
function sameDirection(prev: number, note: number, next: number): boolean {
  return prev !== note && next !== note && note - prev > 0 === next - note > 0;
}

/**
 * Classify a melody's ornaments from the melody and the metre alone.
 *
 * This is deliberately chord-free: a harmonizer needs to know which notes the
 * chords must explain *before* it can choose them, so nothing here may consult a
 * harmony. What remains is the melodic and metric evidence — stepwise approach
 * and departure, repeated pitches, leaps, and the relative metric weight and
 * length of a note against its neighbours.
 *
 * The figures are recognized in the order suspension, passing, neighbor,
 * anticipation, appoggiatura, escape. A note is judged ornamental only when it
 * is metrically and rhythmically subordinate to the neighbours that frame it
 * (or, for the accented figures, when it leans on a stronger beat than its
 * approach and gives way to a resolution). A note without an adjacent
 * predecessor and successor has no figure to belong to and stays structural, so
 * the first and last notes of a phrase are always structural.
 *
 * @param melody The melody, in ascending onset order.
 * @param ts Time signature used to weight metric accents.
 * @returns One classification per input note, in input order.
 * @example
 * ```ts
 * import { classifyMelodyTones } from '@libraz/libcantus';
 * const melody = [60, 62, 64, 60].map((pitch, i) => ({
 *   pitch,
 *   startBeat: i,
 *   durationBeat: 1,
 * }));
 * classifyMelodyTones(melody, { numerator: 4, denominator: 4 })[1];
 * // { noteIndex: 1, role: 'passing', ornamental: true }
 * ```
 * @category Reharmonization
 */
export function classifyMelodyTones(
  melody: readonly NoteEvent[],
  ts: TimeSignature,
): ClassifiedMelodyTone[] {
  assertNoteEvents(melody, 'melody notes', { allowNonPositiveDuration: true });
  assertTimeSignature(ts);
  return melody.map((_, index) => {
    const role = roleOfNote(melody, index, ts);
    return { noteIndex: index, role, ornamental: role !== 'structural' };
  });
}

/** Classify one note against the neighbours that immediately frame it. */
function roleOfNote(
  melody: readonly NoteEvent[],
  index: number,
  ts: TimeSignature,
): MelodyToneRole {
  const note = melody[index];
  const prev = melody[index - 1];
  const next = melody[index + 1];
  if (!note || !prev || !next) {
    return 'structural';
  }
  // A note separated from its neighbour by a rest is not led into or out of it,
  // and simultaneous onsets are cluster members rather than melodic neighbours.
  const intoNote = Math.abs(prev.startBeat + prev.durationBeat - note.startBeat);
  const outOfNote = Math.abs(note.startBeat + note.durationBeat - next.startBeat);
  if (intoNote > ADJACENCY_TOLERANCE || outOfNote > ADJACENCY_TOLERANCE) {
    return 'structural';
  }

  const weight = metricWeight(note.startBeat, ts);
  const weightPrev = metricWeight(prev.startBeat, ts);
  const weightNext = metricWeight(next.startBeat, ts);
  // Subordinate: no stronger metrically and no longer than either neighbour, so
  // the ear hears the neighbours as the frame and this note as decoration.
  const subordinate =
    weight <= weightPrev &&
    weight <= weightNext &&
    note.durationBeat <= prev.durationBeat &&
    note.durationBeat <= next.durationBeat;
  // Leaning: an accented dissonance arrives on a stronger beat than the note it
  // comes from and hands over to a weaker resolution.
  const leaning = weight > weightPrev && weight >= weightNext;

  if (
    leaning &&
    prev.pitch === note.pitch &&
    note.pitch - next.pitch >= 1 &&
    isStep(note.pitch, next.pitch)
  ) {
    return 'suspension';
  }
  if (subordinate && isStep(prev.pitch, note.pitch) && isStep(note.pitch, next.pitch)) {
    if (sameDirection(prev.pitch, note.pitch, next.pitch)) {
      return 'passing';
    }
    if (prev.pitch === next.pitch) {
      return 'neighbor';
    }
  }
  if (
    subordinate &&
    note.pitch === next.pitch &&
    note.pitch !== prev.pitch &&
    weight < weightNext
  ) {
    return 'anticipation';
  }
  if (
    leaning &&
    isLeap(prev.pitch, note.pitch) &&
    isStep(note.pitch, next.pitch) &&
    !sameDirection(prev.pitch, note.pitch, next.pitch)
  ) {
    return 'appoggiatura';
  }
  if (
    subordinate &&
    isStep(prev.pitch, note.pitch) &&
    isLeap(note.pitch, next.pitch) &&
    !sameDirection(prev.pitch, note.pitch, next.pitch)
  ) {
    return 'escape';
  }
  return 'structural';
}
