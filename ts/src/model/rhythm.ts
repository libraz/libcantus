import type { MeterLike, TimeSignature } from '../core/meter/index.js';
import { meterAt, toMeterData } from '../core/meter/index.js';
import { assertRange } from '../core/validation/index.js';
import type {
  DeformOptions,
  GenerationContextInput,
  GridEvent,
  RhythmEvent,
  RhythmOptions,
} from '../generate/index.js';
import {
  deform,
  doubleTime,
  generateRhythm,
  halfTime,
  ornamentBy,
  resolveContext,
  rhythmDensity,
  rhythmToNoteEvents,
  STEP_BEATS,
  syncopate,
  thin,
  withinCeiling,
} from '../generate/index.js';
import { Score } from './score.js';
import {
  assertDataArray,
  assertDataObject,
  assertDataObjects,
  copyTimeSignature,
  withoutNegativeZero,
} from './shared.js';

/** The plain form a {@link Rhythm} hands out and is rebuilt from. */
export type RhythmData = {
  /** The onsets, in time order, measured in quarter-note beats. */
  events: RhythmEvent[];
  /** The meter the onsets are counted in. */
  ts: TimeSignature;
};

/** What {@link Rhythm.deform} does to a pattern beyond what the dials say. */
export type RhythmDeformOptions = {
  /**
   * Stretch or compress the pattern before the dials are applied, as
   * {@link DeformOptions.rate} does.
   */
  rate?: 'straight' | 'half' | 'double';
  /**
   * Which onsets count as decoration, for the ornament dial. A rhythm carries
   * no dynamics of its own, so what counts is the caller's reading of where the
   * onsets fall.
   */
  isOrnament?: (event: RhythmEvent) => boolean;
};

/**
 * The loudness every onset enters the sixteenth grid at.
 *
 * The transforms play an added note softer than the one it follows, which is a
 * statement about dynamics; a rhythm is onsets alone, so they all enter alike
 * and the scaling is dropped again on the way back.
 */
const GRID_VELOCITY = 1;

/** The part name the pattern's draws are addressed under, as the generator's are. */
const PART = 'rhythm';

/** A grid onset that remembers the pattern onset it was built from. */
type SourcedGridEvent = GridEvent & { source: RhythmEvent };

/** Defensive copy of one onset, checked as it is copied. */
function copyEvent(event: RhythmEvent, name: string): RhythmEvent {
  return {
    position: withoutNegativeZero(
      assertRange(event.position, 0, Number.MAX_SAFE_INTEGER, `${name}.position`),
    ),
    duration: withoutNegativeZero(
      assertRange(event.duration, 0, Number.MAX_SAFE_INTEGER, `${name}.duration`),
    ),
  };
}

/**
 * The onsets checked and copied, in time order.
 *
 * A rhythm is asked what falls where rather than what arrived first, so the
 * order is settled here: every transform below, and every `equals` between two
 * patterns holding the same onsets, then reads the same sequence.
 */
function copyEvents(events: readonly RhythmEvent[], name: string): RhythmEvent[] {
  return assertDataObjects<RhythmEvent>(events, name)
    .map((event, index) => copyEvent(event, `${name}[${index}]`))
    .sort((a, b) => a.position - b.position || a.duration - b.duration);
}

/** Defensive copy of plain rhythm data, with every part validated. */
function copyRhythm(data: RhythmData): RhythmData {
  assertDataObject(data, 'rhythm data');
  return {
    events: copyEvents(data.events, 'rhythm events'),
    ts: copyTimeSignature(data.ts, 'rhythm ts'),
  };
}

/** Where the pattern stops: the furthest point any onset sounds to. */
function spanOf(events: readonly RhythmEvent[]): number {
  return events.reduce((end, event) => Math.max(end, event.position + event.duration), 0);
}

/**
 * The pattern's onsets on the sixteenth grid the transforms are written for.
 *
 * A position that is not a whole sixteenth — a triplet, anything generated at
 * another subdivision — keeps its exact place and is read as the off-grid, and
 * so weakest, position it is.
 */
function toGrid(events: readonly RhythmEvent[]): SourcedGridEvent[] {
  return events.map((event) => ({
    step: event.position / STEP_BEATS,
    velocity: GRID_VELOCITY,
    source: event,
  }));
}

