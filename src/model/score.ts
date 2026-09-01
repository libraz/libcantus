import { analyzePolyphony } from '../analyze/arrange/index.js';
import type { DetectKeyOptions } from '../analyze/detect/index.js';
import { detectKeyFromNotes } from '../analyze/detect/index.js';
import type {
  FormSection,
  FormSectionOptions,
  Hypermeter,
  HypermeterOptions,
  Phrase,
  PhraseOptions,
  StructuralCadence,
} from '../analyze/form/index.js';
import {
  hypermeter,
  phrasesFromTimeline,
  sectionsFromNotes,
  structuralCadences,
} from '../analyze/form/index.js';
import type { KeyRegion, KeyTimelineOptions } from '../analyze/keys/index.js';
import { keyLookup, keyTimelineFromNotes, prevailingKeyOf } from '../analyze/keys/index.js';
import type { ExtractMotifsOptions, MelodicContour, MotifData } from '../analyze/melody/index.js';
import { extractMotifs, melodicContour } from '../analyze/melody/index.js';
import type { ChordTimeline, ChordTimelineOptions } from '../analyze/timeline/index.js';
import { chordTimelineFromNotes, detectCadences } from '../analyze/timeline/index.js';
import type { AnalyzedNote, IdentifiedVoiceNote, KeyContext } from '../analyze/voice/index.js';
import { toVoiceNotes } from '../analyze/voice/index.js';
import type { NoteEventIndex, NoteEventIndexOptions } from '../core/event-index/index.js';
import { createNoteEventIndex } from '../core/event-index/index.js';
import type { PlayabilityReport } from '../core/instrument/playability.js';
import { playability } from '../core/instrument/playability.js';
import type { InstrumentProfile, InstrumentProfileLike } from '../core/instrument/profile.js';
import { toInstrumentProfile } from '../core/instrument/profile.js';
import type { BarPosition, MeterLike, MeterMap, TimeSignature } from '../core/meter/index.js';
import { beatToBarPosition, meterAt, resolveMeters, toMeterData } from '../core/meter/index.js';
import type { IntervalLike } from '../core/pitch/index.js';
import { toSpelledInterval } from '../core/pitch/index.js';
import type { TempoMap } from '../core/tempo/index.js';
import { beatsToSeconds, beatsToTicks, tempoAt, ticksToBeats } from '../core/tempo/index.js';
import type { NoteEvent } from '../core/types.js';
import { assertFiniteNumber, assertNoteEvent, assertRange } from '../core/validation/index.js';
import type { GrooveTemplate, HumanizeOptions, OrnamentOptions } from '../generate/index.js';
import {
  applyGrooveTemplate,
  extractGrooveTemplate,
  humanize,
  ornament,
} from '../generate/index.js';
import type { KeyLike } from '../theory/scale/index.js';
import { scaleOf } from '../theory/scale/index.js';
import type { DetectedKeyMatch, KeyData } from './key.js';
import { detectedKeyMatch, Key, keyIdentity, toKey } from './key.js';
import {
  assertDataArray,
  assertDataObject,
  assertDataObjects,
  assertKeyArgument,
  copyNoteEvent,
  STATED_KEY_CONFIDENCE,
  withoutNegativeZero,
} from './shared.js';
import { Timeline } from './timeline.js';

/** The plain form a {@link Score} hands out and is rebuilt from. */
export type ScoreData = {
  notes: NoteEvent[];
  meters: MeterMap;
  tempo: TempoMap;
  /**
   * The key the notes are read in, when one was given. Absent on a score whose
   * key is left to be inferred, so the two states survive a round trip: a score
   * that carries no key is not one that carries C major.
   */
  key?: KeyData;
};

/** How a score is built: the notes, plus the context they are read against. */
export type ScoreOptions = {
  /** The meter, as one time signature — `'6/8'` or its data — or a map of changes. */
  meters?: MeterLike;
  /** The tempo, as one bpm or a map of changes. */
  tempo?: TempoMap | number;
  /** The key the notes are read in, when it is already known. */
  key?: KeyLike;
};

/** The tempo a score is read at when the caller names none. */
const DEFAULT_BPM = 120;

/**
 * The notes checked and copied, in time order, ties broken by pitch.
 *
 * A score is asked about beats, not about array positions, so the order is
 * settled once here: every method downstream — and every `equals` between two
 * scores holding the same music — then reads the same sequence whatever order
 * the notes arrived in.
 *
 * Each note is checked by the shared note-event guard as it is copied, since
 * copying is already note by note. Zero-length notes are accepted, as they are
 * everywhere on the analysis side: a MIDI import carries them, and the analyses
 * drop them themselves.
 */
