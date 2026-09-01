import { InvalidInputError } from '../../core/errors/index.js';
import { beatsPerBar, type MeterLike } from '../../core/meter/index.js';
import type { KeyScale } from '../../core/types.js';
import {
  assertDegree,
  assertGenerationBudget,
  assertOneOf,
  assertPositiveInt,
} from '../../core/validation/index.js';
import type { ChordQuality, ChordSpan } from '../../theory/chord/index.js';
import { chordQualities, diatonicTriad } from '../../theory/chord/index.js';
import { type KeyLike, scaleTonesInDegreeOrder, toKeyScale } from '../../theory/scale/index.js';
import { type GenerationContextInput, resolveContext } from '../context/index.js';

export type { ChordSpan } from '../../theory/chord/index.js';

/** The meter a progression is laid out in when the caller names none. */
const DEFAULT_TS = { numerator: 4, denominator: 4 };

/**
 * Broad production style a progression preset suits.
 *
 * @category Composition
 */
export type ProgStyle = 'minimal' | 'dance' | 'idol' | 'rock';

/**
 * Harmonic-function role of a progression as a whole.
 *
 * @category Composition
 */
export type ProgFunction = 'loop' | 'tensionBuild' | 'cadenceStrong' | 'stable';

/**
 * A named chord-progression preset expressed in scale degrees.
 *
 * @category Composition
 */
export type ProgressionPreset = {
  id: string;
  name: string;
  /**
   * The chord roots, in order, as {@link ProgressionDegree} codes: 0..6 for the
   * key's own scale degrees and {@link BORROWED_DEGREES} for the borrowed ones.
   */
  degrees: ProgressionDegree[];
  functional: ProgFunction;
  styles: ProgStyle[];
};

/**
 * The borrowed (non-diatonic) chord roots a preset can name, as their semitone
 * code for a borrowed degree. These are stable identifiers, not semitone
 * offsets: their pitch-class offsets are resolved internally.
 *
 * Scale degrees 1..7 address the key's own chords; these codes continue the
 * numbering for the chromatic chords a pop progression borrows, so a preset is
 * one flat list of degree codes.
 *
 * @example
 * ```ts
 * import { BORROWED_DEGREES, generateProgression, majorKey } from '@libraz/libcantus';
 * generateProgression({
 *   key: majorKey(0),
 *   style: 'rock',
 *   bars: 4,
 *   preset: { degrees: [1, BORROWED_DEGREES.bVII, 4, 1] },
 * });
 * ```
 * @category Composition
 */
export const BORROWED_DEGREES = Object.freeze({
  /** Flat submediant: bVI. */
  bVI: 8,
  /** Flat subtonic: bVII. */
  bVII: 10,
  /** Flat mediant: bIII. */
  bIII: 11,
  /** Minor subdominant borrowed from the parallel minor: iv. */
  iv: 12,
  /** Neapolitan: bII. */
  bII: 13,
  /** Sharp subdominant, the diminished #IV. */
  sharpIV: 14,
} as const);

/**
 * A chord root in a preset: a scale degree 1..7, or one of
 * {@link BORROWED_DEGREES}.
 *
 * @category Composition
 */
export type ProgressionDegree = number;

/**
 * Options controlling {@link generateProgression}.
 *
 * @category Composition
 */
export type ProgressionOptions = {
  /**
   * The key the degrees are resolved against; a key name such as `'C major'` is
   * read as that key.
   */
  key: KeyLike;
  /**
   * Which pool of built-in presets to choose from. Ignored when `preset` names
   * the progression outright.
   */
  style: ProgStyle;
  bars: number;
  /**
   * The meter the bars are counted in, in any form that names one; a meter map
   * is read as the signature it opens in. One chord is laid out per bar, so this
   * is what the chords are spaced by — a chord every three beats in 3/4, every
   * three in 6/8 — and a progression written against another bar length drifts
   * off the bar lines of the part it is played under.
   *
   * @defaultValue `4/4`
   */
  ts?: MeterLike;
  /** Pick a specific built-in preset by id instead of choosing one by style. */
  presetId?: string;
  /**
   * Use this progression rather than a built-in one. Only `degrees` is
   * required; see {@link BORROWED_DEGREES} for the non-diatonic codes.
   */
  preset?: Partial<ProgressionPreset> & { degrees: ProgressionDegree[] };
  ext?: ChordQuality | 'auto';
  /**
   * The generation context.
   *
   * Its `complexity.harmonic` sets how much of the progression is replaced by
   * the secondary dominant of what follows: 0 — the default — leaves it alone,
   * 0.5 takes about half of what the voice-leading rules allow, and 1 takes
   * every one of them. Its `seed` fixes both the preset choice and which chords
   * are replaced, so the same seed always yields the same progression.
   *
   * @defaultValue `{ seed: 0 }`
   */
  ctx?: GenerationContextInput;
};

