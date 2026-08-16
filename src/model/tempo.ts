import {
  beatsToSeconds,
  beatsToTicks,
  durationToSeconds,
  secondsToBeats,
  ticksToBeats,
} from '../core/tempo/index.js';
import { assertRange } from '../core/validation/index.js';

/**
 * Upper bound on a tempo, the bound the tempo module and the generators
 * accept. A faster marking is a notation of a slower pulse, not a distinct
 * tempo.
 */
const MAX_BPM = 1000;

/**
 * A constant tempo as plain data: quarter-note beats per minute.
 *
 * @category Class API
 */
export type TempoData = {
  /** Quarter-note beats per minute. */
  bpm: number;
};

/**
 * An immutable constant tempo, in quarter-note beats per minute, and the
 * conversions it settles: beats to wall-clock seconds and back, and beats to
 * MIDI ticks and back.
 *
 * One tempo, not a piece's tempo over time: a piece that changes tempo is
 * described by a tempo map, which the tempo module's own functions read.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Tempo } from '@libraz/libcantus';
 * Tempo.of(120).secondsAt(16); // 8
 * ```
 */
export class Tempo {
  readonly #bpm: number;

  private constructor(bpm: number) {
    this.#bpm = assertRange(bpm, Number.MIN_VALUE, MAX_BPM, 'bpm');
  }

  /**
   * The one-event tempo map every conversion here is measured against.
   *
   * Built on read rather than held, so nothing outside the class can reach the
   * array the conversions run over.
   */
  get #map(): readonly { startBeat: number; bpm: number }[] {
    return [{ startBeat: 0, bpm: this.#bpm }];
  }

  /**
   * Build a tempo from a beats-per-minute marking.
   *
   * @param bpm Quarter-note beats per minute.
   * @returns The tempo.
   * @throws If the marking is not a positive, finite number the library holds.
   */
  static of(bpm: number): Tempo {
    return new Tempo(bpm);
  }

  /**
   * Wrap a plain tempo value.
   *
   * @param data The plain tempo.
   * @returns The wrapped tempo.
   * @throws If the marking is not a positive, finite number the library holds.
   */
  static fromData(data: TempoData): Tempo {
    return new Tempo(data.bpm);
  }

  /**
   * Rebuild a tempo from its {@link Tempo.toJSON} output.
   *
   * @param data The serialized tempo.
   * @returns The wrapped tempo.
   * @throws If the marking is not a positive, finite number the library holds.
   */
  static fromJSON(data: TempoData): Tempo {
    return new Tempo(data.bpm);
  }

  /** Quarter-note beats per minute. */
  get bpm(): number {
    return this.#bpm;
  }

  /** A copy of the underlying plain tempo value. */
  get data(): TempoData {
    return this.toJSON();
  }

  /**
   * Wall-clock seconds from the downbeat to a position.
   *
   * A position before the downbeat reports negative elapsed time: a pickup
   * sounds before it, and asking when it sounds is a fair question.
   *
   * @param beat Position in quarter-note beats.
   * @returns Elapsed seconds, 0 at beat 0 and negative before it.
   * @throws If the position is not finite.
   */
  secondsAt(beat: number): number {
    return beatsToSeconds(beat, this.#map);
  }

  /**
   * The position reached after a number of seconds — the inverse of
   * {@link Tempo.secondsAt}.
   *
   * @param seconds Elapsed seconds from the downbeat; negative for a position
   *   before it, such as a pickup.
   * @returns The position in quarter-note beats.
   * @throws If the elapsed time is not finite.
   * @example
   * ```ts
   * import { Tempo } from '@libraz/libcantus';
   * Tempo.of(90).beatAtSeconds(4); // 6
   * ```
   */
  beatAtSeconds(seconds: number): number {
    return secondsToBeats(seconds, this.#map);
  }

  /**
   * Duration in seconds of a span of beats.
   *
   * The tempo is constant, so the span is measured from the downbeat: where it
   * begins cannot change how long it lasts.
   *
   * @param lengthBeats How long the span lasts, in quarter-note beats.
   * @returns The span's duration in seconds.
   * @throws If the length is negative or not finite.
   */
  secondsOf(lengthBeats: number): number {
    return durationToSeconds(0, lengthBeats, this.#map);
  }

  /**
   * Convert quarter-note beats to MIDI ticks, rounded to the nearest tick.
   *
   * @param beat Position or length in quarter-note beats.
   * @param ppq Pulses (ticks) per quarter note, e.g. 96, 480, or 960.
   * @returns The whole tick count, negative before the first downbeat.
   * @throws If the position is not finite or `ppq` is not a positive integer.
   */
  ticksAt(beat: number, ppq: number): number {
    return beatsToTicks(beat, ppq);
  }

  /**
   * Convert MIDI ticks to quarter-note beats.
   *
   * @param ticks Whole tick count, negative before the first downbeat.
   * @param ppq Pulses (ticks) per quarter note, e.g. 96, 480, or 960.
   * @returns The position or length in quarter-note beats.
   * @throws If `ticks` is not an integer or `ppq` is not a positive integer.
   */
  beatAtTicks(ticks: number, ppq: number): number {
    return ticksToBeats(ticks, ppq);
  }

  /**
   * Whether another tempo carries the same marking.
   *
   * @param other The tempo to compare with.
   * @returns True when both name the same beats per minute.
   */
  equals(other: Tempo): boolean {
    // The other tempo is read through its public accessor rather than its
    // private field: a bundler that emits two copies of this class — as a
    // CommonJS build without shared chunks does for the root and /model
    // entries — would otherwise throw on the brand check.
    return this.#bpm === other.bpm;
  }

  /**
   * The plain tempo value, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(tempo)` from collapsing to `{}`.
   *
   * @returns A copy of the marking.
   */
  toJSON(): TempoData {
    return { bpm: this.#bpm };
  }

  /**
   * The marking, so a template literal or a log line reads as the tempo.
   *
   * @returns The marking, e.g. `'120 bpm'`.
   */
  toString(): string {
    return `${this.#bpm} bpm`;
  }
}
