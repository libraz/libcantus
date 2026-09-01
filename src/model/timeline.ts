import type { ChordToRomanOptions } from '../analyze/functional/index.js';
import { chordToRoman } from '../analyze/functional/index.js';
import type { KeyRegion, KeyTimelineOptions } from '../analyze/keys/index.js';
import { detectModulations, keyLookup, prevailingKeyOf } from '../analyze/keys/index.js';
import type { ReducedChord, ReduceProgressionOptions } from '../analyze/reduction/index.js';
import { reduceProgression } from '../analyze/reduction/index.js';
import type { CadenceHit, ChordTimeline, ChordTimelineOptions } from '../analyze/timeline/index.js';
import {
  chordTimelineFromChords,
  chordTimelineFromNotes,
  detectCadences,
} from '../analyze/timeline/index.js';
import { InvalidInputError } from '../core/errors/index.js';
import type { IntervalLike } from '../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../core/types.js';
import { assertFiniteNumber, assertRange } from '../core/validation/index.js';
import type { Chord as ChordData, ChordSegment, ChordSpan } from '../theory/chord/index.js';
import { spanFromChord } from '../theory/chord/index.js';
import type { KeyLike } from '../theory/scale/index.js';
import { scaleOf, toKeyScale } from '../theory/scale/index.js';
import type { Chord } from './chord.js';
import { Chord as ChordClass } from './chord.js';
import type { Key } from './key.js';
import { keyIdentity, toKey } from './key.js';
import { Progression } from './progression.js';
import {
  assertDataArray,
  assertDataObject,
  assertKeyArgument,
  STATED_KEY_CONFIDENCE,
  spanEnd,
} from './shared.js';

/** The plain form a {@link Timeline} hands out and is rebuilt from. */
export type TimelineData = {
  segments: ChordSegment[];
  totalBeats: number;
  keys?: KeyRegion[];
  /**
   * How sure the analysis is of each segment's chord, in [0, 1] and in segment
   * order. Carried only by a timeline read from notes: chords a caller placed
   * are not a reading, so a timeline built from them has nothing to report.
   */
  segmentConfidence?: number[];
};

/**
 * One segment's Roman numeral, with the beats the chord holds it for.
 *
 * A numeral on its own says nothing about when it sounds, and a timed class
 * that answered with a bare list would leave the caller re-deriving the onsets
 * it already holds. The beat range is the segment's own, so a numeral list and
 * a segment list read in step — the shape {@link ReducedChord} already uses.
 */
export type TimelineRoman = {
  startBeat: number;
  endBeat: number;
  roman: string;
};

/** A validated, defensive copy of one chord segment. */
function copySegment(segment: ChordSegment): ChordSegment {
  assertDataObject(segment, 'timeline segment');
  return {
    startBeat: assertFiniteNumber(segment.startBeat, 'timeline segment startBeat'),
    endBeat: assertFiniteNumber(segment.endBeat, 'timeline segment endBeat'),
    // The chord is checked by the same boundary every other chord crosses, so a
    // root of 25 or an interval of NaN is refused or reduced here rather than
    // surfacing wherever the number is finally used.
    chord: new ChordClass(segment.chord).toJSON(),
  };
}

/** A validated, defensive copy of one key region, pivot chord included. */
function copyKeyRegion(region: KeyRegion): KeyRegion {
  assertDataObject(region, 'key region');
  const copy: KeyRegion = {
    startBeat: assertFiniteNumber(region.startBeat, 'key region startBeat'),
    endBeat: assertFiniteNumber(region.endBeat, 'key region endBeat'),
    // Read through the key itself, so a tonic that does not spell the region's
    // own root is refused here rather than spelling later notes wrongly.
    key: keyIdentity(toKey(region.key)),
    confidence: assertFiniteNumber(region.confidence, 'key region confidence'),
  };
  if (region.modulation !== undefined) {
    copy.modulation = region.modulation;
  }
  if (region.pivot !== undefined) {
    assertDataObject(region.pivot, 'key region pivot');
    copy.pivot = {
      chord: new ChordClass(region.pivot.chord).toJSON(),
      romanFrom: region.pivot.romanFrom,
      romanTo: region.pivot.romanTo,
    };
  }
  return copy;
}

