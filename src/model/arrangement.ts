import type {
  ArrangementAnalysis,
  ArrangementOptions,
  ArrangementSession,
  ArrangementTrack,
  Conflict,
  TensionPoint,
  TrackEdit,
} from '../analyze/arrange/index.js';
import {
  analyzeArrangement,
  createArrangementSession,
  tensionCurveFrom,
  trackRoleOf,
} from '../analyze/arrange/index.js';
import type { KeyRegion } from '../analyze/keys/index.js';
import type { ChordTimeline } from '../analyze/timeline/index.js';
import type { MeterLike, MeterMap } from '../core/meter/index.js';
import { resolveMeters, toMeterData } from '../core/meter/index.js';
import type { NoteEvent } from '../core/types.js';
import { assertInteger, assertPositiveInt, assertRange } from '../core/validation/index.js';
import type { ChordSegment } from '../theory/chord/index.js';
import { NoteSafety } from '../theory/safety/index.js';
import type { KeyLike } from '../theory/scale/index.js';
import { resolveKey } from '../theory/scale/index.js';
import type { ScoreOptions } from './score.js';
import { Score } from './score.js';
import {
  assertDataArray,
  assertDataObject,
  assertDataObjects,
  assertNoteEventArray,
  copyNoteEvent,
  copyPlain,
  samePlain,
  spanEnd,
} from './shared.js';
import { Timeline } from './timeline.js';

/**
 * The options an arrangement is read under, in the plain form
 * {@link Arrangement.data} carries them.
 *
 * Everything {@link analyzeArrangement} accepts, except that the harmony a
 * caller supplies is held as chord segments: a {@link ChordTimeline} carries a
 * lookup function, and no serialization can hold one.
 */
export type ArrangementSettings = Omit<ArrangementOptions, 'timeline'> & {
  /**
   * Chord segments to analyse against, instead of inferring the harmony from
   * the notes.
   */
  timeline?: ChordSegment[];
};

/**
 * How an arrangement is built: the settings it is read under, with the key
 * named any way the library names one and the harmony given as the timeline
 * the analysis functions take.
 */
export type ArrangementSetup = Omit<ArrangementSettings, 'key' | 'meters' | 'timeline'> & {
  /** The key the tracks are read in, when it is already known. */
  key?: KeyLike;
  /**
   * The meter the tracks are read against, as one time signature — `'6/8'` or
   * its data — or as the map of a piece that changes meter. Naming it here and
   * as `ts` too is an input error, since the two name the same thing.
   */
  meters?: MeterLike;
  /**
   * A chord timeline to analyse against, instead of inferring one from the
   * notes.
   */
  timeline?: ChordTimeline;
};

/** How an arrangement's tension is sampled: its settings, plus the step. */
export type ArrangementTensionOptions = ArrangementSetup & {
  /** Distance between samples in beats. */
  step?: number;
};

/** The plain form an {@link Arrangement} hands out and is rebuilt from. */
export type ArrangementData = {
  /**
   * The tracks, in the order they were given.
   *
   * The order is the caller's and is kept: an annotation and a conflict both
   * report the index a note had in the array it arrived in, so reordering the
   * notes here would make those indices point at other notes.
   */
  tracks: ArrangementTrack[];
  /** The options the tracks are read under; absent when they are all defaults. */
  settings?: ArrangementSettings;
};

/**
 * A track's notes checked and copied, in the order they were given.
 *
 * Zero-length notes are accepted, as they are everywhere on the analysis side:
 * a MIDI import carries them, and the analysis drops them itself.
 *
 * The array is checked as a whole before it is copied, under the budget the
 * settings name where they name one: a track the analysis would refuse for its
 * size is refused as it is taken on, rather than being stored and refused at
 * every reading afterwards.
 */
function copyNotes(notes: readonly NoteEvent[], name: string, budget?: number): NoteEvent[] {
  return assertNoteEventArray(notes, name, { allowNonPositiveDuration: true, budget }).map(
    copyNoteEvent,
  );
}