const PRESETS: ProgressionPreset[] = [
  {
    id: 'fourChordPop',
    name: 'Four Chord Pop',
    degrees: [1, 5, 6, 4],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'pop1',
    name: 'Pop 1',
    degrees: [1, 6, 4, 5],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'axis',
    name: 'Axis',
    degrees: [6, 4, 1, 5],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol', 'rock'],
  },
  {
    id: 'pop2',
    name: 'Pop 2',
    degrees: [4, 1, 5, 6],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'classic',
    name: 'Classic',
    degrees: [1, 4, 5, 1],
    functional: 'cadenceStrong',
    styles: ['dance', 'idol', 'rock'],
  },
  {
    id: 'pop3',
    name: 'Pop 3',
    degrees: [1, 4, 6, 5],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'royalRoad',
    name: 'Royal Road',
    degrees: [4, 5, 3, 6],
    functional: 'tensionBuild',
    styles: ['dance', 'idol'],
  },
  {
    id: 'minor1',
    name: 'Minor 1',
    degrees: [6, 5, 4, 5],
    functional: 'tensionBuild',
    styles: ['idol', 'rock'],
  },
  {
    id: 'minor2',
    name: 'Minor 2',
    degrees: [6, 4, 5, 1],
    functional: 'tensionBuild',
    styles: ['idol', 'rock'],
  },
  {
    id: 'pop4',
    name: 'Pop 4',
    degrees: [1, 5, 3, 4],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'pop5',
    name: 'Pop 5',
    degrees: [1, 3, 4, 5],
    functional: 'stable',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'rock1',
    name: 'Rock 1',
    degrees: [1, 10, 4, 1],
    functional: 'tensionBuild',
    styles: ['rock'],
  },
  {
    id: 'rock2',
    name: 'Rock 2',
    degrees: [1, 4, 10, 1],
    functional: 'tensionBuild',
    styles: ['rock'],
  },
  {
    id: 'extended4',
    name: 'Extended 4',
    degrees: [1, 5, 6, 3],
    functional: 'stable',
    styles: ['minimal', 'dance'],
  },
  {
    id: 'minor3',
    name: 'Minor 3',
    degrees: [6, 1, 5, 4],
    functional: 'loop',
    styles: ['dance', 'idol'],
  },
  {
    id: 'aeolianPop',
    name: 'Aeolian Pop',
    degrees: [6, 8, 10, 1],
    functional: 'tensionBuild',
    styles: ['minimal', 'dance', 'idol', 'rock'],
  },
  {
    id: 'animeHighEnergy1',
    name: 'Anime High Energy 1',
    degrees: [6, 3, 4, 1],
    functional: 'loop',
    styles: ['dance', 'idol'],
  },
  {
    id: 'jazzPop',
    name: 'Jazz Pop',
    degrees: [2, 5, 1, 6],
    functional: 'cadenceStrong',
    styles: ['minimal', 'dance'],
  },
  {
    id: 'animeHighEnergy2',
    name: 'Anime High Energy 2',
    degrees: [6, 2, 5, 1],
    functional: 'cadenceStrong',
    styles: ['dance', 'idol'],
  },
  {
    id: 'cityPop',
    name: 'City Pop',
    degrees: [1, 6, 2, 5],
    functional: 'stable',
    styles: ['minimal', 'dance'],
  },
  {
    id: 'extended5',
    name: 'Extended 5',
    degrees: [1, 5, 6, 3, 4],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'neapolitanPop',
    name: 'Neapolitan Pop',
    degrees: [6, 12, 13, 5, 1],
    functional: 'cadenceStrong',
    styles: ['minimal', 'dance', 'idol'],
  },
];

