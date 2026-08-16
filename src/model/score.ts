import type {
  FormSection,
  FormSectionOptions,
  Hypermeter,
  HypermeterOptions,
  Phrase,
  PhraseOptions,
} from '../analyze/form/index.js';
import type { KeyRegion, KeyTimelineOptions } from '../analyze/keys/index.js';
import type { ExtractMotifsOptions, MelodicContour, MotifData } from '../analyze/melody/index.js';
import type { ChordTimelineOptions } from '../analyze/timeline/index.js';
import type { AnalyzedNote } from '../analyze/voice/index.js';
import { InvalidInputError } from '../core/errors/index.js';
import type { NoteEventIndex, NoteEventIndexOptions } from '../core/event-index/index.js';
import type { PlayabilityReport } from '../core/instrument/playability.js';
import type { InstrumentProfile } from '../core/instrument/profile.js';
import type { BarPosition, MeterLike, MeterMap, TimeSignature } from '../core/meter/index.js';
import type { IntervalLike } from '../core/pitch/index.js';
import type { TempoMap } from '../core/tempo/index.js';
import type { NoteEvent } from '../core/types.js';
import type { GrooveTemplate, HumanizeOptions, OrnamentOptions } from '../generate/index.js';
import type { KeyLike } from '../theory/scale/index.js';
import type { Key } from './key.js';
import type { Timeline } from './timeline.js';

/** The plain form a {@link Score} hands out and is rebuilt from. */
export type ScoreData = {
  notes: NoteEvent[];
  meters: MeterMap;
  tempo: TempoMap;
};

/** How a score is built: the notes, plus the context they are read against. */
export type ScoreOptions = {
  /** The meter, as one time signature or a map of changes. */
  meters?: MeterLike;
  /** The tempo, as one bpm or a map of changes. */
  tempo?: TempoMap | number;
  /** The key the notes are read in, when it is already known. */
  key?: KeyLike;
};

/**
 * Placeholder body for a member whose implementation has not landed yet.
 *
 * The arguments are taken and dropped so a signature stays exactly what it
 * will be once the body arrives, rather than being written around the stub.
 */
function pending(member: string, ...args: unknown[]): never {
  void args;
  throw new InvalidInputError(`Score.${member} is not implemented yet`);
}

/**
 * Sounding notes with the context that gives them meaning: a meter map, a
 * tempo map, and optionally the key they are read in.
 *
 * This is the library's entry point for music that already exists. A DAW
 * plug-in, a transcription tool, or a MIDI importer holds `NoteEvent[]` before
 * it holds anything else, and every question worth asking of it — what chords
 * are these, where do the phrases end, what key is this — took a separate
 * function and a hand-wired chain of intermediate results. A `Score` carries
 * the notes and their context together, so each question is one call and the
 * answers stay in the class API.
 *
 * @category Class API
 */
export class Score {
  readonly #data: ScoreData;

  /**
   * Wrap plain score data.
   *
   * @param data The notes and their context; copied, never retained.
   */
  constructor(data: ScoreData) {
    this.#data = data;
  }

  /**
   * Build a score from note events.
   *
   * @param notes The sounding notes, in any order.
   * @param opts The meter, tempo, and key to read them against.
   * @returns The score.
   */
  static of(notes: readonly NoteEvent[], opts?: ScoreOptions): Score {
    return pending('of', notes, opts);
  }

  /** An empty score, for a track that has not been written yet. */
  static empty(opts?: ScoreOptions): Score {
    return pending('empty', opts);
  }

  /**
   * Read note events whose times are in ticks rather than beats.
   *
   * @param events The events, with tick-valued onsets and durations.
   * @param ppq Ticks per quarter note.
   * @param opts The meter, tempo, and key to read them against.
   * @returns The score, in beats.
   */
  static fromTicks(events: readonly NoteEvent[], ppq: number, opts?: ScoreOptions): Score {
    return pending('fromTicks', events, ppq, opts);
  }

  /** Rebuild a score from the plain data {@link Score.data} hands out. */
  static fromData(data: ScoreData): Score {
    return new Score(data);
  }

  /** Rebuild a score from its {@link Score.toJSON} output. */
  static fromJSON(data: ScoreData): Score {
    return new Score(data);
  }

  /** The sounding notes, in time order. */
  get notes(): readonly NoteEvent[] {
    return pending('notes');
  }

  /** Where the last note stops sounding. */
  get totalBeats(): number {
    return pending('totalBeats');
  }

