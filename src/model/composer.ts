import { InvalidInputError } from '../core/errors/index.js';
import type { InstrumentProfile } from '../core/instrument/profile.js';
import type { MeterLike } from '../core/meter/index.js';
import type { BassSegment, BassStyle } from '../generate/bass/index.js';
import type { Complexity, GenerationContextInput } from '../generate/context/index.js';
import type { CounterMelodyOptions } from '../generate/countermelody/index.js';
import type { DrumRole, GrooveStyle, Section } from '../generate/drums/index.js';
import type { HarmonizeOptions } from '../generate/harmonize/index.js';
import type { ProgStyle } from '../generate/progression/index.js';
import type { Vocabulary } from '../generate/vocabulary/types.js';
import type { KeyLike } from '../theory/scale/index.js';
import type { Score } from './score.js';
import type { Timeline } from './timeline.js';

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
 * Placeholder body for a member whose implementation has not landed yet.
 *
 * The arguments are taken and dropped so a signature stays exactly what it
 * will be once the body arrives, rather than being written around the stub.
 */
function pending(member: string, ...args: unknown[]): never {
  void args;
  throw new InvalidInputError(`Composer.${member} is not implemented yet`);
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
 * Immutable like every other class here: `withSeed` and friends return a new
 * composer rather than reconfiguring this one, so a variation can be written
 * beside the original instead of replacing it.
 *
 * @category Class API
 */
export class Composer {
  readonly #options: ComposerOptions;

  /**
   * Wrap the settings a piece is generated under.
   *
   * @param options The shared key, meter, tempo, and context.
   */
  constructor(options: ComposerOptions) {
    this.#options = options;
  }

  /**
   * Start from a set of settings.
   *
   * @param options The shared key, meter, tempo, and context.
   * @returns The composer.
   */
  static of(options: ComposerOptions): Composer {
    return pending('of', options);
  }

  /** The same settings with some of them replaced. */
  with(patch: Partial<ComposerOptions>): Composer {
    return pending('with', patch);
  }

  /** The same settings in a different key. */
  withKey(key: KeyLike): Composer {
    return pending('withKey', key);
  }

  /** The same settings from a different seed. */
  withSeed(seed: number): Composer {
    return pending('withSeed', seed);
  }

  /** The same settings at different complexity. */
  withComplexity(complexity: Complexity): Composer {
    return pending('withComplexity', complexity);
  }

  /** A chord progression, in time. */
  progression(opts: { style: ProgStyle; bars: number; presetId?: string }): Timeline {
    return pending('progression', opts);
  }

  /** A drum part. */
  drums(opts: { bars: number; style: GrooveStyle; section: Section; role?: DrumRole }): Score {
    return pending('drums', opts);
  }

  /** A bass line under a harmony. */
  bass(
    source: Timeline | readonly BassSegment[],
    opts?: { style?: BassStyle; octave?: number },
  ): Score {
    return pending('bass', source, opts);
  }

  /** A second line against a melody. */
  counterMelody(melody: Score, opts?: Omit<CounterMelodyOptions, 'melody'>): Score {
    return pending('counterMelody', melody, opts);
  }

  /** Chords under a melody, with the melody the chords read. */
  harmonize(melody: Score, opts?: Omit<HarmonizeOptions, 'melody'>): HarmonizedMelody {
    return pending('harmonize', melody, opts);
  }

  /** The resolved context, for handing back to the function API. */
  get context(): GenerationContextInput {
    return pending('context');
  }

  /** A copy of the settings this composer holds. */
  get data(): ComposerOptions {
    return { ...this.#options };
  }

  /** The plain form of the settings, for `JSON.stringify`. */
  toJSON(): ComposerOptions {
    return this.data;
  }
}
