import { InvalidInputError } from '../core/errors/index.js';
import type { InstrumentProfile } from '../core/instrument/profile.js';
import type { MeterLike, MeterMap, TimeSignature } from '../core/meter/index.js';
import { beatsPerBar, meterAt, resolveMeters } from '../core/meter/index.js';
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
import { samePlain } from './shared.js';
import { Timeline } from './timeline.js';

/** The settings a composer holds and hands to every generator it drives. */
export type ComposerOptions = {
  /** The key the parts are written in. */
  key?: KeyLike;
  /** The meter, as one time signature or a map of changes. */
  meters?: MeterLike;
  /** Tempo in quarter-note beats per minute. */
  bpm?: number;
  /** The seed every part's own stream is derived from. */
  seed?: number;
  /** The complexity dials. */
  complexity?: Complexity;
  /** The instrument each named part is written for. */
  instruments?: Record<string, InstrumentProfile>;
  /** Extra material the generators may draw from. */
  vocabulary?: readonly Vocabulary<unknown>[];
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

/**
 * Beats of one progression bar.
 *
 * {@link generateProgression} lays out one chord per four-beat bar whatever
 * meter the rest of the piece is in, so the span its chords cover is counted
 * against that bar and not against the composer's own.
 */
const PROGRESSION_BAR_BEATS = 4;

/** The key a composer that names none writes in. */
const DEFAULT_KEY: KeyScale = majorKey(0);

/**
 * A deep copy of caller data, with every number checked and every absent field
 * left out.
 *
 * The vocabulary a composer carries holds a `material` of whatever shape the
 * figure is made of, and an instrument profile is a plain record too, so the
 * only way to promise that nothing non-finite reaches a generator — or survives
 * a round trip through a project file — is to walk the value. Dropping
 * `undefined` properties is what keeps the copy equal to its own JSON.
 */
function copyPlain<T>(value: T, name: string): T {
  if (typeof value === 'number') {
    return assertFiniteNumber(value, name) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => copyPlain(item, `${name}[${index}]`)) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) {
        copy[key] = copyPlain(item, `${name}.${key}`);
      }
    }
    return copy as T;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new InvalidInputError(`${name} must be plain data; received ${typeof value}`);
  }
  return value;
}

/** The meter map a {@link ComposerOptions.meters} value names. */
function metersFrom(meters: MeterLike | undefined): MeterMap {
  if (meters === undefined) {
    return resolveMeters({}, 'composer meters');
  }
  return Array.isArray(meters)
    ? resolveMeters({ meters }, 'composer meters')
    : resolveMeters({ ts: meters }, 'composer meters');
}

/** A copy of the dials, carrying only the ones the caller named. */
function copyComplexity(complexity: Complexity): Complexity {
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
  instruments: Record<string, InstrumentProfile>,
): Record<string, InstrumentProfile> {
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
 */
function copyOptions(options: ComposerOptions): ComposerOptions {
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
  if (options.complexity !== undefined) {
    copy.complexity = copyComplexity(options.complexity);
  }
  if (options.instruments !== undefined) {
    copy.instruments = copyInstruments(options.instruments);
  }
  if (options.vocabulary !== undefined) {
    copy.vocabulary = options.vocabulary.map((entry, index) =>
      copyPlain(entry, `composer vocabulary[${index}]`),
    );
  }
  return copy;
}

/** The context half of a set of settings, as the generators read it. */
function contextOf(options: ComposerOptions): GenerationContext {
  const ctx: GenerationContext = {};
  if (options.seed !== undefined) {
    ctx.seed = options.seed;
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
    ctx.vocabulary = options.vocabulary.map((entry) => copyPlain(entry, 'composer vocabulary'));
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
    this.#options = copyOptions(options);
    // The context half is checked by the resolver every generator reads it
    // through, so a composer accepts exactly the seeds, tempos, dials and
    // dictionaries they accept — at the point the settings are named rather
    // than at the first part written under them.
    resolveContext(contextOf(this.#options));
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
   * The chords are laid out one per four-beat bar, which is the grid
   * {@link generateProgression} writes on whatever meter the composer holds, so
   * the timeline spans `bars` of four beats and carries the composer's key.
   *
   * @param opts Everything the progression generator takes but the key and the
   *   context, which are the composer's.
   * @returns The chords over the beats they sound for.
   */
  progression(opts: Omit<ProgressionOptions, 'key' | 'ctx'>): Timeline {
    const key = this.#keyScale();
    const chords = generateProgression({ ...opts, key, ctx: this.context });
    return Timeline.fromChords(chords, opts.bars * PROGRESSION_BAR_BEATS, key);
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
   * @throws If the composer's meter is not 4/4, which is the only meter the
   *   drum patterns are written against.
   */
  drums(opts: Omit<DrumsOptions, 'ts' | 'ctx'>): Score {
    const hits = generateDrums({ ...opts, ts: this.#openingMeter(), ctx: this.context });
    return Score.of(hits, this.#scoreOptions());
  }

  /**
   * A bass line under a harmony.
   *
   * @param source The harmony to follow: a timeline, or the chord segments one
   *   is made of.
   * @param opts Everything the bass generator takes but the segments, the key,
   *   the meter and the context.
   * @returns The line, as a score in the composer's key.
   */
  bass(
    source: Timeline | readonly BassSegment[],
    opts?: Omit<BassLineOptions, 'segments' | 'key' | 'ts' | 'ctx'>,
  ): Score {
    // Read through the public surface rather than by `instanceof`, so a
    // timeline built by a second copy of the module is followed like any other.
    const segments: readonly BassSegment[] = Array.isArray(source)
      ? (source as readonly BassSegment[])
      : (source as Timeline).segments;
    const key = this.#keyScale();
    const notes = generateBassLine({
      ...opts,
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
   * @param melody The lead line to write against.
   * @param opts Everything the counter-melody generator takes but the melody,
   *   the key, the meter and the context.
   * @returns The counter line, as a score in the composer's key.
   */
  counterMelody(
    melody: Score,
    opts?: Omit<CounterMelodyOptions, 'melody' | 'key' | 'ts' | 'ctx'>,
  ): Score {
    const key = this.#keyScale();
    const notes = generateCounterMelody({
      ...opts,
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
   * import { Composer } from '@libraz/libcantus';
   * import { Score } from '../../src/model/score.js';
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
   * composers built by different copies of the module still compare.
   *
   * @param other The composer to compare.
   * @returns True when both would generate the same parts.
   */
  equals(other: Composer): boolean {
    return samePlain(this.#options, other.data);
  }

  /** The resolved context, for handing back to the function API. */
  get context(): GenerationContext {
    return contextOf(this.#options);
  }

  /** A copy of the settings this composer holds. */
  get data(): ComposerOptions {
    return copyOptions(this.#options);
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

  /** The context every score a composer hands back is read against. */
  #scoreOptions(key?: KeyScale): ScoreOptions {
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