/**
 * A validated copy of the per-segment confidences, one per segment.
 *
 * The list is meaningless unless it lines up with the segments — it carries no
 * beats of its own and is read by position — so a list of another length is
 * refused rather than silently paired off against the segments it happens to
 * cover.
 */
function copyConfidence(
  confidence: readonly number[] | undefined,
  segments: number,
): readonly number[] {
  if (confidence === undefined) {
    return [];
  }
  assertDataArray(confidence, 'timeline segmentConfidence');
  if (confidence.length !== segments) {
    throw new InvalidInputError(
      `timeline segmentConfidence must hold one value per segment; received ${confidence.length} for ${segments}`,
    );
  }
  return confidence.map((value, index) =>
    assertRange(value, 0, 1, `timeline segmentConfidence[${index}]`),
  );
}

/**
 * The chord sounding at a beat, or null where nothing is.
 *
 * Segments are disjoint and in beat order, so the covering one is found by
 * binary search rather than by scanning: this is what `at(beat)` and every
 * analysis reading the timeline go through.
 */
function chordAtBeat(segments: readonly ChordSegment[], beat: number): ChordData | null {
  assertFiniteNumber(beat, 'timeline query beat');
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((segments[middle]?.startBeat ?? Number.POSITIVE_INFINITY) <= beat) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const candidate = segments[low - 1];
  return candidate !== undefined && beat >= candidate.startBeat && beat < candidate.endBeat
    ? candidate.chord
    : null;
}

