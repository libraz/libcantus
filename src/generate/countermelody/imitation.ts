/**
 * Imitative entries: a second voice restating what the first has just sung.
 *
 * A motif transform has no time relationship to anything — it returns a cell,
 * and where that cell goes is the caller's problem. An imitation is defined by
 * that relationship: it enters at a stated beat, at a stated interval, against a
 * voice that is still sounding. That is what a canon is, and what the answering
 * phrase in the second half of a chorus is.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { IntervalLike, SpelledInterval } from '../../core/pitch/index.js';
import { toSpelledInterval } from '../../core/pitch/index.js';
import type { NoteEvent } from '../../core/types.js';
import {
  assertFiniteNumber,
  assertNoteEvents,
  assertOneOf,
  dropSilentNotes,
} from '../../core/validation/index.js';
import {
  type KeyLike,
  scaleLadderPitch,
  scaleLadderPosition,
  shiftByScaleDegrees,
  toKeyScale,
} from '../../theory/scale/index.js';

/** Every way an imitation can answer, in declaration order. */
const IMITATION_ANSWERS = ['real', 'tonal'] as const;

/**
 * How an imitation answers the voice it follows.
 *
 * A `real` answer transposes literally, keeping every interval of the subject
 * and leaving the key where the interval puts it. A `tonal` answer counts scale
 * degrees instead, so the answer stays in the key and adjusts an interval or two
 * to do it — the fifth of a subject answered by a fourth.
 *
 * @category Composition
 */
export type ImitationAnswer = (typeof IMITATION_ANSWERS)[number];

/**
 * Options controlling {@link imitate}.
 *
 * @category Composition
 */
export type ImitationOptions = {
  /**
   * Beat at which the imitation enters; the copied material starts here.
   * Negative like any other onset, for an answer that enters in a pickup.
   */
  atBeat: number;
  /**
   * Interval to imitate at, spelled: `'P5'` for an answer a fifth above,
   * `'-P4'` for one a fourth below.
   */
  interval: IntervalLike;
  /**
   * The key the answer is measured in; what makes a tonal answer tonal. A key
   * name such as `'C major'` is read as that key.
   */
  key: KeyLike;
  /**
   * Whether the answer transposes literally or by scale degree.
   *
   * @defaultValue 'real'
   */
  answer?: ImitationAnswer;
  /**
   * Turn the subject upside down before transposing it, mirroring it about its
   * own first note: by semitone for a real answer, by scale degree for a tonal
   * one.
   *
   * @defaultValue false
   */
  invert?: boolean;
  /** First beat of the lead to imitate; defaults to the start of the line. */
  from?: number;
  /** Beat to imitate up to, exclusive; defaults to the end of the line. */
  to?: number;
  /**
   * Factor applied to the copied velocities, for an answer that sits under the
   * voice it follows.
   *
   * @defaultValue 1
   */
  velocityScale?: number;
};

/** How many scale degrees a spelled interval spans, signed by its direction. */
function degreesOf(interval: SpelledInterval): number {
  const descending = interval.descending ?? interval.semitones < 0;
  return (interval.number - 1) * (descending ? -1 : 1);
}

/** Reject a pitch the transposition has pushed off the keyboard. */
function assertPlayable(pitch: number): number {
  if (pitch < 0 || pitch > 127) {
    throw new InvalidInputError(`imitated pitch ${pitch} is outside the MIDI range 0..127`);
  }
  return pitch;
}

/**
 * Answer a leading voice with an imitation of it.
 *
 * The chosen span of the lead is copied so that its first note falls on
 * `atBeat`, keeping its internal rhythm; only the answer is returned, so the
 * caller decides what to do with the two voices together. Pitches move by
 * `interval`: literally for a real answer, by scale degree for a tonal one, and
 * upside down first when `invert` is set. Inversion mirrors about the first note
 * of the copied span, so the answer starts where the transposition puts that
 * note either way. In a tonal answer a pitch outside the key keeps its distance
 * from the scale tone below it, and inversion mirrors that distance too — a
 * chromatic passing note stays a chromatic passing note, on the other side.
 * Where a mirrored chromatic note falls into a diatonic semitone the key leaves
 * it no room, and it lands on the scale tone there, so a subject saturated with
 * chromatic steps can answer with a pitch repeated.
 *
 * @param lead The voice being imitated, in ascending onset order.
 * @param opts Where the answer enters, at what interval, and in what key.
 * @returns The imitation as note events sorted by onset; `[]` when the chosen
 *   span holds no sounding notes. Notes with a zero or negative duration never
 *   sound and are not copied, so the answer can be shorter than the span. Every
 *   other field of a copied note — its articulation, and its velocity through
 *   `velocityScale` — comes across with it.
 * @throws If the span is reversed, the answer is not a known kind, or a
 *   transposed pitch leaves the MIDI range.
 * @example
 * ```ts
 * import { imitate, majorKey } from '@libraz/libcantus';
 * const lead = [0, 1, 2].map((beat) => ({ pitch: 60 + beat, startBeat: beat, durationBeat: 1 }));
 * imitate(lead, { atBeat: 2, interval: 'P5', key: majorKey(0) });
 * // the same three notes a fifth up, entering at beat 2
 * ```
 * @category Composition
 */