/**
 * The onsets a transform returned, read back as a pattern over the same span.
 *
 * Durations are re-read from the onsets rather than carried through the
 * transform, exactly as the generator writes them: each onset sounds until the
 * next, and the last to the end of the span the pattern covered before the
 * transform. Two onsets landing on one position are one onset, since a rhythm
 * has nothing to tell them apart with.
 */
function fromGrid(events: readonly GridEvent[], spanBeats: number): RhythmEvent[] {
  const positions = [...new Set(events.map((event) => event.step * STEP_BEATS))].sort(
    (a, b) => a - b,
  );
  return positions.map((position, index) => ({
    position,
    duration: (positions[index + 1] ?? spanBeats) - position,
  }));
}

/**
 * A pattern of onsets over a meter, and the transformations that reshape one.
 *
 * The library generates a rhythm as a bare array and deforms one with a family
 * of functions — thinning, syncopating, halving and doubling the rate — that
 * each take an array and hand one back. They are shaped to chain and cannot:
 * every step has to name the pattern again, and the meter it is counted in
 * travels beside it by hand. A `Rhythm` holds the two together, so the family
 * reads as the chain it always was.
 *
 * The transformations are written against a sixteenth grid, so the onsets are
 * converted to it and read back afterwards. A rhythm carries no dynamics, and
 * the softer stroke a transform gives an added note is not part of what comes
 * back.
 *
 * @category Class API
 * @example
 * ```ts
 * import { parseTimeSignature } from '@libraz/libcantus';
 * import { Rhythm } from '@libraz/libcantus';
 * const rhythm = Rhythm.generate(parseTimeSignature('4/4'), { ctx: { seed: 42 } });
 * rhythm.syncopate(0.3).toScore(38).notes.length >= rhythm.events.length; // true
 * ```
 */
export class Rhythm {
  readonly #data: RhythmData;

  /**
   * Wrap plain rhythm data.
   *
   * @param data The onsets and the meter they are counted in; copied, never
   *   retained.
   * @throws If an onset or the meter carries a value a pattern cannot hold.
   */
  constructor(data: RhythmData) {
    this.#data = copyRhythm(data);
  }

  /**
   * Generate a pattern over a meter.
   *
   * @param ts The time signature the bars are counted in, in any form that
   *   names one; a meter map is read as the signature it opens in.
   * @param opts Length, grid resolution and the context; see
   *   {@link RhythmOptions}. The context's `complexity.rhythmic` is the onset
   *   density, and its `seed` fixes which grid slots are taken.
   * @returns The generated pattern.
   * @example
   * ```ts
   * import { Rhythm } from '@libraz/libcantus';
   * const rhythm = Rhythm.generate('4/4', {
   *   bars: 2,
   *   ctx: { seed: 7, complexity: { rhythmic: 0.6 } },
   * });
   * rhythm.totalBeats; // 8
   * ```
   */
  static generate(ts: MeterLike, opts?: RhythmOptions): Rhythm {
    // Read once, here: the pattern and the meter it is counted in are stored
    // together, so both sides read the signature the caller named.
    const meter = meterAt(0, toMeterData(ts, 'ts'));
    return new Rhythm({ events: generateRhythm(meter, opts), ts: meter });
  }

  /**
   * Build a pattern from onsets that already exist.
   *
   * The meter is asked for rather than assumed. A pattern in 6/8 read as 4/4
   * answers every metric question — which beats are strong, where the bars
   * fall, how dense it is — on the wrong pulse, and nothing downstream can tell
   * that reading from a meter the caller meant. Its two siblings,
   * {@link Rhythm.generate} and `generateRhythm`, ask for it the same way.
   *
   * @param events The onsets, in any order.
   * @param ts The meter they are counted in, in any form that names one.
   * @returns The pattern.
   * @throws If the meter names no signature, or an onset carries a value a
   *   pattern cannot hold.
   */
  static of(events: readonly RhythmEvent[], ts: MeterLike): Rhythm {
    return new Rhythm({
      events: [...assertDataArray<RhythmEvent>(events, 'rhythm events')],
      ts: meterAt(0, toMeterData(ts, 'ts')),
    });
  }

  /** Rebuild a pattern from the plain data {@link Rhythm.data} hands out. */
  static fromData(data: RhythmData): Rhythm {
    return new Rhythm(data);
  }

  /** Rebuild a pattern from its {@link Rhythm.toJSON} output. */
  static fromJSON(data: RhythmData): Rhythm {
    return new Rhythm(data);
  }

  /** The onsets, in time order. */
  get events(): RhythmEvent[] {
    return this.#data.events.map((event) => ({ ...event }));
  }

