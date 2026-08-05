import { InvalidInputError } from '../../core/errors/index.js';
import { createRng } from '../../core/random/index.js';
import type { KeyScale } from '../../core/types.js';
import {
  assertDegree,
  assertGenerationBudget,
  assertOneOf,
  assertPositiveInt,
} from '../../core/validation/index.js';
import type { ChordQuality, ChordSpan } from '../../theory/chord/index.js';
import { chordQualities, diatonicTriad } from '../../theory/chord/index.js';
import { scaleTonesInDegreeOrder } from '../../theory/scale/index.js';

export type { ChordSpan } from '../../theory/chord/index.js';

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
 * Scale degrees 0..6 address the key's own chords; these codes continue the
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
 *   preset: { degrees: [0, BORROWED_DEGREES.bVII, 3, 0] },
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
 * A chord root in a preset: a scale degree 0..6, or one of
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
  key: KeyScale;
  /**
   * Which pool of built-in presets to choose from. Ignored when `preset` names
   * the progression outright.
   */
  style: ProgStyle;
  bars: number;
  /** Pick a specific built-in preset by id instead of choosing one by style. */
  presetId?: string;
  /**
   * Use this progression rather than a built-in one. Only `degrees` is
   * required; see {@link BORROWED_DEGREES} for the non-diatonic codes.
   */
  preset?: Partial<ProgressionPreset> & { degrees: ProgressionDegree[] };
  ext?: ChordQuality | 'auto';
  reharmonize?: boolean;
  /**
   * Seed for the deterministic preset choice and reharmonization.
   *
   * @defaultValue 0
   */
  seed?: number;
};

const PRESETS: ProgressionPreset[] = [
  {
    id: 'fourChordPop',
    name: 'Four Chord Pop',
    degrees: [0, 4, 5, 3],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'pop1',
    name: 'Pop 1',
    degrees: [0, 5, 3, 4],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'axis',
    name: 'Axis',
    degrees: [5, 3, 0, 4],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol', 'rock'],
  },
  {
    id: 'pop2',
    name: 'Pop 2',
    degrees: [3, 0, 4, 5],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'classic',
    name: 'Classic',
    degrees: [0, 3, 4, 0],
    functional: 'cadenceStrong',
    styles: ['dance', 'idol', 'rock'],
  },
  {
    id: 'pop3',
    name: 'Pop 3',
    degrees: [0, 3, 5, 4],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'royalRoad',
    name: 'Royal Road',
    degrees: [3, 4, 2, 5],
    functional: 'tensionBuild',
    styles: ['dance', 'idol'],
  },
  {
    id: 'minor1',
    name: 'Minor 1',
    degrees: [5, 4, 3, 4],
    functional: 'tensionBuild',
    styles: ['idol', 'rock'],
  },
  {
    id: 'minor2',
    name: 'Minor 2',
    degrees: [5, 3, 4, 0],
    functional: 'tensionBuild',
    styles: ['idol', 'rock'],
  },
  {
    id: 'pop4',
    name: 'Pop 4',
    degrees: [0, 4, 2, 3],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'pop5',
    name: 'Pop 5',
    degrees: [0, 2, 3, 4],
    functional: 'stable',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'rock1',
    name: 'Rock 1',
    degrees: [0, 10, 3, 0],
    functional: 'tensionBuild',
    styles: ['rock'],
  },
  {
    id: 'rock2',
    name: 'Rock 2',
    degrees: [0, 3, 10, 0],
    functional: 'tensionBuild',
    styles: ['rock'],
  },
  {
    id: 'extended4',
    name: 'Extended 4',
    degrees: [0, 4, 5, 2],
    functional: 'stable',
    styles: ['minimal', 'dance'],
  },
  {
    id: 'minor3',
    name: 'Minor 3',
    degrees: [5, 0, 4, 3],
    functional: 'loop',
    styles: ['dance', 'idol'],
  },
  {
    id: 'aeolianPop',
    name: 'Aeolian Pop',
    degrees: [5, 8, 10, 0],
    functional: 'tensionBuild',
    styles: ['minimal', 'dance', 'idol', 'rock'],
  },
  {
    id: 'animeHighEnergy1',
    name: 'Anime High Energy 1',
    degrees: [5, 2, 3, 0],
    functional: 'loop',
    styles: ['dance', 'idol'],
  },
  {
    id: 'jazzPop',
    name: 'Jazz Pop',
    degrees: [1, 4, 0, 5],
    functional: 'cadenceStrong',
    styles: ['minimal', 'dance'],
  },
  {
    id: 'animeHighEnergy2',
    name: 'Anime High Energy 2',
    degrees: [5, 1, 4, 0],
    functional: 'cadenceStrong',
    styles: ['dance', 'idol'],
  },
  {
    id: 'cityPop',
    name: 'City Pop',
    degrees: [0, 5, 1, 4],
    functional: 'stable',
    styles: ['minimal', 'dance'],
  },
  {
    id: 'extended5',
    name: 'Extended 5',
    degrees: [0, 4, 5, 2, 3],
    functional: 'loop',
    styles: ['minimal', 'dance', 'idol'],
  },
  {
    id: 'neapolitanPop',
    name: 'Neapolitan Pop',
    degrees: [5, 12, 13, 4, 0],
    functional: 'cadenceStrong',
    styles: ['minimal', 'dance', 'idol'],
  },
];

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
  if (degree >= 0 && degree <= 6) {
    const tones = scaleTonesInDegreeOrder(key);
    return tones.length > 0 ? (tones[degree % tones.length] ?? key.rootPc % 12) : key.rootPc % 12;
  }
  const offset = BORROWED_OFFSET[degree] ?? 0;
  return ((((key.rootPc % 12) + offset) % 12) + 12) % 12;
}

