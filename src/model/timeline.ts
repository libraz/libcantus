import type { CadenceResult, DetectCadenceOptions } from '../analyze/functional/index.js';
import type { KeyRegion } from '../analyze/keys/index.js';
import type { ReducedChord, ReduceProgressionOptions } from '../analyze/reduction/index.js';
import type { ChordTimeline, ChordTimelineOptions } from '../analyze/timeline/index.js';
import { InvalidInputError } from '../core/errors/index.js';
import type { IntervalLike } from '../core/pitch/index.js';
import type { NoteEvent } from '../core/types.js';
import type { ChordSegment, ChordSpan } from '../theory/chord/index.js';
import type { KeyLike } from '../theory/scale/index.js';
import type { Chord } from './chord.js';
import type { Key } from './key.js';
import type { Progression } from './progression.js';

/** The plain form a {@link Timeline} hands out and is rebuilt from. */
export type TimelineData = {
  segments: ChordSegment[];
  totalBeats: number;
  keys?: KeyRegion[];
};

/**
 * Placeholder body for a member whose implementation has not landed yet.
 *
 * The arguments are taken and dropped so a signature stays exactly what it
 * will be once the body arrives, rather than being written around the stub.
 */
function pending(member: string, ...args: unknown[]): never {
  void args;
  throw new InvalidInputError(`Timeline.${member} is not implemented yet`);
}

/**
 * Harmony that keeps its place in time: chord segments over a span of beats,
 * with the key regions the analysis found under them.
 *
 * This is the timed counterpart of {@link Progression}, which holds an ordered
 * list of chords and deliberately drops their onsets. A piece read from a MIDI
 * track has both a chord order and a chord rhythm, and until now only the order
 * could be held in a class; `Timeline` is where the rhythm lives.
 *
 * @category Class API
 */
export class Timeline {
  readonly #data: TimelineData;

  /**
   * Wrap plain timeline data.
   *
   * @param data The segments and the span they cover; copied, never retained.
   */
  constructor(data: TimelineData) {
    this.#data = data;
  }

  /**
   * Build a timeline from placed chords.
   *
   * @param spans The chords with their onsets, in any order.
   * @param totalBeats Where the last chord stops sounding.
   * @param key The key the chords are read in, when it is already known.
   * @returns The timeline.
   */
  static fromChords(spans: readonly ChordSpan[], totalBeats: number, key?: KeyLike): Timeline {
    return pending('fromChords', spans, totalBeats, key);
  }

  /**
   * Infer a timeline from sounding notes.
   *
   * @param notes The note events to read.
   * @param opts The options {@link chordTimelineFromNotes} accepts.
   * @returns The inferred timeline, carrying the key regions the analysis found.
   */
  static fromNotes(notes: readonly NoteEvent[], opts?: ChordTimelineOptions): Timeline {
    return pending('fromNotes', notes, opts);
  }

  /**
   * Place a progression's chords on a regular grid.
   *
   * @param progression The chords, in order.
   * @param beatsEach How long each chord sounds.
   * @returns The timeline.
   */
  static fromProgression(progression: Progression, beatsEach: number): Timeline {
    return pending('fromProgression', progression, beatsEach);
  }

  /** Rebuild a timeline from the plain data {@link Timeline.data} hands out. */
  static fromData(data: TimelineData): Timeline {
    return new Timeline(data);
  }

  /** Rebuild a timeline from its {@link Timeline.toJSON} output. */
  static fromJSON(data: TimelineData): Timeline {
    return new Timeline(data);
  }

  /** The chord sounding at a beat, or null where nothing is. */
  at(beat: number): Chord | null {
    return pending('at', beat);
  }

  /** The chord segments, in time order. */
  get segments(): readonly ChordSegment[] {
    return pending('segments');
  }

  /** Where the last chord stops sounding. */
  get totalBeats(): number {
    return pending('totalBeats');
  }

  /** The key held longest across the span, when the analysis found one. */
  get key(): Key | undefined {
    return pending('key');
  }

  /** Every key region under the span, in time order. */
  get keys(): readonly KeyRegion[] {
    return pending('keys');
  }

  /** How many segments the timeline holds. */
  get length(): number {
    return pending('length');
  }

  [Symbol.iterator](): IterableIterator<ChordSegment> {
    return pending('[Symbol.iterator]');
  }

  /**
   * Drop the time axis, keeping the chord order.
   *
   * Explicit rather than implicit, because the onsets are information and
   * losing them silently is how a chord rhythm disappears from a pipeline.
   */
  progression(): Progression {
    return pending('progression');
  }

  /** The structural chords behind the surface harmony. */
  reduce(opts?: ReduceProgressionOptions): ReducedChord[] {
    return pending('reduce', opts);
  }

  /** The cadences the harmony arrives at. */
  cadences(opts?: DetectCadenceOptions): CadenceResult[] {
    return pending('cadences', opts);
  }

  /** The chords as roman numerals in a key. */
  roman(key?: KeyLike): string[] {
    return pending('roman', key);
  }

  /** The stretch of the timeline between two beats. */
  slice(fromBeat: number, toBeat: number): Timeline {
    return pending('slice', fromBeat, toBeat);
  }

  /** The timeline moved by a number of semitones. */
  transpose(semitones: number): Timeline {
    return pending('transpose', semitones);
  }

  /** The timeline moved by a spelled interval, keeping the spelling. */
  transposeBy(interval: IntervalLike): Timeline {
    return pending('transposeBy', interval);
  }

  /** Whether another timeline holds the same chords over the same span. */
  equals(other: Timeline): boolean {
    return pending('equals', other);
  }

  /** A copy of the underlying plain data. */
  get data(): TimelineData {
    return pending('data');
  }

  /** The plain form of the timeline, for `JSON.stringify`. */
  toJSON(): TimelineData {
    return this.data;
  }

  /** The `{ at, segments }` shape the analysis functions take. */
  get chordTimeline(): ChordTimeline {
    return pending('chordTimeline');
  }
}