/**
 * Defensive copy of one track, its notes and its role checked as they are
 * copied.
 *
 * The role is checked here as well as on the analysis side, since this is the
 * boundary a project file crosses: a role outside the table would be stored,
 * handed back by {@link Arrangement.tracks} as a {@link TrackRole}, and read as
 * pitched material by the harmony inference.
 */
function copyTrack(track: ArrangementTrack, index: number, budget?: number): ArrangementTrack {
  assertDataObject(track, `tracks[${index}]`);
  const copy: ArrangementTrack = {
    notes: copyNotes(track.notes, `tracks[${index}].notes`, budget),
  };
  if (track.name !== undefined) {
    copy.name = track.name;
  }
  if (track.role !== undefined) {
    copy.role = trackRoleOf(track.role, `tracks[${index}].role`);
  }
  return copy;
}

/**
 * Key regions validated and copied by the class that owns the shape.
 *
 * A region carries a key, a confidence and a pivot chord, all of which
 * {@link Timeline} already refuses to hold a nonsensical value for; checking
 * them again here would be a second reading of the same rules.
 */
function copyKeyRegions(keys: readonly KeyRegion[]): KeyRegion[] {
  const given = assertDataObjects<KeyRegion>(keys, 'arrangement keys');
  return [...new Timeline({ segments: [], totalBeats: 0, keys: [...given] }).keys];
}

/** Chord segments validated and copied by the class that owns the shape. */
function copySegments(segments: readonly ChordSegment[]): ChordSegment[] {
  const given = assertDataObjects<ChordSegment>(segments, 'arrangement timeline');
  return [...new Timeline({ segments: [...given], totalBeats: spanEnd(given) }).segments];
}

/** The `{ at, segments }` shape the analysis functions take, over segments. */
function chordTimelineOf(segments: readonly ChordSegment[]): ChordTimeline {
  return new Timeline({ segments: [...segments], totalBeats: spanEnd(segments) }).chordTimeline;
}

/**
 * Defensive copy of the settings, with every part validated.
 *
 * This is the boundary a project file or a hand-edited JSON crosses, so each
 * numeric option is checked here under the name it carries rather than
 * wherever the analysis first reads it — an option the analysis only consults
 * on one of its paths is checked on all of them.
 *
 * @param settings The settings as they arrived.
 * @param trackCount How many tracks they are read against.
 * @returns The copy, or undefined when nothing was set.
 * @throws If an option carries a value the analysis cannot hold.
 */
function copySettings(
  settings: ArrangementSettings | undefined,
  trackCount: number,
): ArrangementSettings | undefined {
  if (settings === undefined) {
    return undefined;
  }
  assertDataObject(settings, 'arrangement settings');
  const copy: ArrangementSettings = {};
  // The meter is read through the same resolver every meter-aware entry point
  // reads its options through, so an arrangement accepts exactly what they
  // accept and naming both `ts` and `meters` is the error it always was.
  const meters = resolveMeters({ ts: settings.ts, meters: settings.meters }, 'arrangement meters');
  if (settings.ts !== undefined) {
    // Resolved before it is copied, as `meters` is below: a value that stands
    // for a meter rather than being one — a `Meter` instance — carries the
    // signature behind a method, so copying it as it arrived stores `{}` and
    // the stored arrangement can no longer be read back.
    copy.ts = copyPlain(toMeterData(settings.ts, 'arrangement ts'), 'arrangement ts');
  }
  if (settings.meters !== undefined) {
    copy.meters = copyPlain(meters, 'arrangement meters');
  }
  if (settings.key !== undefined) {
    copy.key = resolveKey(settings.key);
  }
  if (settings.keys !== undefined) {
    copy.keys = copyKeyRegions(settings.keys);
  }
  if (settings.timeline !== undefined) {
    copy.timeline = copySegments(settings.timeline);
  }
  if (settings.harmonyTracks !== undefined) {
    copy.harmonyTracks = assertDataArray<number>(
      settings.harmonyTracks,
      'arrangement harmonyTracks',
    ).map((track, index) =>
      assertInteger(track, `arrangement harmonyTracks[${index}]`, 0, trackCount - 1),
    );
  }
  if (settings.minSeverity !== undefined) {
    copy.minSeverity = assertInteger(
      settings.minSeverity,
      'arrangement minSeverity',
      NoteSafety.Safe,
      NoteSafety.Dissonant,
    );
  }
  if (settings.pickupBeats !== undefined) {
    copy.pickupBeats = assertRange(
      settings.pickupBeats,
      0,
      Number.MAX_SAFE_INTEGER,
      'arrangement pickupBeats',
    );
  }
  if (settings.harmonicRhythm !== undefined) {
    copy.harmonicRhythm = assertRange(
      settings.harmonicRhythm,
      Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER,
      'arrangement harmonicRhythm',
    );
  }
  if (settings.profile !== undefined) {
    copy.profile = settings.profile;
  }
  if (settings.budget !== undefined) {
    copy.budget = assertPositiveInt(settings.budget, 'arrangement budget', Number.MAX_SAFE_INTEGER);
  }
  return Object.keys(copy).length === 0 ? undefined : copy;
}

