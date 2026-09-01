import type { ChordTimeline } from '../analyze/timeline/index.js';
import { InvalidInputError } from '../core/errors/index.js';
import type { InstrumentProfile, InstrumentProfileLike } from '../core/instrument/profile.js';
import { toStringedProfile } from '../core/instrument/profile.js';
import type { MeterLike, MeterMap, TimeSignature } from '../core/meter/index.js';
import { beatsPerBar, meterAt, resolveMeters, toMeterData } from '../core/meter/index.js';
import type { PositionalRng } from '../core/random/index.js';
import type { KeyScale } from '../core/types.js';
import { assertFiniteNumber } from '../core/validation/index.js';
import type { BassLineOptions, BassSegment } from '../generate/bass/index.js';
import { generateBassLine } from '../generate/bass/index.js';
import type { Complexity, GenerationContext } from '../generate/context/index.js';
import { resolveContext } from '../generate/context/index.js';
import type { CounterMelodyOptions } from '../generate/countermelody/index.js';
import { generateCounterMelody } from '../generate/countermelody/index.js';
import type { DrumsOptions } from '../generate/drums/index.js';
import { generateDrums } from '../generate/drums/index.js';
import type { HarmonizeOptions } from '../generate/harmonize/index.js';
import { harmonizeMelody } from '../generate/harmonize/index.js';
import type { ProgressionOptions } from '../generate/progression/index.js';
import { generateProgression } from '../generate/progression/index.js';
import type { Vocabulary } from '../generate/vocabulary/types.js';
import type { ChordSpan } from '../theory/chord/index.js';
import type { KeyLike } from '../theory/scale/index.js';
import { majorKey, toKeyScale } from '../theory/scale/index.js';
import { Instrument } from './instrument.js';
import type { ScoreOptions } from './score.js';
import { Score } from './score.js';
import { assertDataObject, assertDataObjects, copyPlain, samePlain } from './shared.js';
import { Timeline } from './timeline.js';

/** The settings a composer holds and hands to every generator it drives. */
export type ComposerOptions = {
  /** The key the parts are written in. */
  key?: KeyLike;
  /** The meter, as one time signature — `'6/8'` or its data — or a map of changes. */
  meters?: MeterLike;
  /** Tempo in quarter-note beats per minute. */
  bpm?: number;
  /** The seed every part's own stream is derived from. */
  seed?: number;
  /** The complexity dials. */
  complexity?: Complexity;
  /**
   * The instrument each named part is written for, as a plain
   * {@link InstrumentProfile} or an {@link Instrument}. The settings a composer
   * hands back carry the plain form, the way a key handed in as a name comes
   * back as key/scale data.
   */
  instruments?: Record<string, InstrumentProfileLike>;
  /** Extra material the generators may draw from. */
  vocabulary?: readonly Vocabulary<unknown>[];
  /**
   * The algorithm version the parts are generated under; defaults to the
   * version this build produces. Naming it is what closes a reproduction
   * recipe: a seed alone reproduces a piece only for as long as the algorithms
   * behind it stay where they were, and a project that recorded the version it
   * was written under can ask for that version back.
   */
  algorithmVersion?: number;
  /**
   * Draw from this source instead of one derived from `seed`. Each part still
   * addresses its own namespace, so parts do not collide.
   *
   * A live handle rather than settings, so it is held by reference and left out
   * of the plain data {@link Composer.data} hands back: a source cannot be
   * written to a project file, and copying one would hand back a second stream
   * rather than the same one.
   */
  rng?: PositionalRng;
};

/**
 * How a bass line is written: what {@link BassLineOptions} asks for minus the
 * settings the composer already holds, with the instrument taken the way the
 * rest of the class API takes one.
 */
export type BassLineSettings = Omit<
  BassLineOptions,
  'segments' | 'key' | 'ts' | 'ctx' | 'instrument'