/**
 * Diatonic (or borrowed) triad quality of a degree in the given key.
 *
 * Diatonic degrees (0-6) take their scale-correct triad quality, so non-major
 * keys yield diatonic chords. Borrowed degrees keep their fixed chromatic
 * qualities (`#IV` diminished, `iv` minor, the rest major).
 */
function autoQuality(degree: number, key: KeyScale, harmonicDominant: boolean): ChordQuality {
  if (degree >= 0 && degree <= 6) {
    const isMinor = ((key.modeMask12 >> 3) & 1) === 1 && ((key.modeMask12 >> 4) & 1) === 0;
    // A cadence-oriented progression needs a leading tone in minor too: use
    // the conventional harmonic-minor V rather than the natural-minor v.
    if (harmonicDominant && isMinor && degree === 4) {
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
    if (degree >= 0 && degree <= 6) {
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
  const rng = createRng(seed);
  const index = Math.floor(rng.next() * pool.length) % pool.length;
  return pool[index] ?? (PRESETS[0] as ProgressionPreset);
}

/**
 * Generate a chord progression laid out one chord per bar.
 *
 * A preset is chosen by `presetId` when given, otherwise deterministically from
 * the presets matching `style`, seeded by `seed`. An unknown `presetId`, or a
 * `style` no preset claims, is a caller error and throws rather than silently
 * falling back to a random preset. The preset's degrees cycle to
 * fill `bars`; each bar is four beats, so `startBeat` is `barIndex * 4`. Chord
 * roots come from the key's diatonic scale-degree mapping. When `ext` is
 * omitted or `'auto'`, each chord takes its diatonic triad quality; otherwise
 * `ext` is forced on every chord — except a chord replaced by `reharmonize`,
 * which is a secondary dominant and is therefore always a `dom7`; those carry
 * `secondaryDominant: true`. When `reharmonize` is set, some chords are
 * deterministically replaced with the secondary dominant (V7) of the following
 * chord, flagged with `secondaryDominant`.
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
 * ```
 *
 * @category Composition
 */
export function generateProgression(opts: ProgressionOptions): ChordSpan[] {
  assertPositiveInt(opts.bars, 'progression bars');
  assertGenerationBudget(opts.bars, 'progression chords');
  const seed = opts.seed ?? 0;
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
          (degree >= 0 && degree <= 6) ||
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
    opts.key,
    ext,
    preset?.functional === 'cadenceStrong',
  );
  const chords: ChordSpan[] = [];
  for (let bar = 0; bar < opts.bars; bar += 1) {
    const step = cycle[bar % cycle.length];
    const chord: ChordSpan = {
      rootPc: step?.rootPc ?? 0,
      quality: step?.quality ?? 'maj',
      startBeat: bar * 4,
    };
    if (step?.degree !== undefined) {
      chord.degree = step.degree;
    }
    chords.push(chord);
  }

  if (opts.reharmonize) {
    const tonicPc = (((opts.key.rootPc % 12) + 12) % 12) as number;
    const rrng = createRng((seed ^ 0x9e3779b9) >>> 0);
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
      if (rrng.next() < 0.5) {
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