/** Defensive copy of plain arrangement data, with every part validated. */
function copyArrangement(data: ArrangementData): ArrangementData {
  assertDataObject(data, 'arrangement data');
  // The budget is read before the tracks are copied so that the notes are held
  // to the bound the settings name; a value that names no budget is refused by
  // the same check, and again by `copySettings` under its own name.
  const budget = data.settings?.budget;
  const tracks = assertDataArray<ArrangementTrack>(data.tracks, 'arrangement tracks').map(
    (track, index) => copyTrack(track, index, budget),
  );
  const settings = copySettings(data.settings, tracks.length);
  return settings === undefined ? { tracks } : { tracks, settings };
}

/** The plain data a set of tracks and settings describe. */
function arrangementData(
  tracks: readonly ArrangementTrack[],
  settings: ArrangementSettings | undefined,
): ArrangementData {
  const data: ArrangementData = {
    tracks: [...assertDataArray<ArrangementTrack>(tracks, 'tracks')],
  };
  if (settings !== undefined) {
    data.settings = settings;
  }
  return data;
}

/** The meter map an {@link ArrangementSetup.meters} value names. */
function metersFrom(meters: MeterLike): MeterMap {
  const meter = toMeterData(meters, 'arrangement meters');
  return Array.isArray(meter)
    ? resolveMeters({ meters: meter }, 'arrangement meters')
    : resolveMeters({ ts: meter }, 'arrangement meters');
}

/** The settings a caller's setup describes, in the plain form data carries. */
function settingsFrom(setup: ArrangementSetup | undefined): ArrangementSettings | undefined {
  if (setup === undefined) {
    return undefined;
  }
  assertDataObject(setup, 'arrangement options');
  const { key, meters, timeline, ...rest } = setup;
  const settings: ArrangementSettings = { ...rest };
  if (key !== undefined) {
    settings.key = resolveKey(key);
  }
  if (meters !== undefined) {
    settings.meters = metersFrom(meters);
  }
  if (timeline !== undefined) {
    assertDataObject(timeline, 'arrangement timeline');
    settings.timeline = [
      ...assertDataArray<ChordSegment>(timeline.segments, 'arrangement timeline segments'),
    ];
  }
  return settings;
}

/** A caller's setup as the analysis functions take it: the key and the meter differ. */
function analysisOptionsOf(
  setup: ArrangementTensionOptions | undefined,
): ArrangementOptions & { step?: number } {
  if (setup === undefined) {
    return {};
  }
  assertDataObject(setup, 'arrangement options');
  const { key, meters, ...rest } = setup;
  const opts: ArrangementOptions & { step?: number } = { ...rest };
  if (key !== undefined) {
    opts.key = resolveKey(key);
  }
  if (meters !== undefined) {
    opts.meters = metersFrom(meters);
  }
  return opts;
}