/** Share of the eligible chords replaced when the caller names no dial. */
const DEFAULT_HARMONIC = 0;

/** Chromatic semitone offset from the tonic for borrowed (non-diatonic) degrees. */
const BORROWED_OFFSET: Record<number, number> = {
  [BORROWED_DEGREES.bVI]: 8,
  [BORROWED_DEGREES.bVII]: 10,
  [BORROWED_DEGREES.bIII]: 3,
  [BORROWED_DEGREES.iv]: 5,
  [BORROWED_DEGREES.bII]: 1,
  [BORROWED_DEGREES.sharpIV]: 6,
};

/**
 * All built-in progression presets.
 *
 * @category Composition
 */
export function progressions(): ProgressionPreset[] {
  return PRESETS.map((p) => ({ ...p, degrees: [...p.degrees], styles: [...p.styles] }));
}

/**
 * Presets whose style list includes the given style.
 *
 * @category Composition
 */
export function progressionsByStyle(style: ProgStyle): ProgressionPreset[] {
  return progressions().filter((p) => p.styles.includes(style));
}

/** Root pitch class of a scale degree in the given key, including borrowed degrees. */
function degreeToRootPc(degree: number, key: KeyScale): number {
  if (degree >= 1 && degree <= 7) {
    const tones = scaleTonesInDegreeOrder(key);
    return tones.length > 0
      ? (tones[(degree - 1) % tones.length] ?? key.rootPc % 12)
      : key.rootPc % 12;
  }
  const offset = BORROWED_OFFSET[degree] ?? 0;
  return ((((key.rootPc % 12) + offset) % 12) + 12) % 12;
}

/**
 * Diatonic (or borrowed) triad quality of a degree in the given key.
 *
 * Diatonic degrees (1-7) take their scale-correct triad quality, so non-major
 * keys yield diatonic chords. Borrowed degrees keep their fixed chromatic
 * qualities (`#IV` diminished, `iv` minor, the rest major).
 */
function autoQuality(degree: number, key: KeyScale, harmonicDominant: boolean): ChordQuality {
  if (degree >= 1 && degree <= 7) {
    const isMinor = ((key.modeMask12 >> 3) & 1) === 1 && ((key.modeMask12 >> 4) & 1) === 0;
    // A cadence-oriented progression needs a leading tone in minor too: use
    // the conventional harmonic-minor V rather than the natural-minor v.
    if (harmonicDominant && isMinor && degree === 5) {
      return 'maj';
    }
    return diatonicTriad(degree, key).quality;
  }
  if (degree === 14) {
    return 'dim';
  }
  if (degree === 12) {
    return 'min';
  }
  return 'maj';
}

/** One resolved step of a preset cycle, with the preset degree it came from. */
type CycleStep = { source: number; degree?: number; rootPc: number; quality: ChordQuality };

/**
 * Resolve a preset's degrees against a key, dropping any step that lands on the
 * chord already sounding.
 *
 * Presets are written in scale degrees plus a handful of chromatic borrowings
 * measured from the tonic, and the two can name the same chord: `bVI` is the
 * sixth degree of a minor key, so `vi bVI bVII I` — a major-key device — turns
 * into `bVI bVI bVII i` there, sounding one chord twice. Collapsing the repeat
 * keeps the progression moving. Only a repeat produced by *different* degrees is
 * collapsed: a preset that names the same degree twice — `I IV V I` closing on
 * its tonic — means it. The wrap from the last step back to the first is treated
 * the same way, since the cycle repeats to fill the bars.
 */
