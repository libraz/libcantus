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
import { pitchClassOf, toSpelledInterval } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import { assertFiniteNumber, assertNoteEvents, assertRange } from '../../core/validation/index.js';

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
export type ImitationAnswer = 'real' | 'tonal';

/**
 * Options controlling {@link imitate}.
 *
 * @category Composition
 */
export type ImitationOptions = {
  /** Beat at which the imitation enters; the copied material starts here. */
  atBeat: number;
  /**
   * Interval to imitate at, spelled: `'P5'` for an answer a fifth above,
   * `'-P4'` for one a fourth below.
   */
  interval: IntervalLike;
  /** The key the answer is measured in; what makes a tonal answer tonal. */
  key: KeyScale;
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

/** Scale-degree offsets above the tonic, ascending within one octave. */
function scaleOffsets(key: KeyScale): number[] {
  const offsets: number[] = [];
  for (let n = 0; n < 12; n += 1) {
    if (((key.modeMask12 >> n) & 1) === 1) {
      offsets.push(n);
    }
  }
  return offsets;
}

/**
 * The ladder of scale tones a tonal answer counts along.
 *
 * A tonal answer moves by scale degrees, so every pitch has to be located on
 * that ladder and put back on it afterwards. A pitch outside the key keeps its
 * distance from the scale tone below it, which is what lets a chromatic passing
 * note survive the transposition as a chromatic passing note.
 */
function scaleLadder(key: KeyScale): {
  index: (pitch: number) => number;
  offset: (pitch: number) => number;
  pitch: (index: number) => number;
} {
  const offsets = scaleOffsets(key);
  const size = offsets.length;
  const anchor = pitchClassOf(key.rootPc);
  const locate = (pitch: number): { index: number; offset: number } => {
    const relative = pitch - anchor;
    const octave = Math.floor(relative / 12);
    const within = relative - octave * 12;
    let degree = 0;
    for (let n = 0; n < size; n += 1) {
      if ((offsets[n] ?? 0) <= within) {
        degree = n;
      }
    }
    return { index: octave * size + degree, offset: within - (offsets[degree] ?? 0) };
  };
  return {
    index: (pitch) => locate(pitch).index,
    offset: (pitch) => locate(pitch).offset,
    pitch: (index) => {
      const octave = Math.floor(index / size);
      const degree = index - octave * size;
      return anchor + octave * 12 + (offsets[degree] ?? 0);
    },
  };
}

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
 * note either way.
 *
 * @param lead The voice being imitated, in ascending onset order.
 * @param opts Where the answer enters, at what interval, and in what key.
 * @returns The imitation as note events sorted by onset; `[]` when the chosen
 *   span holds no notes.
 * @throws If the span is reversed, or a transposed pitch leaves the MIDI range.
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
  // Beat 0 is the start of the music, so an entry can be late but never early.
  assertRange(opts.atBeat, 0, Number.MAX_SAFE_INTEGER, 'atBeat');
  const interval = toSpelledInterval(opts.interval);
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

  const subject = lead
    .filter((note) => note.startBeat >= from && note.startBeat < to)
    .sort((a, b) => a.startBeat - b.startBeat);
  const origin = subject[0]?.startBeat;
  const pivot = subject[0]?.pitch;
  if (origin === undefined || pivot === undefined) {
    return [];
  }
  const shift = opts.atBeat - origin;
  const tonal = (opts.answer ?? 'real') === 'tonal';
  const invert = opts.invert ?? false;
  const ladder = scaleLadder(opts.key);
  const degrees = degreesOf(interval);

  return subject.map((note) => {
    let pitch = note.pitch;
    if (invert) {
      pitch = tonal
        ? ladder.pitch(2 * ladder.index(pivot) - ladder.index(pitch)) - ladder.offset(pitch)
        : 2 * pivot - pitch;
    }
    pitch = tonal
      ? ladder.pitch(ladder.index(pitch) + degrees) + ladder.offset(pitch)
      : pitch + Math.round(interval.semitones);
    const answer: NoteEvent = {
      pitch: assertPlayable(pitch),
      startBeat: note.startBeat + shift,
      durationBeat: note.durationBeat,
    };
    if (note.velocity !== undefined) {
      answer.velocity = Math.max(1, Math.min(127, Math.round(note.velocity * velocityScale)));
    }
    return answer;
  });
}