/**
 * Several named tracks read together, with the analysis of how they fit.
 *
 * One harmony is inferred from every pitched track pooled together, each track
 * is annotated against it, and the notes that clash with the chord sounding
 * beneath them are collected as conflicts — the whole of
 * {@link analyzeArrangement}, held as a value instead of as a call whose
 * result a caller has to carry alongside the notes it was made from.
 *
 * The analysis is held open across edits: {@link Arrangement.update} works out
 * which beats an edit could have reached and recomputes those, so a host that
 * re-analyses on every keystroke pays for the beats that changed. The
 * arrangement it returns is a new one — an arrangement never changes, so the
 * reading taken before an edit stays valid and a host can keep it for undo.
 *
 * A member that has another class to answer with answers with it:
 * {@link Arrangement.track} hands back a {@link Score} and
 * {@link Arrangement.timeline} a {@link Timeline}, so a caller stays in the
 * class API rather than being handed the arrays behind it.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Arrangement } from '@libraz/libcantus';
 * const arrangement = Arrangement.of([
 *   { name: 'melody', role: 'melody', notes: [{ pitch: 72, startBeat: 0, durationBeat: 4 }] },
 *   { name: 'bass', role: 'bass', notes: [{ pitch: 48, startBeat: 0, durationBeat: 4 }] },
 * ]);
 * arrangement.track('melody')?.totalBeats; // 4
 * ```
 */
export class Arrangement {
  readonly #data: ArrangementData;
  /**
   * The open analysis, made on first read and then kept.
   *
   * Deferred rather than made in the constructor: rebuilding an arrangement
   * from stored data, or reading the tracks back out of one, asks nothing of
   * the analysis, and an update hands its own analysis to the arrangement it
   * returns rather than having it made twice.
   */
  #open: ArrangementSession | undefined;

  /**
   * Wrap plain arrangement data.
   *
   * @param data The tracks and the settings they are read under; copied, never
   *   retained.
   * @throws If a note, the meter, or one of the settings carries a value the
   *   analysis cannot hold.
   */
  constructor(data: ArrangementData) {
    this.#data = copyArrangement(data);
  }

  /**
   * Build an arrangement from tracks.
   *
   * A track carrying no name is named for its position — `'track 1'`,
   * `'track 2'` — which is the name the analysis reports for it, and the name
   * {@link Arrangement.track} finds it under. A track carrying no role plays
   * `'other'`; only `'drums'` changes the analysis, whose pitches name
   * instruments rather than harmony and are kept out of the inferred key and
   * chords.
   *
   * @param tracks The tracks, in the order the caller holds them.
   * @param opts The key, meter, harmony and budget to read them under; see
   *   {@link ArrangementSetup}.
   * @returns The arrangement.
   * @example
   * ```ts
   * import { Arrangement } from '@libraz/libcantus';
   * const arrangement = Arrangement.of(
   *   [{ name: 'lead', notes: [{ pitch: 60, startBeat: 0, durationBeat: 4 }] }],
   *   { key: 'C major' },
   * );
   * arrangement.tracks.length; // 1
   * ```
   */
  static of(tracks: readonly ArrangementTrack[], opts?: ArrangementSetup): Arrangement {
    return new Arrangement(arrangementData(tracks, settingsFrom(opts)));
  }

  /** Rebuild an arrangement from the plain data {@link Arrangement.data} hands out. */
  static fromData(data: ArrangementData): Arrangement {
    return new Arrangement(data);
  }

  /** Rebuild an arrangement from its {@link Arrangement.toJSON} output. */
  static fromJSON(data: ArrangementData): Arrangement {
    return new Arrangement(data);
  }