function resolveCycle(
  degrees: readonly number[],
  key: KeyScale,
  ext: ProgressionOptions['ext'],
  harmonicDominant: boolean,
): CycleStep[] {
  const steps: CycleStep[] = [];
  for (const degree of degrees) {
    const step: CycleStep = {
      source: degree,
      rootPc: degreeToRootPc(degree, key),
      quality:
        ext !== undefined && ext !== 'auto' ? ext : autoQuality(degree, key, harmonicDominant),
    };
    if (degree >= 1 && degree <= 7) {
      step.degree = degree;
    }
    const previous = steps[steps.length - 1];
    if (previous !== undefined && previous.source !== step.source && sameStep(previous, step)) {
      continue;
    }
    steps.push(step);
  }
  const first = steps[0];
  const last = steps[steps.length - 1];
  if (
    steps.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.source !== last.source &&
    sameStep(first, last)
  ) {
    steps.pop();
  }
  return steps.length > 0
    ? steps
    : [{ source: 0, degree: 0, rootPc: degreeToRootPc(0, key), quality: 'maj' }];
}

/** Whether two resolved steps name the same chord. */
function sameStep(a: CycleStep, b: CycleStep): boolean {
  return a.rootPc === b.rootPc && a.quality === b.quality;
}

/**
 * The preset {@link generateProgression} would choose for a style and seed.
 *
 * The choice is otherwise invisible: the generator returns chords, not the
 * preset it drew them from, so a caller who wants to show or reproduce it has
 * no way to name it.
 *
 * @param style The style pool to choose from.
 * @param seed The same seed the generator would be given.
 * @returns The preset that seed selects.
 * @throws If no preset claims the style.
 * @example
 * ```ts
 * import { pickProgressionPreset } from '@libraz/libcantus';
 * pickProgressionPreset('dance', 3).name;
 * ```
 * @category Composition
 */
export function pickProgressionPreset(style: ProgStyle, seed = 0): ProgressionPreset {
  // A style no preset claims is a caller error, exactly as an unknown
  // presetId is: falling back to the whole pool would answer a typo with a
  // plausible but stylistically unrelated progression.
  const pool = PRESETS.filter((preset) => preset.styles.includes(style));
  if (pool.length === 0) {
    throw new InvalidInputError(`Unknown progression style: ${style}`);
  }
  const index = resolveContext(seed)
    .part('progression')
    .range(0, pool.length - 1, 'preset');
  return pool[index] ?? (PRESETS[0] as ProgressionPreset);
}

/**
 * Generate a chord progression laid out one chord per bar.
 *
 * A preset is chosen by `presetId` when given, otherwise deterministically from
 * the presets matching `style`, seeded by the context's `seed`. An unknown
 * `presetId`, or a `style` no preset claims, is a caller error and throws rather
 * than silently falling back to a random preset. The preset's degrees cycle to
 * fill `bars`; a bar is one bar of `ts`, so `startBeat` is `barIndex` bars of
 * it — four beats apart in 4/4, three in 3/4 and in 6/8 alike. Chord
 * roots come from the key's diatonic scale-degree mapping. When `ext` is
 * omitted or `'auto'`, each chord takes its diatonic triad quality; otherwise
 * `ext` is forced on every chord — except a reharmonized chord, which is a
 * secondary dominant and is therefore always a `dom7`. With
 * `complexity.harmonic` above 0, some chords are deterministically replaced with
 * the secondary dominant (V7) of the following chord, flagged with
 * `secondaryDominant`.
 *
 * @param opts Generation options.
 * @returns One chord per bar in timeline order.
 * @throws If `presetId` matches no built-in preset, or `style` matches none.
 *
 * @example
 * ```ts
 * import { generateProgression, majorKey } from '@libraz/libcantus';
 * const chords = generateProgression({ key: majorKey(0), style: 'dance', bars: 4 });
 * // Deterministic for a given seed (defaults to 0); one ChordSpan per bar.
 * const richer = generateProgression({
 *   key: majorKey(0),
 *   style: 'dance',
 *   bars: 4,
 *   ctx: { seed: 3, complexity: { harmonic: 0.5 } },
 * });
 * // Some chords are now the secondary dominant of the chord that follows.
 * ```
 *
 * @category Composition
 */