> & {
  /**
   * The instrument the line is written for, as a plain {@link StringedProfile}
   * or an {@link Instrument}. Giving one is itself the request that the line be
   * playable on it: `octave` then says where in that instrument to aim rather
   * than which absolute band to use, and where the two disagree the instrument
   * wins — a note below the lowest string comes back an octave up, the way a
   * player would take it. Leave it out for a programmed part.
   */
  instrument?: InstrumentProfileLike;
};

/**
 * How a counter line is written: what {@link CounterMelodyOptions} asks for
 * minus the settings the composer already holds, with the harmony taken the way
 * {@link Composer.bass} takes it.
 */
export type CounterMelodySettings = Omit<
  CounterMelodyOptions,
  'melody' | 'key' | 'ts' | 'ctx' | 'timeline'
> & {
  /**
   * The harmony to write against, as a {@link Timeline} or the plain chord
   * timeline the analysis layer hands out. A timeline carries its own segment
   * boundaries, so a chord change anywhere — including off the generator's
   * half-beat probe grid — is seen; prefer it over `chordAt`.
   */
  timeline?: Timeline | ChordTimeline;
};

/** What a harmonization gives back: the chords, and the melody they fit. */
export type HarmonizedMelody = {
  /** The chords, in time. */
  chords: Timeline;
  /**
   * The melody as the chords read it. Harmonizing may move the melody into the
   * key the chords are in, so this is the line that actually sounds against
   * them; the untransposed input would not.
   */
  melody: Score;
  /** How far the melody was moved, in semitones. */
  transposeSemitones: number;
};

/** The key a composer that names none writes in. */
const DEFAULT_KEY: KeyScale = majorKey(0);

/**
 * The plain chord timeline a harmony value stands for.
 *
 * Read through the public surface rather than by `instanceof`, so a timeline
 * built by a second copy of the module is followed like any other — the same
 * reading {@link Composer.bass} and {@link Motif.develop} take.
 */
function toChordTimeline(harmony: Timeline | ChordTimeline): ChordTimeline {
  return 'chordTimeline' in harmony ? harmony.chordTimeline : harmony;
}

/** The meter map a {@link ComposerOptions.meters} value names. */
function metersFrom(meters: MeterLike | undefined): MeterMap {
  if (meters === undefined) {
    return resolveMeters({}, 'composer meters');
  }
  const meter = toMeterData(meters, 'composer meters');
  return Array.isArray(meter)
    ? resolveMeters({ meters: meter }, 'composer meters')
    : resolveMeters({ ts: meter }, 'composer meters');
}

/** A copy of the dials, carrying only the ones the caller named. */
function copyComplexity(complexity: Complexity): Complexity {
  assertDataObject(complexity, 'composer complexity');
  const copy: Complexity = {};
  for (const dial of ['rhythmic', 'harmonic', 'ornament', 'difficulty'] as const) {
    const value = complexity[dial];
    if (value !== undefined) {
      copy[dial] = assertFiniteNumber(value, `composer complexity ${dial}`);
    }
  }
  return copy;
}

/** A copy of the instrument each part is written for, each one validated. */
function copyInstruments(
  instruments: Record<string, InstrumentProfileLike>,
): Record<string, InstrumentProfile> {
  assertDataObject(instruments, 'composer instruments');
  const copy: Record<string, InstrumentProfile> = {};
  for (const [part, profile] of Object.entries(instruments)) {
    // Checked and copied by the class that speaks for a profile everywhere
    // else, so a composer accepts exactly the instruments an instrument does.
    copy[part] = Instrument.of(profile).data;
  }
  return copy;
}

/**
 * A deep copy of the settings in the canonical plain form.
 *
 * A key becomes the plain key/scale every generator takes, and a bare time
 * signature the meter map the whole model layer reads, so the settings a
 * composer hands out are the settings it hands on. The meter is materialized
 * because a composer that names none is read in 4/4 exactly as one that names
 * it is; the key is not, because a composer with no key harmonizes by inferring
 * one, which is a different request from harmonizing in C major.
 *
 * The seed and the algorithm version are materialized for the same reason the
 * meter is, and it is what makes these settings a reproduction recipe: a
 * project file that recorded neither reopens under whatever the build it is
 * opened on happens to default to, which is a different piece under the same
 * name and nothing in the saved file to say so.
 */