  /** The tracks as they were given, in that order. */
  get tracks(): readonly ArrangementTrack[] {
    return copyPlain(this.#data.tracks, 'arrangement tracks');
  }

  /**
   * The reading of the whole arrangement: the key regions, the harmony, the
   * cadences, each track's annotated notes, and the conflicts.
   *
   * @returns The analysis {@link analyzeArrangement} makes of these tracks.
   */
  get analysis(): ArrangementAnalysis {
    const { timeline, ...rest } = this.#session().analysis;
    return { ...copyPlain(rest, 'arrangement analysis'), timeline: this.timeline().chordTimeline };
  }

  /**
   * The notes clashing with the harmony sounding beneath them, worst severity
   * first.
   *
   * Every ordinary non-chord tone — a passing note, a neighbour, a prepared
   * suspension — is unsafe against the chord under it by definition, so this
   * is a report rather than a fault list; each conflict carries the note's
   * labels to tell those apart.
   */
  get conflicts(): Conflict[] {
    return copyPlain(this.#session().analysis.conflicts, 'arrangement conflicts');
  }

  /**
   * One track's notes as a score, or undefined when no track carries the name.
   *
   * The score is read against the arrangement's meter, and against its key
   * when the arrangement was given one; the harmony the tracks spell out
   * together is what {@link Arrangement.analysis} and
   * {@link Arrangement.timeline} report, since a track read on its own is not
   * read against what sounds beneath it. A score holds its notes in time
   * order, which is not necessarily the order this track's notes arrived in.
   *
   * @param name The track's name, as the analysis reports it.
   * @returns The score, or undefined.
   */
  track(name: string): Score | undefined {
    const index = this.#session().analysis.tracks.findIndex((track) => track.name === name);
    const track = index < 0 ? undefined : this.#data.tracks[index];
    return track === undefined ? undefined : Score.of(track.notes, this.#scoreOptions());
  }

  /**
   * Re-analyse after replacing the notes of one or more tracks.
   *
   * The analysis is not made again from nothing: the open reading works out
   * which beats the edit could have reached, recomputes those, and carries the
   * rest over, and the arrangement returned takes that analysis on. What it
   * reports is what a fresh {@link Arrangement.of} over the edited tracks
   * reports — the same segments, keys, cadences, annotations and conflicts;
   * only the work differs.
   *
   * @param edits The tracks whose notes changed, each with the notes it holds
   *   after the edit.
   * @returns A new arrangement over the edited tracks; this one is unchanged.
   * @throws If an edit names no track of this arrangement, or carries a note
   *   the analysis cannot read.
   * @example
   * ```ts
   * import { Arrangement } from '@libraz/libcantus';
   * const arrangement = Arrangement.of([
   *   { name: 'lead', notes: [{ pitch: 60, startBeat: 0, durationBeat: 4 }] },
   * ]);
   * const moved = arrangement.update([
   *   { trackIndex: 0, notes: [{ pitch: 62, startBeat: 0, durationBeat: 4 }] },
   * ]);
   * moved.tracks[0]?.notes[0]?.pitch; // 62
   * arrangement.tracks[0]?.notes[0]?.pitch; // 60
   * ```
   */
  update(edits: readonly TrackEdit[]): Arrangement {
    // The reading keeps the arrays it is handed, so it is handed copies: an
    // arrangement must not be reachable through an array a caller still holds.
    const copied: TrackEdit[] = [];
    for (let index = 0; index < edits.length; index += 1) {
      const edit = edits[index];
      if (edit === undefined) {
        continue;
      }
      copied.push({
        trackIndex: edit.trackIndex,
        notes: copyNotes(edit.notes, `edits[${index}].notes`, this.#data.settings?.budget),
      });
    }
    const session = this.#session().update(copied);
    const next = new Arrangement(arrangementData(session.tracks, this.#data.settings));
    next.#adopt(session);
    return next;
  }

  /**
   * The harmonic tension across the arrangement, sampled at regular beats.
   *
   * The harmony is the one the arrangement already found, so the curve and the
   * annotations describe the same chords rather than two readings of the same
   * notes.
   *
   * Naming a key, its regions, or the tracks the harmony is read from asks for
   * a harmony this arrangement did not find, so the curve is read under the one
   * named rather than over the one it holds.
   *
   * @param opts The sampling step, and any setting to lay over the
   *   arrangement's own; a meter named here replaces the arrangement's, since
   *   `ts` and `meters` name the same thing.
   * @returns One tension reading per sampled beat, in beat order.
   */
  tension(opts?: ArrangementTensionOptions): TensionPoint[] {
    return tensionCurveFrom(
      [...this.#data.tracks],
      this.#session().analysis,
      this.#layered(analysisOptionsOf(opts)),
    );
  }

  /**
   * The whole reading of the arrangement in one call, made afresh.
   *
   * {@link Arrangement.analysis} answers the same question about the
   * arrangement as it stands, and is the member to reach for: it is made once
   * and kept across edits. This one runs {@link analyzeArrangement} again over
   * the same tracks under settings laid on top of the arrangement's own, which
   * is what a caller narrowing the conflict list, restricting the harmony to a
   * few tracks, or reading the piece against a key it does not carry wants —
   * without building a second arrangement to hold that reading.
   *
   * @param opts Any setting to lay over the arrangement's own; a meter named
   *   here replaces the arrangement's, since `ts` and `meters` name the same
   *   thing.
   * @returns The inferred harmony, per-track annotations, cadences, and
   *   conflicts.
   * @throws If a setting carries a value the analysis cannot hold, or the
   *   tracks exceed the budget.
   */
  analyze(opts?: ArrangementSetup): ArrangementAnalysis {
    return analyzeArrangement([...this.#data.tracks], this.#layered(analysisOptionsOf(opts)));
  }

  /**
   * The harmony the tracks spell out together, in time.
   *
   * @returns The inferred timeline, carrying the key regions the analysis
   *   found under it.
   */
  timeline(): Timeline {
    const { timeline, keys } = this.#session().analysis;
    return Timeline.fromData({
      segments: [...timeline.segments],
      // The analysis reports where the chords and the keys end rather than the
      // span it ran over, so the span is read back off them.
      totalBeats: spanEnd(timeline.segments, keys),
      keys: [...keys],
    });
  }

  /**
   * Whether another arrangement holds the same tracks under the same settings.
   *
   * The comparison is made through the other arrangement's public data, so two
   * arrangements built by different copies of the module still compare. The
   * analysis is not compared: it is what these tracks and these settings
   * produce, so two arrangements agreeing on both agree on it.
   *
   * @param other The arrangement to compare.
   * @returns True when the tracks and the settings match.
   */
  equals(other: Arrangement): boolean {
    return samePlain(this.#data, other.data);
  }

  /** A copy of the underlying plain data. */
  get data(): ArrangementData {
    return copyPlain(this.#data, 'arrangement data');
  }

  /** The plain form of the arrangement, for `JSON.stringify`. */
  toJSON(): ArrangementData {
    return this.data;
  }

  /** The open reading, analysing the tracks on the first call. */
  #session(): ArrangementSession {
    const open =
      this.#open ?? createArrangementSession([...this.#data.tracks], this.#analysisOptions());
    this.#open = open;
    return open;
  }

  /**
   * Take on an analysis an update has already made.
   *
   * Private to the class rather than to the instance, which is what lets an
   * update hand its incremental reading to the arrangement it returns instead
   * of that arrangement making the same reading again.
   */
  #adopt(session: ArrangementSession): void {
    this.#open = session;
  }

  /** The stored settings as the options the analysis functions take. */
  #analysisOptions(): ArrangementOptions {
    const settings = this.#data.settings;
    if (settings === undefined) {
      return {};
    }
    const { timeline, ...rest } = settings;
    return timeline === undefined ? { ...rest } : { ...rest, timeline: chordTimelineOf(timeline) };
  }

  /**
   * The arrangement's own options with a caller's laid over them.
   *
   * A meter named by the caller replaces the arrangement's rather than joining
   * it: `ts` and `meters` name the same thing, and carrying one of each is the
   * input error the resolver refuses.
   */
  #layered<T extends ArrangementOptions>(theirs: T): T & ArrangementOptions {
    const mine = this.#analysisOptions();
    const { ts, meters, ...withoutMeter } = mine;
    const inherited = theirs.ts === undefined && theirs.meters === undefined ? mine : withoutMeter;
    return { ...inherited, ...theirs };
  }

  /** The context one track's notes are read as a score against. */
  #scoreOptions(): ScoreOptions {
    const settings = this.#data.settings;
    const opts: ScoreOptions = {};
    if (settings?.meters !== undefined) {
      opts.meters = settings.meters;
    } else if (settings?.ts !== undefined) {
      opts.meters = settings.ts;
    }
    if (settings?.key !== undefined) {
      opts.key = settings.key;
    }
    return opts;
  }
}
