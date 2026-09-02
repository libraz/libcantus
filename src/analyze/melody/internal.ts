/**
 * What every reading of a melody has to agree on first.
 *
 * A melody is compared, named and classified by three modules here, and all
 * three start from the same two questions: which notes sound, in what order,
 * and what the gaps between their onsets are. Answered separately they would
 * drift — one reading folding a chord to its top voice and another not — so
 * they are answered once, here.
 */

import type { NoteEvent } from '../../core/types.js';
import { assertNoteEvents } from '../../core/validation/index.js';
import { BEAT_EPS } from '../adjacency.js';
import type { MotifData } from './motifs.js';

/**
 * Grid the rhythmic profile is compared on, as a divisor of the cell's first
 * onset gap.
 *
 * Two statements of a motif have to agree on their rhythm exactly, and floating
 * beat arithmetic does not: 1/3 of a beat written two different ways differs in
 * the last bits. Rounding the ratios onto a grid this fine keeps a dotted figure
 * distinct from an even one while absorbing that error. Onsets are still
 * expected to be quantised — a humanized MIDI take should be quantised before it
 * is searched for motifs.
 */
const RHYTHM_GRID = 64;
/**
 * Anything that can be read as a melodic line: a motif, or plain note events.
 *
 * @category Arrangement & Analysis
 */
export type MelodicPhrase = MotifData | readonly NoteEvent[];
/** The notes of anything that can be read as a line. */
export function phraseNotes(phrase: MelodicPhrase): readonly NoteEvent[] {
  return 'notes' in phrase ? phrase.notes : phrase;
}
/**
 * The sounding notes of a melody in time order, one note per onset.
 *
 * The line is expected to be monophonic, as {@link analyzeVoice} expects one.
 * Notes struck together are one event all the same, and the highest of them
 * stands for it — the voice a listener follows through a chord. Keeping them
 * all would let a chord read as a line: a triad and the note after it would
 * measure three rising steps of melodic motion the music never made, and would
 * be reported as an ascending line with every bit as much confidence as a real
 * one.
 */
export function orderedNotes(
  notes: readonly NoteEvent[],
  name: string,
  budget?: number,
): readonly NoteEvent[] {
  assertNoteEvents(notes, name, { allowNonPositiveDuration: true, budget });
  const sounding = notes
    .filter((note) => note.durationBeat > 0)
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  const line: NoteEvent[] = [];
  for (const note of sounding) {
    const previous = line[line.length - 1];
    // Sorted low to high within an onset, so the last note to arrive at one is
    // its top voice.
    if (previous !== undefined && Math.abs(note.startBeat - previous.startBeat) <= BEAT_EPS) {
      line[line.length - 1] = note;
      continue;
    }
    line.push(note);
  }
  return line;
}
/** Semitones between consecutive notes. */
export function intervalsOf(notes: readonly NoteEvent[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < notes.length; i += 1) {
    out.push((notes[i]?.pitch ?? 0) - (notes[i - 1]?.pitch ?? 0));
  }
  return out;
}
/** Onset-to-onset gaps between consecutive notes. */
export function onsetGaps(notes: readonly NoteEvent[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < notes.length; i += 1) {
    out.push((notes[i]?.startBeat ?? 0) - (notes[i - 1]?.startBeat ?? 0));
  }
  return out;
}
/**
 * The onset gaps a line read back to front would have.
 *
 * Playing a cell backwards keeps each note as long as it was, so the gap that
 * opens before a note in the retrograde is the gap that followed it in the
 * model — the distance between the two notes' ends, not between their onsets.
 * The two coincide only when every note is the same length, which is why the
 * onset gaps reversed cannot stand in for this.
 */
export function retrogradeGaps(notes: readonly NoteEvent[]): number[] {
  const out: number[] = [];
  for (let i = notes.length - 1; i >= 1; i -= 1) {
    const later = notes[i];
    const earlier = notes[i - 1];
    out.push(
      (later?.startBeat ?? 0) +
        (later?.durationBeat ?? 0) -
        ((earlier?.startBeat ?? 0) + (earlier?.durationBeat ?? 0)),
    );
  }
  return out;
}
/**
 * Onset gaps as multiples of the first gap, rounded onto the comparison grid.
 *
 * Gaps rather than durations, because how long a note is held is a matter of
 * articulation — the same figure played staccato and legato is the same figure —
 * while where the next note falls is the rhythm itself. Normalising by the first
 * gap is what lets a statement in doubled note values match the motif it doubles;
 * the stretch is reported separately as a time ratio.
 *
 * A cell whose first gap is not positive has no profile to normalise by, and
 * answers null.
 */
export function rhythmProfile(gaps: readonly number[]): number[] | null {
  const unit = gaps[0] ?? 0;
  if (!(unit > BEAT_EPS)) {
    return gaps.length === 0 ? [] : null;
  }
  return gaps.map((gap) => Math.round((gap / unit) * RHYTHM_GRID) / RHYTHM_GRID);
}
/** Compare two numeric sequences elementwise. */
export function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > BEAT_EPS) {
      return false;
    }
  }
  return true;
}
/** Round for display, so a rationale never carries floating-point noise. */
export function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
/** Beat of the last note's end. */
export function endBeatOf(notes: readonly NoteEvent[]): number {
  let end = 0;
  for (const note of notes) {
    end = Math.max(end, note.startBeat + note.durationBeat);
  }
  return end;
}
/** Distance from the first onset to the last, which is what a stretch scales. */
export function onsetSpan(notes: readonly NoteEvent[]): number {
  if (notes.length < 2) {
    return 0;
  }
  return (notes[notes.length - 1]?.startBeat ?? 0) - (notes[0]?.startBeat ?? 0);
}