function copyOptions(options: ComposerOptions): ComposerOptions {
  assertDataObject(options, 'composer options');
  const copy: ComposerOptions = { meters: metersFrom(options.meters) };
  if (options.key !== undefined) {
    copy.key = toKeyScale(options.key);
  }
  if (options.bpm !== undefined) {
    copy.bpm = options.bpm;
  }
  if (options.seed !== undefined) {
    copy.seed = options.seed;
  }
  if (options.algorithmVersion !== undefined) {
    copy.algorithmVersion = options.algorithmVersion;
  }
  if (options.complexity !== undefined) {
    copy.complexity = copyComplexity(options.complexity);
  }
  if (options.instruments !== undefined) {
    copy.instruments = copyInstruments(options.instruments);
  }
  if (options.vocabulary !== undefined) {
    copy.vocabulary = assertDataObjects<Vocabulary<unknown>>(
      options.vocabulary,
      'composer vocabulary',
    ).map((entry, index) => copyPlain(entry, `composer vocabulary[${index}]`));
  }
  if (options.rng !== undefined) {
    // Carried by reference: the source is a handle on a stream, and a copy of
    // it would be a second stream drawing the same numbers twice.
    copy.rng = options.rng;
  }
  // Resolved through the same resolver every generator reads the settings
  // through, so the concrete seed and version written here are the ones the
  // parts were actually drawn under rather than a second reading of the
  // defaults.
  const resolved = resolveContext(contextOf(copy));
  copy.seed = resolved.seed;
  copy.algorithmVersion = resolved.algorithmVersion;
  return copy;
}

/** The context half of a set of settings, as the generators read it. */
function contextOf(options: ComposerOptions): GenerationContext {
  const ctx: GenerationContext = {};
  if (options.seed !== undefined) {
    ctx.seed = options.seed;
  }
  if (options.algorithmVersion !== undefined) {
    ctx.algorithmVersion = options.algorithmVersion;
  }
  if (options.rng !== undefined) {
    ctx.rng = options.rng;
  }
  if (options.bpm !== undefined) {
    ctx.bpm = options.bpm;
  }
  if (options.complexity !== undefined) {
    ctx.complexity = copyComplexity(options.complexity);
  }
  if (options.instruments !== undefined) {
    ctx.instruments = copyInstruments(options.instruments);
  }
  if (options.vocabulary !== undefined) {
    ctx.vocabulary = assertDataObjects<Vocabulary<unknown>>(
      options.vocabulary,
      'composer vocabulary',
    ).map((entry, index) => copyPlain(entry, `composer vocabulary[${index}]`));
  }
  return ctx;
}

/**
 * Where a harmonized span ends.
 *
 * The melody's own end, and never before the last chord: the chords are placed
 * on a grid laid over the melody, and a timeline built to a span the last chord
 * starts on would drop that chord instead of sounding it. The last slot is as
 * long as the one before it, and a bar where there is only one.
 */
function harmonizedSpan(melodyEnd: number, chords: readonly ChordSpan[], barBeats: number): number {
  const last = chords[chords.length - 1];
  if (last === undefined) {
    return melodyEnd;
  }
  const previous = chords[chords.length - 2];
  const slot = previous === undefined ? barBeats : last.startBeat - previous.startBeat;
  return Math.max(melodyEnd, last.startBeat + slot);
}