function orderNotes(notes: readonly NoteEvent[], name: string): NoteEvent[] {
  return assertDataObjects<NoteEvent>(notes, name)
    .map((note, index) =>
      copyNoteEvent(assertNoteEvent(note, `${name}[${index}]`, { allowNonPositiveDuration: true })),
    )
    .sort(
      (a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch || a.durationBeat - b.durationBeat,
    );
}

/** Defensive copy of a meter map, with its signatures copied entry by entry. */
function copyMeters(meters: MeterMap): MeterMap {
  return assertDataObjects<MeterMap[number]>(meters, 'score meters').map((change) => {
    assertDataObject(change.ts, 'score meters ts');
    const ts: TimeSignature = {
      numerator: change.ts.numerator,
      denominator: change.ts.denominator,
    };
    if (change.ts.grouping !== undefined) {
      ts.grouping = [...change.ts.grouping];
    }
    return { startBeat: withoutNegativeZero(change.startBeat), ts };
  });
}

/**
 * Defensive copy of a tempo map, validated on the way through.
 *
 * The tempo module keeps its map validator private and runs it from every
 * entry point, so the map is checked by reading the tempo at its own origin:
 * a non-finite bpm, an unsorted entry or an empty map is refused here rather
 * than at the first conversion a caller happens to ask for.
 */
function copyTempo(tempo: TempoMap): TempoMap {
  assertDataObjects<TempoMap[number]>(tempo, 'score tempo');
  tempoAt(0, tempo);
  return tempo.map((event) => ({
    startBeat: withoutNegativeZero(event.startBeat),
    bpm: event.bpm,
  }));
}

/**
 * Defensive copy of plain score data, with every part validated.
 *
 * This is the boundary a project file, a MIDI import or a hand-edited JSON
 * crosses, so the checks are the library's own: the note events, the meter map
 * and the tempo map are each rejected here if they carry a number the analysis
 * below could not hold.
 */
function copyScore(data: ScoreData): ScoreData {
  assertDataObject(data, 'score data');
  const copy: ScoreData = {
    notes: orderNotes(data.notes, 'score notes'),
    // The map is validated by the same resolver every meter-aware entry point
    // reads its options through, so a score accepts exactly what they accept.
    meters: copyMeters(resolveMeters({ meters: data.meters }, 'score meters')),
    tempo: copyTempo(data.tempo),
  };
  if (data.key !== undefined) {
    copy.key = Key.fromJSON(data.key).toJSON();
  }
  return copy;
}

/** The meter map a {@link ScoreOptions.meters} value names. */
function metersFrom(meters: MeterLike | undefined): MeterMap {
  if (meters === undefined) {
    return resolveMeters({}, 'score meters');
  }
  const meter = toMeterData(meters, 'score meters');
  return Array.isArray(meter)
    ? resolveMeters({ meters: meter }, 'score meters')
    : resolveMeters({ ts: meter }, 'score meters');
}

/** The tempo map a {@link ScoreOptions.tempo} value names. */
function tempoFrom(tempo: TempoMap | number | undefined): TempoMap {
  if (tempo === undefined) {
    return [{ startBeat: 0, bpm: DEFAULT_BPM }];
  }
  return typeof tempo === 'number' ? [{ startBeat: 0, bpm: tempo }] : tempo;
}

/**
 * The one region a stated key describes: that key, in force from where the
 * music starts to where the analyzed span ends.
 *
 * The same region the chord analysis builds for a key it was given, so a score
 * that carries a key answers with one key wherever it is asked — from
 * {@link Score.key}, from {@link Score.keys}, and from the timeline it hands
 * out. A score with nothing sounding has no region at all, since there is no
 * music for the key to be in force over.
 */
function statedKeyRegions(key: Key, notes: readonly NoteEvent[], totalBeats: number): KeyRegion[] {
  const first = notes[0];
  if (first === undefined || totalBeats <= first.startBeat) {
    return [];
  }
  return [
    {
      // The region starts where the music does, as an inferred one does, so a
      // pickup is covered by the key it sounds in.
      startBeat: first.startBeat,
      endBeat: totalBeats,
      key: keyIdentity(key),
      confidence: STATED_KEY_CONFIDENCE,
    },
  ];
}

/** The plain data a set of notes and a context describe. */
function scoreData(notes: readonly NoteEvent[], opts: ScoreOptions | undefined): ScoreData {
  const data: ScoreData = {
    notes: [...assertDataArray<NoteEvent>(notes, 'score notes')],
    meters: metersFrom(opts?.meters),
    tempo: tempoFrom(opts?.tempo),
  };
  if (opts?.key !== undefined) {
    // Read through the resolver that keeps a spelled tonic and a scale form
    // where the caller had them: a score told its key in Ab minor is not a
    // score in G# minor, and every note it spells afterwards follows.
    data.key = toKey(opts.key).toJSON();
  }
  return data;
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
 * The notes are held in time order, and their onsets are unbounded below: beat
 * 0 is the first downbeat, so a pickup sounds at a negative beat and is kept
 * there rather than being shifted onto the grid.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Score } from '@libraz/libcantus';
 * const score = Score.of([
 *   { pitch: 60, startBeat: 0, durationBeat: 2 },
 *   { pitch: 64, startBeat: 0, durationBeat: 2 },
 *   { pitch: 67, startBeat: 0, durationBeat: 2 },
 * ]);
 * score.totalBeats; // 2
 * ```
 */
export class Score {
  readonly #data: ScoreData;
  readonly #key: Key | undefined;
  /** The chord reading, made on the first member that needs it. */
  #chords: ChordTimeline | undefined;
  /** The key regions, made on the first member that needs them. */
  #regions: KeyRegion[] | undefined;

  /**
   * Wrap plain score data.
   *
   * @param data The notes and their context; copied, never retained.
   * @throws If a note, the meter map or the tempo map carries a value the
   *   analysis cannot hold.
   */
  constructor(data: ScoreData) {
    this.#data = copyScore(data);
    this.#key = this.#data.key === undefined ? undefined : Key.fromJSON(this.#data.key);
  }

  /**
   * Build a score from note events.
   *
   * A bare time signature becomes a one-entry meter map taking effect at beat
   * 0, and a bare bpm a one-entry tempo map at beat 0; a score given neither is
   * read in 4/4 at 120 bpm, which is what every meter-aware function in the
   * library assumes when its caller names nothing.
   *
   * @param notes The sounding notes, in any order.
   * @param opts The meter, tempo, and key to read them against.
   * @returns The score.
   * @example
   * ```ts
   * import { Score } from '@libraz/libcantus';
   * const score = Score.of([{ pitch: 60, startBeat: 0, durationBeat: 4 }], {
   *   meters: { numerator: 3, denominator: 4 },
   *   tempo: 90,
   * });
   * score.meterAt(0).numerator; // 3
   * ```
   */
  static of(notes: readonly NoteEvent[], opts?: ScoreOptions): Score {
    return new Score(scoreData(notes, opts));
  }

  /** An empty score, for a track that has not been written yet. */
  static empty(opts?: ScoreOptions): Score {
    return new Score(scoreData([], opts));
  }

  /**
   * Read note events whose times are in ticks rather than beats.
   *
   * Onsets and durations are converted; nothing else about the events changes.
   * A negative tick count is a pickup and stays one, since beat 0 is the first
   * downbeat at either resolution.
   *
   * @param events The events, with tick-valued onsets and durations.
   * @param ppq Ticks per quarter note.
   * @param opts The meter, tempo, and key to read them against.
   * @returns The score, in beats.
   * @example
   * ```ts
   * import { Score } from '@libraz/libcantus';
   * const score = Score.fromTicks([{ pitch: 60, startBeat: 480, durationBeat: 960 }], 480);
   * score.notes[0]?.durationBeat; // 2
   * ```
   */
  static fromTicks(events: readonly NoteEvent[], ppq: number, opts?: ScoreOptions): Score {
    const notes = assertDataObjects<NoteEvent>(events, 'score notes').map((event) => ({
      ...event,
      startBeat: ticksToBeats(event.startBeat, ppq),
      durationBeat: ticksToBeats(event.durationBeat, ppq),
    }));
    return new Score(scoreData(notes, opts));
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
    return this.#data.notes.map(copyNoteEvent);
  }

  /**
   * Where the last note stops sounding.
   *
   * Measured from beat 0 rather than from the first onset, so a score that
   * opens with a pickup reports the beat its music ends on and not its length.
   * An empty score ends at 0.
   */
  get totalBeats(): number {
    return this.#data.notes.reduce(
      (end, note) => Math.max(end, note.startBeat + note.durationBeat),
      0,
    );
  }

  /** The meter map the notes are read against. */
  get meters(): MeterMap {
    return copyMeters(this.#data.meters);
  }

  /** The tempo map the notes are read against. */
  get tempo(): TempoMap {
    return this.#data.tempo.map((event) => ({ startBeat: event.startBeat, bpm: event.bpm }));
  }

  /**
   * The stretch of the score between two beats.
   *
   * A note is kept when its onset falls in `[fromBeat, toBeat)`; the notes keep
   * their absolute onsets, so the slice stays in the score's own time and a
   * slice taken across a meter or tempo change is still read against it.
   *
   * @param fromBeat First beat of the stretch, inclusive.
   * @param toBeat End of the stretch, exclusive.
   * @returns The score holding those notes.
   */
  slice(fromBeat: number, toBeat: number): Score {
    assertFiniteNumber(fromBeat, 'slice fromBeat');
    assertFiniteNumber(toBeat, 'slice toBeat');
    return this.#withNotes(
      this.#data.notes.filter((note) => note.startBeat >= fromBeat && note.startBeat < toBeat),
    );
  }

  /** The notes this predicate keeps, with the same context. */
  filter(predicate: (note: NoteEvent, index: number) => boolean): Score {
    return this.#withNotes(
      this.#data.notes.filter((note, index) => predicate(copyNoteEvent(note), index)),
    );
  }

  /** The notes this function returns, with the same context. */
  map(fn: (note: NoteEvent, index: number) => NoteEvent): Score {
    return this.#withNotes(this.#data.notes.map((note, index) => fn(copyNoteEvent(note), index)));
  }

  /** This score followed by another's notes. */
  concat(other: Score | readonly NoteEvent[]): Score {
    // Read through the public surface rather than by `instanceof`, so a score
    // built by a second copy of the module concatenates like any other.
    const added: readonly NoteEvent[] = Array.isArray(other)
      ? (other as readonly NoteEvent[])
      : (other as Score).notes;
    return this.#withNotes([...this.#data.notes, ...added]);
  }

  /**
   * The score moved along the timeline.
   *
   * The meter and tempo maps stay where they are: they describe the bars and
   * the pulse the music is played against, and moving the notes over them is
   * how a phrase is heard a bar later. A negative shift moves music before the
   * first downbeat, which is where a pickup lives.
   *
   * @param beats How far to move, in quarter-note beats; negative moves earlier.
   * @returns The moved score.
   */
  shift(beats: number): Score {
    assertFiniteNumber(beats, 'shift beats');
    return this.#withNotes(
      this.#data.notes.map((note) => ({ ...note, startBeat: note.startBeat + beats })),
    );
  }

  /**
   * The score moved by a number of semitones.
   *
   * A carried key moves with the notes, so the score that comes back is read in
   * the key it now sounds in and every analysis taken from it — its timeline,
   * its numerals, its phrases — is taken against that key rather than against
   * the one it was written in.
   *
   * @param semitones The signed semitone offset.
   * @returns The transposed score.
   * @throws If a note would leave the MIDI range.
   */
  transpose(semitones: number): Score {
    assertFiniteNumber(semitones, 'transpose semitones');
    return this.#moved(
      this.#data.notes.map((note) => ({ ...note, pitch: note.pitch + semitones })),
      (key) => key.transpose(semitones),
    );
  }

  /**
   * The score moved by a spelled interval, keeping the spelling.
   *
   * Note events carry a MIDI pitch and no spelling of their own, so the
   * interval contributes its size and its direction; a carried key is what
   * keeps the spelling, and it moves with the notes — by the interval itself,
   * so an augmented fourth and a diminished fifth land on differently spelled
   * keys.
   *
   * @param interval An interval name (e.g. `'A4'`, `'-m3'`), plain interval
   *   data, or an {@link Interval}; a descending interval moves down.
   * @returns The transposed score.
   */
  transposeBy(interval: IntervalLike): Score {
    const step = toSpelledInterval(interval);
    return this.#moved(
      this.#data.notes.map((note) => ({ ...note, pitch: note.pitch + step.semitones })),
      // Moved by the interval rather than by its semitone count, so a key taken
      // up an augmented fourth and one taken up a diminished fifth are spelled
      // the way each interval demands.
      (key) => key.transposeBy(step),
    );
  }

  /** The same notes read against a different meter. */
  withMeters(meters: MeterLike): Score {
    return new Score({ ...this.#data, meters: metersFrom(meters) });
  }

  /** The same notes read against a different tempo. */
  withTempo(tempo: TempoMap | number): Score {
    return new Score({ ...this.#data, tempo: tempoFrom(tempo) });
  }

  /** The same notes read in a different key. */
  withKey(key: KeyLike): Score {
    return new Score({ ...this.#data, key: toKey(key).toJSON() });
  }

  /**
   * The notes pulled onto a grid.
   *
   * Onsets and durations are both snapped to the nearest multiple of the grid,
   * counted from beat 0 in both directions, so a pickup is quantized against
   * the same grid the downbeat is. A duration that would round to nothing keeps
   * one grid unit, since a note quantized out of existence is a note lost.
   *
   * @param grid The grid unit in quarter-note beats (0.25 for sixteenths).
   * @returns The quantized score.
   * @throws If the grid is not a positive length.
   * @example
   * ```ts
   * import { Score } from '@libraz/libcantus';
   * const score = Score.of([{ pitch: 60, startBeat: 0.98, durationBeat: 1.03 }]);
   * score.quantize(0.5).notes[0]?.startBeat; // 1
   * ```
   */
  quantize(grid: number): Score {
    assertRange(grid, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'quantize grid');
    return this.#withNotes(
      this.#data.notes.map((note) => ({
        ...note,
        startBeat: Math.round(note.startBeat / grid) * grid,
        durationBeat: Math.max(1, Math.round(note.durationBeat / grid)) * grid,
      })),
    );
  }

  /**
   * The notes pushed off the grid the way a player would.
   *
   * The metric accents are read from the score's opening signature, since
   * {@link HumanizeOptions} names one signature rather than a map; pass `ts`
   * to read a later stretch of a score that changes meter.
   *
   * @param opts Jitter amounts, accent depth and the seed; see
   *   {@link HumanizeOptions}.
   * @returns The humanized score.
   */
  humanize(opts?: HumanizeOptions): Score {
    return this.#withNotes(humanize(this.#data.notes, { ts: this.meterAt(0), ...opts }));
  }

  /**
   * The notes with ornaments added.
   *
   * Strong positions are read from the score's opening signature, since
   * {@link OrnamentOptions} names one signature rather than a map.
   *
   * @param opts The ornament style, how much is decorated, and the seed; see
   *   {@link OrnamentOptions}.
   * @returns The ornamented score.
   */
  ornament(opts?: OrnamentOptions): Score {
    return this.#withNotes(ornament(this.#data.notes, { ts: this.meterAt(0), ...opts }));
  }

  /**
   * The notes placed on a groove template's slots.
   *
   * The template's per-bar grid is laid out against the score's opening
   * signature, which is the signature the template must have been extracted
   * under; a template carrying a different one is refused rather than drifting.
   *
   * @param template The groove template, from `extractGrooveTemplate`.
   * @returns The score with the template's feel imposed.
   * @throws If the template was extracted under another meter.
   */
  groove(template: GrooveTemplate): Score {
    return this.#withNotes(applyGrooveTemplate(this.#data.notes, template, this.meterAt(0)));
  }

  /**
   * The feel of the score's own timing, as a template another score can take on.
   *
   * The other direction of {@link Score.groove}: a played-in take is measured
   * slot by slot for how far ahead of or behind the grid it sits and how hard
   * it is struck, and the reading is handed back as a template. Only the
   * subdivision is named, because the score already holds the meter the grid is
   * laid out against — its opening signature, which is the one the template
   * records and the one an apply-time meter is checked against.
   *
   * @param subdivision Grid steps per quarter-note beat; a sixteenth-note grid
   *   by default, which is where swing, push and drag are audible.
   * @returns The template these notes describe.
   * @throws If the subdivision is not a positive whole number.
   * @example
   * ```ts
   * import { Score } from '@libraz/libcantus';
   * const played = Score.of([{ pitch: 36, startBeat: 0.02, durationBeat: 1 }]);
   * Score.of([{ pitch: 36, startBeat: 0, durationBeat: 1 }]).groove(played.grooveTemplate());
   * ```
   */
  grooveTemplate(subdivision?: number): GrooveTemplate {
    return extractGrooveTemplate(this.#data.notes, this.meterAt(0), subdivision);
  }

  /**
   * The harmony the notes spell out, in time.
   *
   * The score's meter map and its key, when it carries one, are read against
   * unless the options name others.
   *
   * @param opts Analysis options; see {@link ChordTimelineOptions}.
   * @returns The inferred timeline, carrying the key regions the analysis found
   *   and how sure it is of each segment.
   */
  timeline(opts?: ChordTimelineOptions): Timeline {
    const result = chordTimelineFromNotes(this.#data.notes, this.#analysisOptions(opts));
    return Timeline.fromData({
      segments: result.timeline.segments,
      totalBeats: opts?.totalBeats ?? this.totalBeats,
      keys: result.keys,
      segmentConfidence: result.segmentConfidence,
    });
  }

  /**
   * The key held longest across the score, when one can be read.
   *
   * A score carrying a key answers with it. Otherwise the key regions are
   * searched for and the one holding for the most beats wins, so a piece that
   * digresses is named by the key it keeps coming back to rather than by the
   * key it opens on. A score with nothing sounding has no key at all.
   *
   * @returns The prevailing key, or undefined when nothing sounds.
   */
  key(): Key | undefined {
    if (this.#key !== undefined) {
      return this.#key;
    }
    const prevailing = prevailingKeyOf(this.#keyRegions());
    return prevailing === null ? undefined : toKey(prevailing);
  }

  /**
   * Every key region the score passes through, in time order.
   *
   * A score that was told its key answers with that key across the whole of it,
   * as {@link Score.key} and {@link Score.timeline} do: the caller has already
   * answered the question, and searching for a modulation away from a stated
   * key would make the option read as a hint where it was given as an
   * instruction. Only `totalBeats` is read from the options there, since the
   * rest tune a search that is not run.
   *
   * @param opts Analysis options; see {@link KeyTimelineOptions}.
   * @returns The regions; empty when nothing sounds.
   */
  keys(opts?: KeyTimelineOptions): KeyRegion[] {
    if (this.#key !== undefined) {
      return statedKeyRegions(this.#key, this.#data.notes, opts?.totalBeats ?? this.totalBeats);
    }
    return keyTimelineFromNotes(this.#data.notes, { meters: this.#data.meters, ...opts });
  }

  /**
   * Every key the score could be in, ranked, read as one key across the whole
   * of it.
   *
   * {@link Score.keys} divides the score into the regions it passes through;
   * this ranks the readings of the score entire, so a caller can see what the
   * winner beat and by how much. Each note counts for its duration times its
   * velocity — the measure chord inference already weighs by — so the sustained
   * harmony that establishes a key outweighs a run of ornaments over it, which
   * is what makes a score the right thing to ask rather than a bare histogram
   * of its pitches.
   *
   * @param opts Which profile to rank with, whether the church modes take part,
   *   whether each candidate explains itself, and the budget; the weights come
   *   from the notes themselves, so they are not on offer.
   * @returns The candidates, best first; empty when nothing sounds.
   * @example
   * ```ts
   * import { Score } from '@libraz/libcantus';
   * const score = Score.of([{ pitch: 60, startBeat: 0, durationBeat: 4 }]);
   * score.detectKeys()[0]?.key.rootPc; // 0
   * ```
   */
  detectKeys(opts?: Omit<DetectKeyOptions, 'weights'>): DetectedKeyMatch[] {
    return detectKeyFromNotes(this.#data.notes, opts).map(detectedKeyMatch);
  }

  /**
   * The phrases the notes fall into.
   *
   * The cadences are read from the score's own harmony, so the chord timeline
   * does not have to be built and passed in by hand.
   *
   * @param opts Analysis options; see {@link PhraseOptions}.
   * @returns The phrases, in time order.
   */
  phrases(opts?: PhraseOptions): Phrase[] {
    return phrasesFromTimeline(this.#chordTimeline(), this.#data.notes, {
      meters: this.#data.meters,
      ...(this.#key === undefined ? {} : { key: keyIdentity(this.#key) }),
      ...opts,
    });
  }

  /**
   * The cadences that close the score's phrases, ranked by how much structure
   * each one closes.
   *
   * {@link Score.phrases} says where the phrases end; this says which of those
   * endings matter. Two chords alone cannot tell the close of a piece from a
   * passing confirmation halfway through a hyperbar, and a phrase reading can,
   * because it knows what the cadence closes and where that sits. Phrases no
   * cadence closes are left out.
   *
   * @param opts How the phrases are read; see {@link PhraseOptions}.
   * @returns The cadences, heaviest first; ties keep the earlier one.
   */
  structuralCadences(opts?: PhraseOptions): StructuralCadence[] {
    return structuralCadences(this.phrases(opts));
  }

  /**
   * The sections the score divides into.
   *
   * @param opts Analysis options; see {@link FormSectionOptions}.
   * @returns The sections, in time order.
   */
  sections(opts?: FormSectionOptions): FormSection[] {
    return sectionsFromNotes(this.#data.notes, { meters: this.#data.meters, ...opts });
  }

  /**
   * The bar-level pulse above the meter.
   *
   * The cadences come from the score's own harmony unless the caller passes
   * their own, so this reads the same grouping {@link Score.phrases} builds its
   * phrases on rather than a second one that ignores where the music closes.
   *
   * @param opts Analysis options; see {@link HypermeterOptions}.
   * @returns The grouping, its downbeats, a confidence, and a rationale.
   */
  hypermeter(opts?: HypermeterOptions): Hypermeter {
    return hypermeter(this.#data.notes, this.#data.meters, {
      cadenceBeats: this.#cadenceBeats(),
      ...opts,
    });
  }

  /**
   * The motifs the melody repeats.
   *
   * The plain analysis record comes back rather than a {@link Motif}, as it
   * does from every other reader here that is not {@link Score.timeline} or
   * {@link Score.key}: a `Motif` holds a bare cell of notes, so wrapping the
   * record would drop the intervals, the rhythmic profile, every later
   * occurrence and the rationale — the findings the extraction was asked for.
   * A record is a cell, so `Motif.fromData(found)` reaches the
   * transformations without anything being rebuilt by hand.
   *
   * @param opts Cell-length bounds and the recurrence threshold; see
   *   {@link ExtractMotifsOptions}.
   * @returns The motifs found, longest first.
   * @example
   * ```ts
   * import { Motif, Score } from '@libraz/libcantus';
   * const score = Score.of([
   *   { pitch: 60, startBeat: 0, durationBeat: 1 },
   *   { pitch: 62, startBeat: 1, durationBeat: 1 },
   *   { pitch: 64, startBeat: 2, durationBeat: 1 },
   *   { pitch: 60, startBeat: 3, durationBeat: 1 },
   *   { pitch: 62, startBeat: 4, durationBeat: 1 },
   *   { pitch: 64, startBeat: 5, durationBeat: 1 },
   * ]);
   * const found = score.motifs()[0];
   * found?.occurrences.length; // 2
   * found === undefined ? undefined : Motif.fromData(found).notes.length; // 3
   * ```
   */
  motifs(opts?: ExtractMotifsOptions): MotifData[] {
    return extractMotifs(this.#data.notes, opts);
  }

  /** The shape the melody traces. */
  contour(): MelodicContour {
    return melodicContour(this.#data.notes);
  }

  /**
   * Each note's role in the harmony sounding under it.
   *
   * The chord under each note and the key it is read in both come from the
   * score: the harmony from its own chord timeline, and the key from the
   * argument, then the carried key, then the regions the analysis found. A
   * score with no readable harmony — nothing sounding, or too little to name a
   * chord — reads every note against C major and no chord at all, which labels
   * the notes as the non-chord tones they are rather than failing.
   *
   * A score holds a whole piece rather than a single line, so the notes are read
   * as the polyphony they are: each note is classified in its own voice, against
   * everything else sounding under it. That is what a suspension needs — a
   * dissonance is dissonant against something — and it is what keeps a note of
   * one voice from being heard as the passing tone of another.
   *
   * @param key The key to read the notes in, as a key name, a plain key/scale,
   *   or a {@link Key}; defaults to the score's own.
   * @returns One annotation per note, in the score's own time order.
   */
  voices(key?: KeyLike): AnalyzedNote[] {
    const timeline = this.#chordTimeline();
    return analyzePolyphony(this.#data.notes, timeline.at, this.#keyContext(key));
  }

  /**
   * The notes carrying the ids the voice analysis reports them back under.
   *
   * {@link Score.voices} answers about the notes; this hands back the notes
   * themselves with the handle each answer names, so a caller pairing an
   * annotation or a conflict with the note it describes has something to pair
   * it with. The id is the note's position in the score's own time order, which
   * is not necessarily the order the notes arrived in.
   *
   * @returns One voice note per note, in the score's own time order.
   */
  voiceNotes(): IdentifiedVoiceNote[] {
    return toVoiceNotes(this.#data.notes);
  }

  /**
   * Whether an instrument can play the score, and what makes it hard.
   *
   * The tempo the third layer needs is the score's own, read at beat 0.
   *
   * @param instrument The instrument to play it on: a plain
   *   {@link InstrumentProfile} or an {@link Instrument}.
   * @returns Difficulty, the issues found, and each note's placement.
   * @throws If the value names no instrument, or the instrument it names is
   *   contradictory.
   * @example
   * ```ts
   * import { Instrument, Score } from '@libraz/libcantus';
   * const score = Score.of([{ pitch: 27, startBeat: 0, durationBeat: 1 }]);
   * score.playability(Instrument.bass4()).issues[0]?.type; // 'noteOutOfRange'
   * ```
   */
  playability(instrument: InstrumentProfileLike): PlayabilityReport {
    return playability(
      this.#data.notes,
      toInstrumentProfile(instrument),
      tempoAt(0, this.#data.tempo),
    );
  }

  /**
   * An index for repeated lookups over the notes.
   *
   * @param opts How the events are read; see {@link NoteEventIndexOptions}.
   * @returns The index.
   */
  index(opts?: NoteEventIndexOptions): NoteEventIndex {
    return createNoteEventIndex(this.#data.notes, {
      allowNonPositiveDuration: true,
      name: 'score notes',
      ...opts,
    });
  }

  /**
   * Where a beat falls in seconds, read through the tempo map.
   *
   * Every tempo segment the span crosses is integrated, so a beat after a
   * tempo change is not the change's tempo applied to the whole span. A beat
   * inside a pickup reports negative elapsed time, at the opening tempo.
   *
   * @param beat Position in quarter-note beats.
   * @returns Elapsed seconds from the tempo map's origin.
   */
  secondsAt(beat: number): number {
    return beatsToSeconds(beat, this.#data.tempo);
  }

  /**
   * Where a beat falls in bars, read through the meter map.
   *
   * @param beat Position in quarter-note beats.
   * @returns The 0-based bar and the quarter-note offset inside it; a pickup
   *   reports bar -1.
   */
  barAt(beat: number): BarPosition {
    return beatToBarPosition(beat, this.#data.meters);
  }

  /**
   * The time signature sounding at a beat.
   *
   * @param beat Position in quarter-note beats.
   * @returns The signature in force there.
   */
  meterAt(beat: number): TimeSignature {
    return meterAt(beat, this.#data.meters);
  }

  /**
   * The score's beats as MIDI ticks, for a writer that counts in them.
   *
   * @param ppq Ticks per quarter note.
   * @returns The notes with tick-valued onsets and durations, in time order.
   */
  toTicks(ppq: number): NoteEvent[] {
    return this.#data.notes.map((note) => ({
      ...note,
      startBeat: beatsToTicks(note.startBeat, ppq),
      durationBeat: beatsToTicks(note.durationBeat, ppq),
    }));
  }

  /**
   * Whether another score holds the same notes in the same context.
   *
   * The comparison is made through the other score's public data, so two
   * scores built by different copies of the module still compare.
   *
   * @param other The score to compare.
   * @returns True when the notes, the meter, the tempo and the read key match.
   */
  equals(other: Score): boolean {
    const theirs = other.data;
    const mine = this.#data;
    return (
      mine.notes.length === theirs.notes.length &&
      mine.notes.every((note, index) => sameNote(note, theirs.notes[index])) &&
      mine.meters.length === theirs.meters.length &&
      mine.meters.every((change, index) => sameMeter(change, theirs.meters[index])) &&
      mine.tempo.length === theirs.tempo.length &&
      mine.tempo.every((event, index) => {
        const theirEvent = theirs.tempo[index];
        return (
          theirEvent !== undefined &&
          event.startBeat === theirEvent.startBeat &&
          event.bpm === theirEvent.bpm
        );
      }) &&
      sameKey(mine.key, theirs.key)
    );
  }

  /** A copy of the underlying plain data. */
  get data(): ScoreData {
    const copy: ScoreData = {
      notes: this.#data.notes.map(copyNoteEvent),
      meters: copyMeters(this.#data.meters),
      tempo: this.#data.tempo.map((event) => ({ startBeat: event.startBeat, bpm: event.bpm })),
    };
    if (this.#key !== undefined) {
      copy.key = this.#key.toJSON();
    }
    return copy;
  }

  /** The plain form of the score, for `JSON.stringify`. */
  toJSON(): ScoreData {
    return this.data;
  }

  /** The same context carrying another set of notes. */
  #withNotes(notes: readonly NoteEvent[]): Score {
    return new Score({ ...this.#data, notes: [...notes] });
  }

  /**
   * The same context carrying another set of notes, with a carried key moved
   * the same way the notes were.
   *
   * Every path that moves the pitches goes through here, so a score cannot come
   * back sounding in one key and analysed in another.
   */
  #moved(notes: readonly NoteEvent[], moveKey: (key: Key) => Key): Score {
    const data: ScoreData = { ...this.#data, notes: [...notes] };
    if (this.#key !== undefined) {
      data.key = moveKey(this.#key).toJSON();
    }
    return new Score(data);
  }

  /**
   * The chord timeline the score's own harmony describes, read once.
   *
   * Private, because the options belong to the members that expose them: the
   * analyses that read harmony read the score's, and a caller who wants
   * another builds it through {@link Score.timeline}. The reading is kept
   * because a score is immutable and this takes no options: chord inference is
   * the most expensive thing the class does, and the natural order — timeline,
   * phrases, cadences, voices — would otherwise ask for it once per member.
   */
  #chordTimeline(): ChordTimeline {
    const timeline =
      this.#chords ?? chordTimelineFromNotes(this.#data.notes, this.#analysisOptions()).timeline;
    this.#chords = timeline;
    return timeline;
  }

  /**
   * The key regions under the score: the key it was told it is in across the
   * whole of it, or the ones read from the notes against its own meter.
   *
   * Kept on first reading for the same reason the chord timeline is.
   */
  #keyRegions(): KeyRegion[] {
    const regions =
      this.#regions ??
      (this.#key === undefined
        ? keyTimelineFromNotes(this.#data.notes, { meters: this.#data.meters })
        : statedKeyRegions(this.#key, this.#data.notes, this.totalBeats));
    this.#regions = regions;
    return regions;
  }

  /** Where the score's own harmony closes, as beats. */
  #cadenceBeats(): number[] {
    return detectCadences(this.#chordTimeline(), this.#keyContext(undefined)).map(
      (hit) => hit.atBeat,
    );
  }

  /** The score's context as chord-timeline options, with the caller's on top. */
  #analysisOptions(opts?: ChordTimelineOptions): ChordTimelineOptions {
    return {
      meters: this.#data.meters,
      ...(this.#key === undefined ? {} : { key: keyIdentity(this.#key) }),
      ...opts,
    };
  }

  /**
   * The key each note is read against: the argument, then the carried key,
   * then the key in force at the beat, and C major where nothing sounds.
   */
  #keyContext(key: KeyLike | undefined): KeyContext {
    assertKeyArgument(key, 'score key');
    // One key travels whole; a key that changes over the piece is read per beat
    // and reduced to its pitch classes, since a lookup runs once per note and
    // no reading built on it asks how the key is written.
    if (key !== undefined) {
      return keyIdentity(toKey(key));
    }
    if (this.#key !== undefined) {
      return keyIdentity(this.#key);
    }
    const regions = this.#keyRegions();
    const prevailing = prevailingKeyOf(regions) ?? keyIdentity(Key.major('C'));
    const keyAt = keyLookup(regions, prevailing);
    return (beat) => scaleOf(keyAt(beat));
  }
}

/** Whether two plain note events hold the same note. */
function sameNote(note: NoteEvent, other: NoteEvent | undefined): boolean {
  return (
    other !== undefined &&
    note.pitch === other.pitch &&
    note.startBeat === other.startBeat &&
    note.durationBeat === other.durationBeat &&
    note.velocity === other.velocity &&
    note.articulation === other.articulation
  );
}

/** Whether two meter changes name the same signature at the same beat. */
function sameMeter(change: MeterMap[number], other: MeterMap[number] | undefined): boolean {
  if (other === undefined || change.startBeat !== other.startBeat) {
    return false;
  }
  const grouping = change.ts.grouping ?? [];
  const theirs = other.ts.grouping ?? [];
  return (
    change.ts.numerator === other.ts.numerator &&
    change.ts.denominator === other.ts.denominator &&
    grouping.length === theirs.length &&
    grouping.every((entry, index) => entry === theirs[index])
  );
}

/** Whether two scores were read in the same key, one having none included. */
function sameKey(key: KeyData | undefined, other: KeyData | undefined): boolean {
  if (key === undefined || other === undefined) {
    return key === other;
  }
  return Key.fromJSON(key).equals(Key.fromJSON(other));
}