export function imitate(lead: readonly NoteEvent[], opts: ImitationOptions): NoteEvent[] {
  assertNoteEvents(lead, 'imitate lead', { allowNonPositiveDuration: true });
  // Onsets are unbounded below library-wide, because a pickup sounds before the
  // downbeat and the downbeat is beat 0; an answer to a pickup enters there too.
  assertFiniteNumber(opts.atBeat, 'atBeat');
  const interval = toSpelledInterval(opts.interval);
  // The key is read into its plain form once, here at the boundary; the degree
  // arithmetic below is given the scale it resolved to.
  const key = toKeyScale(opts.key);
  const from = opts.from ?? Number.NEGATIVE_INFINITY;
  const to = opts.to ?? Number.POSITIVE_INFINITY;
  if (opts.from !== undefined) {
    assertFiniteNumber(opts.from, 'from');
  }
  if (opts.to !== undefined) {
    assertFiniteNumber(opts.to, 'to');
  }
  if (from > to) {
    throw new InvalidInputError(`imitate needs from <= to; received ${from} > ${to}`);
  }
  const velocityScale = opts.velocityScale ?? 1;
  assertFiniteNumber(velocityScale, 'velocityScale');
  // Checked before the empty-span exit, so a malformed option is rejected
  // whether or not the chosen span happens to hold a note.
  const tonal = assertOneOf(opts.answer ?? 'real', IMITATION_ANSWERS, 'imitate answer') === 'tonal';

  // Zero-length artefacts are routine in MIDI imports and never sound. Dropping
  // them before the copy keeps the answer passable to any entry point in the
  // library, which reject non-positive durations by default.
  const subject = dropSilentNotes(lead)
    .filter((note) => note.startBeat >= from && note.startBeat < to)
    .sort((a, b) => a.startBeat - b.startBeat);
  const origin = subject[0]?.startBeat;
  const pivot = subject[0]?.pitch;
  if (origin === undefined || pivot === undefined) {
    return [];
  }
  const shift = opts.atBeat - origin;
  const invert = opts.invert ?? false;
  const degrees = degreesOf(interval);

  return subject.map((note) => {
    let pitch = note.pitch;
    // A tonal answer counts along the key's ladder of scale tones, which is what
    // carries a pitch between two of them through the transposition as the note
    // it was: {@link shiftByScaleDegrees} keeps its distance above the scale
    // tone below it.
    let offset = 0;
    if (invert) {
      if (tonal) {
        // Mirroring reflects the rung, and the offset with it: a note a semitone
        // above its scale tone lands a semitone below the one it is mirrored
        // onto, which is what keeps two adjacent chromatic pitches from being
        // flattened onto the same answer. The mirrored pitch is a scale tone, so
        // the offset is added back after the degree arithmetic.
        const here = scaleLadderPosition(pitch, key);
        pitch = scaleLadderPitch(2 * scaleLadderPosition(pivot, key).rung - here.rung, key);
        offset = -here.offset;
      } else {
        pitch = 2 * pivot - pitch;
      }
    }
    pitch = tonal
      ? shiftByScaleDegrees(pitch, degrees, key) + offset
      : pitch + Math.round(interval.semitones);
    // The pass owns the pitch and the placement; everything else the subject
    // carries — the articulation an ornament pass wrote, above all — belongs to
    // the answer too, so an imitation composes with the passes before it.
    const answer: NoteEvent = {
      ...note,
      pitch: assertPlayable(pitch),
      startBeat: note.startBeat + shift,
    };
    if (note.velocity !== undefined) {
      answer.velocity = Math.max(1, Math.min(127, Math.round(note.velocity * velocityScale)));
    }
    return answer;
  });
}