/**
 * The settings a piece is generated under, held in one place and handed to
 * every part.
 *
 * The generation context — seed, tempo, complexity dials, instruments,
 * vocabulary — was already designed to be shared across the parts of one
 * piece, and `resolveContext(...).part(name)` already gives each part its own
 * stream from a single seed. What was missing was something to hold the shared
 * half, so callers wrote `key`, `ts`, and `ctx: { seed }` again at every call.
 * A `Composer` is that holder: set it once, and each generator inherits it.
 *
 * Every part a composer writes is scored against the composer's own meter and
 * tempo, and the pitched ones in its key, so the scores it hands back line up
 * with each other without being re-contextualized one at a time.
 *
 * Immutable like every other class here: `withSeed` and friends return a new
 * composer rather than reconfiguring this one, so a variation can be written
 * beside the original instead of replacing it.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Composer } from '@libraz/libcantus';
 * const composer = Composer.of({ key: 'C major', bpm: 96, seed: 7 });
 * composer.progression({ style: 'dance', bars: 4 }).totalBeats; // 16
 * composer.withSeed(8).data.seed; // 8
 * ```
 */
export class Composer {
  readonly #options: ComposerOptions;
  readonly #meters: MeterMap;
  readonly #key: KeyScale | undefined;

  /**
   * Wrap the settings a piece is generated under.
   *
   * @param options The shared key, meter, tempo, and context; copied, never
   *   retained.
   * @throws If the key names no key, the meter map is malformed, or the seed,
   *   tempo, dials, instruments or vocabulary carry a value the generators
   *   cannot hold.
   */
  constructor(options: ComposerOptions) {
    // The context half is checked by the resolver every generator reads it
    // through — inside `copyOptions`, which resolves the seed and the version
    // it stores — so a composer accepts exactly the seeds, tempos, dials and
    // dictionaries they accept, at the point the settings are named rather than
    // at the first part written under them.
    this.#options = copyOptions(options);
    this.#meters = metersFrom(this.#options.meters);
    this.#key = this.#options.key === undefined ? undefined : toKeyScale(this.#options.key);
  }

  /**
   * Start from a set of settings.
   *
   * @param options The shared key, meter, tempo, and context.
   * @returns The composer.
   */
  static of(options: ComposerOptions): Composer {
    return new Composer(options);
  }

  /** Rebuild a composer from the plain data {@link Composer.data} hands out. */
  static fromData(data: ComposerOptions): Composer {
    return new Composer(data);
  }

  /** Rebuild a composer from its {@link Composer.toJSON} output. */
  static fromJSON(data: ComposerOptions): Composer {
    return new Composer(data);
  }