  /** The meter map the notes are read against. */
  get meters(): MeterMap {
    return pending('meters');
  }

  /** The tempo map the notes are read against. */
  get tempo(): TempoMap {
    return pending('tempo');
  }

  /** The stretch of the score between two beats. */
  slice(fromBeat: number, toBeat: number): Score {
    return pending('slice', fromBeat, toBeat);
  }

  /** The notes this predicate keeps, with the same context. */
  filter(predicate: (note: NoteEvent, index: number) => boolean): Score {
    return pending('filter', predicate);
  }

  /** The notes this function returns, with the same context. */
  map(fn: (note: NoteEvent, index: number) => NoteEvent): Score {
    return pending('map', fn);
  }

  /** This score followed by another's notes. */
  concat(other: Score | readonly NoteEvent[]): Score {
    return pending('concat', other);
  }

  /** The score moved along the timeline. */
  shift(beats: number): Score {
    return pending('shift', beats);
  }

  /** The score moved by a number of semitones. */
  transpose(semitones: number): Score {
    return pending('transpose', semitones);
  }

  /** The score moved by a spelled interval, keeping the spelling. */
  transposeBy(interval: IntervalLike): Score {
    return pending('transposeBy', interval);
  }

  /** The same notes read against a different meter. */
  withMeters(meters: MeterLike): Score {
    return pending('withMeters', meters);
  }

  /** The same notes read against a different tempo. */
  withTempo(tempo: TempoMap | number): Score {
    return pending('withTempo', tempo);
  }

  /** The same notes read in a different key. */
  withKey(key: KeyLike): Score {
    return pending('withKey', key);
  }

  /** The notes pulled onto a grid. */
  quantize(grid: number): Score {
    return pending('quantize', grid);
  }

  /** The notes pushed off the grid the way a player would. */
  humanize(opts?: HumanizeOptions): Score {
    return pending('humanize', opts);
  }

  /** The notes with ornaments added. */
  ornament(opts?: OrnamentOptions): Score {
    return pending('ornament', opts);
  }

  /** The notes placed on a groove template's slots. */
  groove(template: GrooveTemplate): Score {
    return pending('groove', template);
  }

  /** The harmony the notes spell out, in time. */
  timeline(opts?: ChordTimelineOptions): Timeline {
    return pending('timeline', opts);
  }

  /** The key held longest across the score, when one can be read. */
  key(): Key | undefined {
    return pending('key');
  }

  /** Every key region the score passes through, in time order. */
  keys(opts?: KeyTimelineOptions): KeyRegion[] {
    return pending('keys', opts);
  }

  /** The phrases the notes fall into. */
  phrases(opts?: PhraseOptions): Phrase[] {
    return pending('phrases', opts);
  }

  /** The sections the score divides into. */
  sections(opts?: FormSectionOptions): FormSection[] {
    return pending('sections', opts);
  }

  /** The bar-level pulse above the meter. */
  hypermeter(opts?: HypermeterOptions): Hypermeter {
    return pending('hypermeter', opts);
  }

  /** The motifs the melody repeats. */
  motifs(opts?: ExtractMotifsOptions): MotifData[] {
    return pending('motifs', opts);
  }

  /** The shape the melody traces. */
  contour(): MelodicContour {
    return pending('contour');
  }

  /** Each note's role in the harmony sounding under it. */
  voices(key?: KeyLike): AnalyzedNote[] {
    return pending('voices', key);
  }

  /** Whether an instrument can play the score, and what makes it hard. */
  playability(instrument: InstrumentProfile): PlayabilityReport {
    return pending('playability', instrument);
  }

  /** An index for repeated lookups over the notes. */
  index(opts?: NoteEventIndexOptions): NoteEventIndex {
    return pending('index', opts);
  }

  /** Where a beat falls in seconds, read through the tempo map. */
  secondsAt(beat: number): number {
    return pending('secondsAt', beat);
  }

  /** Where a beat falls in bars, read through the meter map. */
  barAt(beat: number): BarPosition {
    return pending('barAt', beat);
  }

  /** The time signature sounding at a beat. */
  meterAt(beat: number): TimeSignature {
    return pending('meterAt', beat);
  }

  /** Whether another score holds the same notes in the same context. */
  equals(other: Score): boolean {
    return pending('equals', other);
  }

  /** A copy of the underlying plain data. */
  get data(): ScoreData {
    return pending('data');
  }

  /** The plain form of the score, for `JSON.stringify`. */
  toJSON(): ScoreData {
    return this.data;
  }
}