export function generateProgression(opts: ProgressionOptions): ChordSpan[] {
  assertPositiveInt(opts.bars, 'progression bars');
  assertGenerationBudget(opts.bars, 'progression chords');
  // The key is read into its plain form once, here at the boundary; the degree
  // resolution below is given the scale it resolved to.
  const key = toKeyScale(opts.key);
  const ctx = resolveContext(opts.ctx);
  const seed = ctx.seed;
  let preset: ProgressionPreset | undefined;
  if (opts.preset !== undefined) {
    if (opts.preset.degrees.length === 0) {
      throw new InvalidInputError('progression preset must name at least one degree');
    }
    preset = {
      id: opts.preset.id ?? 'custom',
      name: opts.preset.name ?? 'Custom',
      degrees: opts.preset.degrees.map((degree, index) => {
        assertDegree(degree, `progression preset degrees[${index}]`);
        const supported =
          (degree >= 1 && degree <= 7) ||
          (Object.values(BORROWED_DEGREES) as number[]).includes(degree);
        if (!supported) {
          throw new InvalidInputError(
            `progression preset degrees[${index}] is not a supported progression degree; received ${degree}`,
          );
        }
        return degree;
      }),
      functional: opts.preset.functional ?? 'loop',
      styles: opts.preset.styles ?? [opts.style],
    };
  }
  if (preset === undefined && opts.presetId !== undefined) {
    preset = PRESETS.find((p) => p.id === opts.presetId);
    if (preset === undefined) {
      throw new InvalidInputError(`Unknown progression preset: ${opts.presetId}`);
    }
  }
  preset ??= pickProgressionPreset(opts.style, seed);
  const ext =
    opts.ext === undefined
      ? 'auto'
      : assertOneOf(opts.ext, ['auto', ...chordQualities()], 'progression extension');
  const cycle = resolveCycle(
    preset?.degrees ?? [0],
    key,
    ext,
    preset?.functional === 'cadenceStrong',
  );
  // One chord per bar of the meter the caller counts in, so the chord changes
  // fall on the bar lines every other part is written against.
  const barBeats = beatsPerBar(opts.ts ?? DEFAULT_TS);
  const chords: ChordSpan[] = [];
  for (let bar = 0; bar < opts.bars; bar += 1) {
    const step = cycle[bar % cycle.length];
    const chord: ChordSpan = {
      rootPc: step?.rootPc ?? 0,
      quality: step?.quality ?? 'maj',
      startBeat: bar * barBeats,
    };
    if (step?.degree !== undefined) {
      chord.degree = step.degree;
    }
    chords.push(chord);
  }

  const harmonic = ctx.harmonic ?? DEFAULT_HARMONIC;
  if (harmonic > 0) {
    const tonicPc = (((key.rootPc % 12) + 12) % 12) as number;
    const draw = ctx.part('progression');
    let tonicStatements = chords.filter((chord) => chord.rootPc === tonicPc).length;
    for (let i = 0; i < chords.length - 1; i += 1) {
      const cur = chords[i];
      const next = chords[i + 1];
      if (!cur || !next) {
        continue;
      }
      const domRoot = (next.rootPc + 7) % 12;
      const targetsTonic = (next.rootPc - tonicPc + 12) % 12 === 0;
      const isLastTonicStatement = cur.rootPc === tonicPc && tonicStatements <= 1;
      const alreadySecondary = cur.rootPc === domRoot && cur.quality === 'dom7';
      // A secondary dominant inserted at i-1 resolves onto this chord; replacing
      // it here would orphan that dominant.
      const isResolutionTarget = chords[i - 1]?.secondaryDominant === true;
      if (targetsTonic || isLastTonicStatement || alreadySecondary || isResolutionTarget) {
        continue;
      }
      if (draw.prob(harmonic, 'reharmonize', i)) {
        if (cur.rootPc === tonicPc) {
          tonicStatements -= 1;
        }
        chords[i] = {
          rootPc: domRoot,
          quality: 'dom7',
          startBeat: cur.startBeat,
          secondaryDominant: true,
        };
      }
    }
  }

  return chords;
}