  /** The same settings with some of them replaced. */
  with(patch: Partial<ComposerOptions>): Composer {
    return new Composer({ ...this.#options, ...patch });
  }

  /** The same settings in a different key. */
  withKey(key: KeyLike): Composer {
    return this.with({ key });
  }

  /** The same settings from a different seed. */
  withSeed(seed: number): Composer {
    return this.with({ seed });
  }

  /** The same settings at different complexity. */
  withComplexity(complexity: Complexity): Composer {
    return this.with({ complexity });
  }

  /**
   * A chord progression, in time.
   *
   * The chords are laid out one per bar of the composer's own meter, so a chord
   * change falls on a bar line of the piece and the timeline spans `bars` of it:
   * four beats each in 4/4, three in 3/4, and three in 6/8. Every other part is
   * written against that grid, and harmony that is not on it drifts further from
   * the bar line with every repeat.
   *
   * @param opts Everything the progression generator takes but the key, the
   *   meter and the context, which are the composer's.
   * @returns The chords over the beats they sound for.
   * @throws If the composer's meter changes: one chord per bar has no single bar
   *   length to be laid out on, and the chords would leave the bar lines at the
   *   first change rather than follow them.
   */
  progression(opts: Omit<ProgressionOptions, 'key' | 'ctx' | 'ts'>): Timeline {
    const key = this.#keyScale();
    const ts = this.#unchangingMeter('progression');
    const chords = generateProgression({ ...opts, key, ts, ctx: this.context });
    return Timeline.fromChords(chords, opts.bars * beatsPerBar(ts), key);
  }

  /**
   * A drum part.
   *
   * A drum onset is a note event carrying a General MIDI pitch, so the hits are
   * a score like any other and read against the composer's meter and tempo. It
   * carries no key: a kit is not in one, and naming a key here would invite the
   * pitched analyses to read the kit map as melody.
   *
   * @param opts Everything the drum generator takes but the meter and the
   *   context, which are the composer's.
   * @returns The hits, as a score.
   * @throws If the composer's meter is not 4/4 throughout, which is the only
   *   meter the drum patterns are written against: a piece that opens in 4/4
   *   and changes later has bars the patterns cannot be laid out on, so the
   *   request is refused rather than answered with 4/4 bars over the change.
   */
  drums(opts: Omit<DrumsOptions, 'ts' | 'ctx'>): Score {
    const hits = generateDrums({ ...opts, ts: this.#unchangingMeter('drums'), ctx: this.context });
    return Score.of(hits, this.#scoreOptions());
  }

  /**
   * A bass line under a harmony.
   *
   * @param source The harmony to follow: a timeline, or the chord segments one
   *   is made of.
   * @param opts Everything the bass generator takes but the segments, the key,
   *   the meter and the context; see {@link BassLineSettings}.
   * @returns The line, as a score in the composer's key.
   * @throws If the instrument names a kit, which has no strings for a bass line
   *   to be placed on.
   * @example
   * ```ts
   * import { Composer, Instrument } from '@libraz/libcantus';
   * const composer = Composer.of({ key: 'C major', seed: 3 });
   * const plan = composer.progression({ style: 'dance', bars: 2 });
   * composer.bass(plan, { style: 'pop', instrument: Instrument.bass4() }).notes.length > 0; // true
   * ```
   */
  bass(source: Timeline | readonly BassSegment[], opts?: BassLineSettings): Score {
    // Read through the public surface rather than by `instanceof`, so a
    // timeline built by a second copy of the module is followed like any other.
    const segments: readonly BassSegment[] = Array.isArray(source)
      ? (source as readonly BassSegment[])
      : (source as Timeline).segments;
    const key = this.#keyScale();
    const { instrument, ...rest } = opts ?? {};
    const notes = generateBassLine({
      ...rest,
      ...(instrument === undefined
        ? {}
        : { instrument: toStringedProfile(instrument, 'bass instrument') }),
      segments,
      key,
      ts: this.#openingMeter(),
      ctx: this.context,
    });
    return Score.of(notes, this.#scoreOptions(key));
  }

  /**
   * A second line against a melody.
   *
   * Only the melody's notes cross over; the meter, the tempo and the key the
   * line is written against are the composer's, so a counter line and the part
   * it answers are read in one context.
   *
   * The harmony crosses over the way {@link Composer.bass} takes it: a
   * {@link Timeline} or the plain chord timeline, so a caller holding the
   * class does not have to unwrap it for one of the two methods.
   *
   * @param melody The lead line to write against.
   * @param opts Everything the counter-melody generator takes but the melody,
   *   the key, the meter and the context; see {@link CounterMelodySettings}.
   * @returns The counter line, as a score in the composer's key.
   */
  counterMelody(melody: Score, opts?: CounterMelodySettings): Score {
    const key = this.#keyScale();
    const { timeline, ...rest } = opts ?? {};
    const notes = generateCounterMelody({
      ...rest,
      ...(timeline === undefined ? {} : { timeline: toChordTimeline(timeline) }),
      melody: melody.notes,
      key,
      ts: this.#openingMeter(),
      ctx: this.context,
    });
    return Score.of(notes, this.#scoreOptions(key));
  }

  /**
   * Chords under a melody, with the melody the chords read.
   *
   * A composer that names a key harmonizes in it; one that names none has the
   * key estimated from the melody, which is what the harmonizer does when it is
   * asked for chords and given nothing else.
   *
   * @param melody The melody to harmonize.
   * @param opts Everything the harmonizer takes but the melody, the key, the
   *   meter and the context.
   * @returns The chords, the melody as they read it, and the distance between
   *   that melody and the one handed in.
   * @example
   * ```ts
   * import { Composer, Score } from '@libraz/libcantus';
   * const composer = Composer.of({ key: 'C major' });
   * const melody = Score.of([{ pitch: 60, startBeat: 0, durationBeat: 4 }]);
   * composer.harmonize(melody).transposeSemitones; // 0
   * ```
   */
  harmonize(
    melody: Score,
    opts?: Omit<HarmonizeOptions, 'melody' | 'key' | 'ts' | 'ctx'>,
  ): HarmonizedMelody {
    const result = harmonizeMelody({
      ...opts,
      melody: melody.notes,
      ...(this.#key === undefined ? {} : { key: this.#key }),
      ts: this.#openingMeter(),
      ctx: this.context,
    });
    const moved = melody.transpose(result.transposeSemitones);
    const totalBeats = harmonizedSpan(
      moved.totalBeats,
      result.chords,
      beatsPerBar(this.#openingMeter()),
    );
    return {
      chords: Timeline.fromChords(result.chords, totalBeats, result.key),
      // Scored in the key the chords are in rather than the composer's: where
      // the harmonizer moved the line, that is the key it now sounds in.
      melody: Score.of(moved.notes, this.#scoreOptions(result.key)),
      transposeSemitones: result.transposeSemitones,
    };
  }

  /**
   * Whether another composer holds the same settings.
   *
   * The comparison is made through the other composer's public data, so two
   * composers built by different copies of the module still compare. Both sides
   * are projected the same way: comparing the settings held here against the
   * data the other hands out answered "different" for a composer holding a
   * source and "same" for two that draw from different ones.
   *
   * A source is compared by identity, being a handle on a stream rather than a
   * setting: two composers drawing from different sources write different
   * parts, and the numbers a source will hand out cannot be read from it.
   *
   * @param other The composer to compare.
   * @returns True when both would generate the same parts.
   */
  equals(other: Composer): boolean {
    return samePlain(this.data, other.data) && this.context.rng === other.context.rng;
  }

  /** The resolved context, for handing back to the function API. */
  get context(): GenerationContext {
    return contextOf(this.#options);
  }

  /**
   * A copy of the settings this composer holds: the seed, the resolved
   * algorithm version and the rest of the recipe, so a piece can be written
   * again from what a project file stored.
   *
   * The source a composer was handed is left out, being a live handle rather
   * than plain data; a composer built with one keeps it across
   * {@link Composer.with} and its siblings.
   */
  get data(): ComposerOptions {
    return copyOptions({ ...this.#options, rng: undefined });
  }

  /** The plain form of the settings, for `JSON.stringify`. */
  toJSON(): ComposerOptions {
    return this.data;
  }

  /** The key the parts are written in; C major where the composer names none. */
  #keyScale(): KeyScale {
    return this.#key ?? DEFAULT_KEY;
  }

  /**
   * The signature the parts are written against.
   *
   * Each generator names one time signature rather than a map, so a composer
   * whose meter changes hands over the signature its music opens on — the same
   * reading {@link Score.humanize} and its siblings take.
   */
  #openingMeter(): TimeSignature {
    return meterAt(0, this.#meters);
  }

  /**
   * The one signature a part laid out in bars is written against.
   *
   * A part that places material bar by bar has to know how long a bar is, and a
   * piece that changes meter has no one answer: the request is refused rather
   * than answered on the bar the piece opens in, which would put every bar after
   * the change somewhere the piece has no bar line.
   */
  #unchangingMeter(part: string): TimeSignature {
    if (this.#meters.length > 1) {
      throw new InvalidInputError(
        `composer ${part} needs one meter for the whole part; the composer changes meter`,
      );
    }
    return this.#openingMeter();
  }

  /** The context every score a composer hands back is read against. */
  #scoreOptions(key?: KeyLike): ScoreOptions {
    const opts: ScoreOptions = { meters: this.#meters };
    if (this.#options.bpm !== undefined) {
      opts.tempo = this.#options.bpm;
    }
    if (key !== undefined) {
      opts.key = key;
    }
    return opts;
  }
}