  /** The meter the onsets are counted in. */
  get ts(): TimeSignature {
    return copyTimeSignature(this.#data.ts, 'rhythm ts');
  }

  /** Where the pattern stops: the furthest point any onset sounds to. */
  get totalBeats(): number {
    return spanOf(this.#data.events);
  }

  /** A copy of the underlying plain data. */
  get data(): RhythmData {
    return {
      events: this.#data.events.map((event) => ({ ...event })),
      ts: copyTimeSignature(this.#data.ts, 'rhythm ts'),
    };
  }

  /**
   * How busy the pattern is: the mean number of onsets per bar.
   *
   * @returns The onset count divided by the number of bars it spans.
   */
  density(): number {
    return rhythmDensity(this.#data.events, this.#data.ts);
  }

  /**
   * Drop the onsets carrying the least of the metre.
   *
   * The metre is the pattern's own: the ranks are read from {@link Rhythm.ts},
   * so a pattern in 6/8 keeps its dotted-quarter pulses and one in 3/4 keeps its
   * three-beat downbeats rather than the beats a four-beat bar would have.
   *
   * @param amount How much to thin, in [0, 1]; at 0 nothing goes, and a full
   *   turn leaves the downbeats alone.
   * @returns The thinned pattern.
   * @throws If the amount is outside [0, 1].
   */
  thin(amount: number): Rhythm {
    return this.#withGrid(thin(toGrid(this.#data.events), amount, this.#data.ts));
  }

  /**
   * Anticipate beats, one sixteenth early.
   *
   * The beats anticipated are the ones {@link Rhythm.ts} counts as main pulses
   * or stronger, so a pattern is not syncopated against accents its own meter
   * does not have. The anticipations are added rather than displaced, so raising
   * the amount only ever adds onsets and the ones already sounding stay where
   * they are.
   *
   * @param amount How much syncopation, in [0, 1].
   * @param ctx The context, or the seed alone; it fixes which beats are
   *   anticipated.
   * @returns The syncopated pattern.
   * @throws If the amount is outside [0, 1].
   */
  syncopate(amount: number, ctx?: GenerationContextInput): Rhythm {
    return this.#withGrid(
      syncopate(
        toGrid(this.#data.events),
        { amount, ts: this.#data.ts },
        resolveContext(ctx).part(PART),
      ),
    );
  }

  /**
   * Compress the pattern to half its length and play it twice.
   *
   * The span is the pattern's own, so it stays as full as it was.
   *
   * @returns The compressed pattern.
   */
  doubleTime(): Rhythm {
    return this.#withGrid(doubleTime(toGrid(this.#data.events), this.#spanSteps()));
  }

  /**
   * Stretch the pattern to twice its length: everything falls half as often.
   *
   * Onsets stretched past the span are dropped, since the span is the span
   * however the pattern is felt.
   *
   * @returns The stretched pattern.
   */
  halfTime(): Rhythm {
    return this.#withGrid(halfTime(toGrid(this.#data.events), this.#spanSteps()));
  }

  /**
   * Keep as much decoration as the ornament dial asks for.
   *
   * Each decorated onset survives on its own draw, so raising the amount brings
   * more of them back without disturbing the ones already sounding. Onsets the
   * predicate does not claim are untouched.
   *
   * @param isOrnament Which onsets count as decoration.
   * @param amount The ornament dial, in [0, 1].
   * @param ctx The context, or the seed alone; it fixes which decoration stays.
   * @returns The pattern with the surviving decoration.
   * @throws If the amount is outside [0, 1].
   */
  ornamentBy(
    isOrnament: (event: RhythmEvent) => boolean,
    amount: number,
    ctx?: GenerationContextInput,
  ): Rhythm {
    return this.#withGrid(
      ornamentBy(
        toGrid(this.#data.events),
        (grid) => isOrnament(grid.source),
        amount,
        resolveContext(ctx).part(PART),
      ),
    );
  }

  /**
   * Apply the complexity dials to the pattern in one pass.
   *
   * The dials are read from the context, which is where they live for every
   * generator: `complexity.rhythmic` below its neutral middle thins the pattern
   * and above it syncopates, and `complexity.ornament` decides how much of what
   * `isOrnament` claims survives. The span the rate is measured against is the
   * pattern's own.
   *
   * @param opts The rate, and which onsets are decoration; see
   *   {@link RhythmDeformOptions}.
   * @param ctx The context, or the seed alone; it carries the dials.
   * @returns The deformed pattern.
   * @throws If a dial is outside [0, 1].
   */
  deform(opts?: RhythmDeformOptions, ctx?: GenerationContextInput): Rhythm {
    const resolved = resolveContext(ctx);
    const isOrnament = opts?.isOrnament;
    const options: DeformOptions = {
      rhythmic: resolved.rhythmic,
      ornament: resolved.ornament,
      rate: opts?.rate,
      spanSteps: this.#spanSteps(),
      ts: this.#data.ts,
      // The transform hands the predicate the events it was given, which carry
      // the onset each was built from; the parameter is declared over the bare
      // grid event the rule reads, so the field is named back here.
      isOrnament:
        isOrnament === undefined
          ? undefined
          : (grid) => isOrnament((grid as SourcedGridEvent).source),
    };
    return this.#withGrid(deform(toGrid(this.#data.events), options, resolved.part(PART)));
  }

  /**
   * Whether one player can sustain the pattern at the context's tempo.
   *
   * The ceiling is measured against the closest pair of onsets, which is what
   * actually stops a hand. A context naming no tempo or no ceiling has nothing
   * to measure against, and the pattern passes.
   *
   * @param ctx The context, or the seed alone; its `bpm` and its
   *   `complexity.difficulty` are what the answer is read from.
   * @returns True when the pattern is inside the ceiling.
   */
  withinCeiling(ctx?: GenerationContextInput): boolean {
    const resolved = resolveContext(ctx);
    return withinCeiling(toGrid(this.#data.events), resolved.bpm, resolved.difficulty);
  }

  /**
   * The pattern as sounding notes at one pitch, in its own meter.
   *
   * This is where a rhythm reaches the rest of the class API: the score it
   * hands back can be humanized, grooved, analysed, or written out like any
   * other line.
   *
   * @param pitch The MIDI pitch to give every onset.
   * @param velocity Velocity for every onset; a mezzo-forte 96 by default.
   * @returns The score holding the pattern.
   * @throws If the pitch or the velocity is not a whole MIDI value in [0, 127];
   *   both are the numbers a note event carries, and a fractional one is not a
   *   note anything downstream can sound.
   * @example
   * ```ts
   * import { parseTimeSignature } from '@libraz/libcantus';
   * import { Rhythm } from '@libraz/libcantus';
   * const score = Rhythm.generate(parseTimeSignature('4/4')).toScore(38);
   * score.notes.every((note) => note.pitch === 38); // true
   * ```
   */
  toScore(pitch: number, velocity?: number): Score {
    return Score.of(rhythmToNoteEvents(this.#data.events, pitch, velocity), {
      meters: this.#data.ts,
    });
  }

  /**
   * Whether another pattern holds the same onsets in the same meter.
   *
   * The comparison is made through the other pattern's public data, so two
   * patterns built by different copies of the module still compare.
   *
   * @param other The pattern to compare.
   * @returns True when the onsets and the meter match.
   */
  equals(other: Rhythm): boolean {
    const theirs = other.data;
    const mine = this.#data;
    return (
      mine.events.length === theirs.events.length &&
      mine.events.every((event, index) => sameEvent(event, theirs.events[index])) &&
      sameSignature(mine.ts, theirs.ts)
    );
  }

  /** The plain form of the pattern, for `JSON.stringify`. */
  toJSON(): RhythmData {
    return this.data;
  }

  /** The pattern's span as a count of sixteenths, for the transforms. */
  #spanSteps(): number {
    return spanOf(this.#data.events) / STEP_BEATS;
  }

  /** The same meter carrying the onsets a transform returned. */
  #withGrid(events: readonly GridEvent[]): Rhythm {
    return new Rhythm({
      events: fromGrid(events, spanOf(this.#data.events)),
      ts: this.#data.ts,
    });
  }
}

/** Whether two onsets fall at the same place for the same length. */
function sameEvent(event: RhythmEvent, other: RhythmEvent | undefined): boolean {
  return (
    other !== undefined && event.position === other.position && event.duration === other.duration
  );
}

/** Whether two signatures name the same meter, grouping included. */
function sameSignature(ts: TimeSignature, other: TimeSignature): boolean {
  const grouping = ts.grouping ?? [];
  const theirs = other.grouping ?? [];
  return (
    ts.numerator === other.numerator &&
    ts.denominator === other.denominator &&
    grouping.length === theirs.length &&
    grouping.every((entry, index) => entry === theirs[index])
  );
}