/** The part of a span lying inside `[fromBeat, toBeat)`, or null when none does. */
function clipSpan<T extends { startBeat: number; endBeat: number }>(
  span: T,
  fromBeat: number,
  toBeat: number,
): T | null {
  const startBeat = Math.max(span.startBeat, fromBeat);
  const endBeat = Math.min(span.endBeat, toBeat);
  return endBeat > startBeat ? { ...span, startBeat, endBeat } : null;
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
 * @example
 * ```ts
 * import { Chord, Key, Progression, Timeline } from '@libraz/libcantus';
 * const timeline = Timeline.fromProgression(
 *   new Progression([Chord.parse('C'), Chord.parse('G7')], Key.major('C')),
 *   4,
 * );
 * timeline.at(5)?.symbol(); // 'G7'
 * timeline.roman().map((entry) => entry.roman); // ['I', 'V7']
 * ```
 */
export class Timeline {
  readonly #segments: readonly ChordSegment[];
  readonly #totalBeats: number;
  readonly #keys: readonly KeyRegion[];
  readonly #segmentConfidence: readonly number[];

  /**
   * Wrap plain timeline data.
   *
   * @param data The segments and the span they cover; copied, never retained.
   * @throws If the span, a segment, or a key region carries a number it cannot
   *   hold — a beat that is not finite, a mode mask that names no scale — or if
   *   the confidences do not run one per segment.
   */
  constructor(data: TimelineData) {
    assertDataObject(data, 'timeline data');
    this.#segments = Object.freeze(
      assertDataArray<ChordSegment>(data.segments, 'timeline segments').map(copySegment),
    );
    this.#totalBeats = assertRange(
      data.totalBeats,
      0,
      Number.MAX_SAFE_INTEGER,
      'timeline totalBeats',
    );
    this.#keys = Object.freeze(
      assertDataArray<KeyRegion>(data.keys ?? [], 'timeline keys').map(copyKeyRegion),
    );
    this.#segmentConfidence = Object.freeze(
      copyConfidence(data.segmentConfidence, this.#segments.length),
    );
  }

  /**
   * Build a timeline from placed chords.
   *
   * @param spans The chords with their onsets, in any order.
   * @param totalBeats Where the last chord stops sounding.
   * @param key The key the chords are read in, when it is already known. It
   *   becomes the one key region under the whole span; without it the timeline
   *   carries no key, and the members that need one say so.
   * @returns The timeline.
   */
  static fromChords(spans: readonly ChordSpan[], totalBeats: number, key?: KeyLike): Timeline {
    const timeline = chordTimelineFromChords(spans, totalBeats);
    const data: TimelineData = { segments: timeline.segments, totalBeats };
    if (key !== undefined) {
      data.keys = [
        {
          // The region starts where the music does, as an inferred one does,
          // so a chord placed in a pickup is covered by the key it sounds in.
          startBeat: timeline.segments[0]?.startBeat ?? 0,
          endBeat: totalBeats,
          key: keyIdentity(toKey(key)),
          confidence: STATED_KEY_CONFIDENCE,
        },
      ];
    }
    return new Timeline(data);
  }

  /**
   * Infer a timeline from sounding notes.
   *
   * @param notes The note events to read.
   * @param opts The options {@link chordTimelineFromNotes} accepts.
   * @returns The inferred timeline, carrying the key regions the analysis found.
   */
  static fromNotes(notes: readonly NoteEvent[], opts?: ChordTimelineOptions): Timeline {
    const { timeline, keys, segmentConfidence } = chordTimelineFromNotes(notes, opts);
    // The analysis reports where the chords and the keys end rather than the
    // span it ran over, so the span is read back off them unless it was given.
    const totalBeats = opts?.totalBeats ?? spanEnd(timeline.segments, keys);
    return new Timeline({ segments: timeline.segments, totalBeats, keys, segmentConfidence });
  }

  /**
   * Place a progression's chords on a regular grid.
   *
   * The chords cross over as harmony alone: a spelling one of them carried is
   * dropped, and a carried key becomes the plain key/scale of the one region
   * under the span, without its spelled tonic or its detected scale form.
   *
   * @param progression The chords, in order.
   * @param beatsEach How long each chord sounds.
   * @returns The timeline.
   * @throws If `beatsEach` is not a positive finite number of beats.
   */
  static fromProgression(progression: Progression, beatsEach: number): Timeline {
    assertRange(beatsEach, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'timeline beatsEach');
    const chords = progression.chords;
    const spans = chords.map((chord, index) => spanFromChord(chord.data, index * beatsEach));
    const totalBeats = chords.length * beatsEach;
    const key = progression.key;
    return key === undefined
      ? Timeline.fromChords(spans, totalBeats)
      : Timeline.fromChords(spans, totalBeats, key);
  }

  /** Rebuild a timeline from the plain data {@link Timeline.data} hands out. */
  static fromData(data: TimelineData): Timeline {
    return new Timeline(data);
  }

  /** Rebuild a timeline from its {@link Timeline.toJSON} output. */
  static fromJSON(data: TimelineData): Timeline {
    return new Timeline(data);
  }

  /**
   * The chord sounding at a beat, or null where nothing is.
   *
   * A segment covers `[startBeat, endBeat)`, so the beat a chord gives way on
   * answers with the chord arriving rather than the one leaving. The chord
   * carries the key in force at that beat when the timeline knows one, so it
   * can name its own numeral and function.
   *
   * @param beat The beat to read.
   * @returns The chord, or null outside every segment.
   * @throws If `beat` is not finite.
   */
  at(beat: number): Chord | null {
    const chord = chordAtBeat(this.#segments, beat);
    if (chord === null) {
      return null;
    }
    const key = this.#keyAt(beat);
    return key === undefined ? new ChordClass(chord) : new ChordClass(chord, key);
  }

  /** The chord segments, in time order. */
  get segments(): readonly ChordSegment[] {
    return this.#copySegments();
  }

  /** Where the last chord stops sounding. */
  get totalBeats(): number {
    return this.#totalBeats;
  }

  /** The key held longest across the span, when the analysis found one. */
  get key(): Key | undefined {
    const prevailing = prevailingKeyOf(this.#keys);
    return prevailing === null ? undefined : toKey(prevailing);
  }

  /**
   * Every key region under the span, in time order.
   *
   * These are the regions the timeline was built with: the ones
   * {@link Timeline.fromNotes} read off the notes, or the single region a key
   * given to {@link Timeline.fromChords} describes. A timeline holding chords
   * alone carries none until it is asked to read them —
   * {@link Timeline.modulations} is where the chords are searched for the keys
   * they imply.
   */
  get keys(): readonly KeyRegion[] {
    return this.#keys.map(copyKeyRegion);
  }

  /**
   * How sure the analysis is of each segment's chord, in [0, 1] and in segment
   * order, so a reading is paired with the segment it describes by position.
   *
   * A confidence answers the question a chord symbol cannot: whether the notes
   * really spell that chord, or whether a passing figure was the best of a bad
   * set of candidates. Empty on a timeline whose chords were placed rather than
   * inferred — {@link Timeline.fromChords} and {@link Timeline.fromProgression}
   * are given the harmony, so there is no reading to report.
   *
   * @example
   * ```ts
   * import { Timeline } from '@libraz/libcantus';
   * const timeline = Timeline.fromNotes([
   *   { pitch: 60, startBeat: 0, durationBeat: 4 },
   *   { pitch: 64, startBeat: 0, durationBeat: 4 },
   *   { pitch: 67, startBeat: 0, durationBeat: 4 },
   * ]);
   * timeline.segmentConfidence.length === timeline.length; // true
   * ```
   */
  get segmentConfidence(): readonly number[] {
    return [...this.#segmentConfidence];
  }

  /** How many segments the timeline holds. */
  get length(): number {
    return this.#segments.length;
  }

  /** Iterate the segments in time order, so a timeline works with `for...of`. */
  [Symbol.iterator](): IterableIterator<ChordSegment> {
    return this.#copySegments()[Symbol.iterator]();
  }

  /**
   * Drop the time axis, keeping the chord order.
   *
   * Explicit rather than implicit, because the onsets are information and
   * losing them silently is how a chord rhythm disappears from a pipeline. A
   * rest between two segments goes with them: the chords either side become
   * neighbours in the progression.
   *
   * @returns The chords in order, carrying the prevailing key when there is one.
   */
  progression(): Progression {
    const chords = this.#segments.map((segment) => new ChordClass(segment.chord));
    const key = this.key;
    return key === undefined ? new Progression(chords) : new Progression(chords, key);
  }

  /**
   * The structural chords behind the surface harmony.
   *
   * @param opts Which reading decides the frame; see
   *   {@link ReduceProgressionOptions}.
   * @returns One labelled chord per segment, in time order.
   * @throws If the timeline carries no key region to read the chords against.
   */
  reduce(opts?: ReduceProgressionOptions): ReducedChord[] {
    return reduceProgression(this.chordTimeline, this.#keyContext(), opts);
  }

  /**
   * The cadences the harmony arrives at.
   *
   * Each hit carries the beat it arrives on as well as the cadence itself: a
   * cadence without its onset says that the music cadenced but not where, which
   * is the one thing a timed class is holding that a chord pair is not.
   *
   * @returns The cadences found, in time order.
   * @throws If the timeline carries no key region to read the chords against.
   */
  cadences(): CadenceHit[] {
    return detectCadences(this.chordTimeline, this.#keyContext());
  }

  /**
   * The keys the chords themselves imply, in time order.
   *
   * The chord route to key regions, for a timeline that holds harmony without
   * the notes it was played from — a lead sheet, or a progression laid out in
   * time. A chord argues for a key far more strongly than its three or four
   * pitch classes do, so a modulation is read off the chords rather than off a
   * pitch-class profile, and the chord that reads in both keys is reported as
   * the pivot the modulation turned on.
   *
   * The regions are searched for here rather than kept on the timeline:
   * {@link Timeline.keys} answers with what the timeline was built with, which
   * for placed chords is the key the caller stated or nothing at all.
   *
   * @param opts Analysis options; see {@link KeyTimelineOptions}.
   * @returns The key regions the chords imply; empty when there are no chords.
   * @example
   * ```ts
   * import { Chord, Key, Progression, Timeline } from '@libraz/libcantus';
   * const progression = new Progression(
   *   [Chord.parse('C'), Chord.parse('G7'), Chord.parse('C')],
   *   Key.major('C'),
   * );
   * Timeline.fromProgression(progression, 4).modulations().length; // 1
   * ```
   */
  modulations(opts?: KeyTimelineOptions): KeyRegion[] {
    return detectModulations(this.#copySegments(), {
      totalBeats: this.#totalBeats,
      ...opts,
    }).map(copyKeyRegion);
  }

  /**
   * The chords as roman numerals in a key.
   *
   * @param key Key to read the chords in; falls back to the key in force at
   *   each segment, so a timeline that modulates names every chord in the key
   *   it actually sounds in.
   * @param opts Applied-numeral rendering options; see
   *   {@link ChordToRomanOptions}.
   * @returns One numeral per segment, with the beats it holds for.
   * @throws If no key is given and the timeline carries none.
   */
  roman(key?: KeyLike, opts?: ChordToRomanOptions): TimelineRoman[] {
    assertKeyArgument(key, 'timeline key');
    const given = key === undefined ? undefined : toKeyScale(key);
    const keyAt = given === undefined ? this.#keyContext() : () => given;
    return this.#segments.map((segment) => ({
      startBeat: segment.startBeat,
      endBeat: segment.endBeat,
      roman: chordToRoman(segment.chord, keyAt(segment.startBeat), opts),
    }));
  }

  /**
   * The stretch of the timeline between two beats.
   *
   * Beats are kept as they are rather than rebased on the slice, so a sliced
   * timeline still lines up with the score it was read from; `totalBeats`
   * becomes where the slice ends. A segment or key region straddling an edge is
   * clipped to it, and one reduced to nothing is dropped.
   *
   * @param fromBeat First beat of the stretch.
   * @param toBeat End of the stretch, exclusive.
   * @returns The clipped timeline.
   * @throws If either beat is not finite, or `toBeat` precedes `fromBeat`.
   */
  slice(fromBeat: number, toBeat: number): Timeline {
    assertFiniteNumber(fromBeat, 'timeline slice fromBeat');
    assertFiniteNumber(toBeat, 'timeline slice toBeat');
    if (toBeat < fromBeat) {
      throw new InvalidInputError(
        `timeline slice toBeat must not precede fromBeat; received [${fromBeat}, ${toBeat})`,
      );
    }
    const clip = <T extends { startBeat: number; endBeat: number }>(spans: readonly T[]): T[] =>
      spans
        .map((span) => clipSpan(span, fromBeat, toBeat))
        .filter((span): span is T => span !== null);
    // The confidences travel with the segments they describe: they are read by
    // position, so dropping a segment without dropping its reading would shift
    // every later one onto the wrong chord.
    const kept = this.#segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => clipSpan(segment, fromBeat, toBeat) !== null);
    const data: TimelineData = {
      segments: clip(this.#segments),
      totalBeats: Math.max(0, Math.min(toBeat, this.#totalBeats)),
      keys: clip(this.#keys),
    };
    if (this.#segmentConfidence.length > 0) {
      data.segmentConfidence = kept.map(({ index }) => this.#segmentConfidence[index] ?? 0);
    }
    return new Timeline(data);
  }

  /**
   * The timeline moved by a number of semitones.
   *
   * The key regions move with the chords, so every segment keeps the degree and
   * function it had in the key it sounded in.
   *
   * @param semitones The signed semitone offset.
   * @returns The transposed timeline.
   */
  transpose(semitones: number): Timeline {
    return this.#moved(
      (chord) => chord.transpose(semitones),
      (key) => key.transpose(semitones),
    );
  }

  /**
   * The timeline moved by a spelled interval, keeping the spelling.
   *
   * Unlike {@link Timeline.transpose}, which picks letters from a semitone
   * count, the interval's diatonic number decides them: a chord taken up an
   * augmented fourth is spelled with sharps and one taken up a diminished fifth
   * with flats.
   *
   * Only a chord carrying a spelling of its own is spelled that way. A key
   * region holds a key/scale rather than a spelled key, so a chord that takes
   * its letters from the key in force follows the spelling that scale reads
   * best from, whichever interval moved it there.
   *
   * @param interval An interval name (e.g. `'A4'`, `'-m3'`), plain interval
   *   data, or an {@link Interval}; a descending interval moves down.
   * @returns The transposed timeline.
   */
  transposeBy(interval: IntervalLike): Timeline {
    return this.#moved(
      (chord) => chord.transposeBy(interval),
      (key) => key.transposeBy(interval),
    );
  }

  /**
   * Whether another timeline holds the same chords over the same span.
   *
   * The key regions are not compared: they are an analysis lens over the
   * chords, the way a {@link Progression}'s key context is over its own.
   *
   * @param other The timeline to compare.
   * @returns True when the segments and the span both match.
   */
  equals(other: Timeline): boolean {
    const theirs = other.data;
    if (theirs.totalBeats !== this.#totalBeats || theirs.segments.length !== this.length) {
      return false;
    }
    return this.#segments.every((segment, index) => {
      const mine = segment;
      const yours = theirs.segments[index];
      return (
        yours !== undefined &&
        mine.startBeat === yours.startBeat &&
        mine.endBeat === yours.endBeat &&
        new ChordClass(mine.chord).equals(new ChordClass(yours.chord))
      );
    });
  }

  /** A copy of the underlying plain data. */
  get data(): TimelineData {
    const data: TimelineData = {
      segments: this.#copySegments(),
      totalBeats: this.#totalBeats,
    };
    // Omitted rather than written as an empty list, so a timeline built without
    // a key serializes to the segments and the span alone.
    if (this.#keys.length > 0) {
      data.keys = this.#keys.map(copyKeyRegion);
    }
    if (this.#segmentConfidence.length > 0) {
      data.segmentConfidence = [...this.#segmentConfidence];
    }
    return data;
  }

  /** The plain form of the timeline, for `JSON.stringify`. */
  toJSON(): TimelineData {
    return this.data;
  }

  /** The `{ at, segments }` shape the analysis functions take. */
  get chordTimeline(): ChordTimeline {
    const segments = this.#copySegments();
    return { at: (beat) => chordAtBeat(segments, beat), segments };
  }

  /** A fresh copy of the segments, which is what every reader is handed. */
  #copySegments(): ChordSegment[] {
    return this.#segments.map(copySegment);
  }

  /** The key in force at a beat, or undefined when the timeline knows none. */
  #keyAt(beat: number): Key | undefined {
    const prevailing = prevailingKeyOf(this.#keys);
    return prevailing === null ? undefined : toKey(keyLookup(this.#keys, prevailing)(beat));
  }

  /**
   * The key every beat of the timeline is read against.
   *
   * A lookup rather than one key, so a timeline that modulates has each chord
   * analyzed in the key it sounds in; beats outside every region fall back to
   * the prevailing key.
   */
  #keyContext(): (beat: number) => KeyScale {
    const prevailing = prevailingKeyOf(this.#keys);
    if (prevailing === null) {
      throw new InvalidInputError(
        'timeline carries no key; build it from notes, or pass a key to Timeline.fromChords',
      );
    }
    // The pitch classes alone: a numeral and a cadence are read from which
    // notes are in the key, not from how the key is written.
    const keyAt = keyLookup(this.#keys, prevailing);
    return (beat) => scaleOf(keyAt(beat));
  }

  /** Move every chord and every key region by the same step. */
  #moved(moveChord: (chord: Chord) => Chord, moveKey: (key: Key) => Key): Timeline {
    const segments = this.#segments.map((segment) => ({
      startBeat: segment.startBeat,
      endBeat: segment.endBeat,
      chord: moveChord(new ChordClass(segment.chord)).toJSON(),
    }));
    const keys = this.#keys.map((region) => {
      const moved: KeyRegion = {
        ...region,
        key: keyIdentity(moveKey(toKey(region.key))),
      };
      if (region.pivot !== undefined) {
        // The numerals a pivot carries are degrees, so they survive the move;
        // only the chord they name has to travel with the keys.
        moved.pivot = {
          ...region.pivot,
          chord: moveChord(new ChordClass(region.pivot.chord)).toJSON(),
        };
      }
      return moved;
    });
    const data: TimelineData = { segments, totalBeats: this.#totalBeats, keys };
    // Transposition moves the chords without re-reading them, so each segment
    // is exactly as well attested where it lands as where it came from.
    if (this.#segmentConfidence.length > 0) {
      data.segmentConfidence = [...this.#segmentConfidence];
    }
    return new Timeline(data);
  }
}
