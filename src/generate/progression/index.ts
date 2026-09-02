import { isMinorKey, tonicizableDegrees } from '../../analyze/functional/index.js';
import { InvalidInputError } from '../../core/errors/index.js';
import { beatsPerBar, type MeterLike } from '../../core/meter/index.js';
import type { KeyScale } from '../../core/types.js';
import {
  assertDegree,
  assertGenerationBudget,
  assertOneOf,
  assertPositiveInt,
  assertRecord,
} from '../../core/validation/index.js';
import type { ChordQuality, ChordSpan } from '../../theory/chord/index.js';
import { chordQualities, diatonicTriad, makeChord } from '../../theory/chord/index.js';
import { type KeyLike, scaleTonesInDegreeOrder, toKeyScale } from '../../theory/scale/index.js';
import { fifthPcOf, heptatonicFrameOf } from '../../theory/tendency/index.js';
import {
  type GenerationContextInput,
  type ResolvedContext,
  resolveContext,
} from '../context/index.js';

export type { ChordSpan } from '../../theory/chord/index.js';

/** The meter a progression is laid out in when the caller names none. */
const DEFAULT_TS = { numerator: 4, denominator: 4 };

/**
 * Every production style a preset may suit, in declaration order.
 *
 * Written as a table rather than only as a union so the names exist at run time:
 * a union is checked when the caller compiles, and a style arriving from a
 * config file or a JavaScript caller is checked against this.
 */
const PROG_STYLES = Object.freeze(['minimal', 'dance', 'idol', 'rock'] as const);

/**
 * Broad production style a progression preset suits.
 *
 * @category Composition
 */
export type ProgStyle = (typeof PROG_STYLES)[number];

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
   * The chord roots, in order, as {@link ProgressionDegree} codes: 1..7 for the
   * key's own scale degrees, counted as a musician counts them, and
   * {@link BORROWED_DEGREES} for the borrowed ones.
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
  // A style union is checked at compile time only, so a name from a config file
  // or a JavaScript caller would otherwise select nothing — which reads exactly
  // like a style the library stocks no preset for.
  const named = assertOneOf(style, PROG_STYLES, 'style');
  return progressions().filter((p) => p.styles.includes(named));
}

/**
 * Root pitch class of a scale degree in the given key, including borrowed
 * degrees.
 *
 * Degrees are read in the key's heptatonic frame, as the numerals and the
 * tonicization targets are: a preset is written in degrees one to seven, and a
 * key with some other number of tones has no degree-for-degree frame of its own
 * to read them in. Wrapping them into a five-tone scale instead answered the
 * sixth degree with the first.
 */
function degreeToRootPc(degree: number, key: KeyScale): number {
  if (degree >= 1 && degree <= 7) {
    const tones = scaleTonesInDegreeOrder(heptatonicFrameOf(key));
    return tones[degree - 1] ?? key.rootPc % 12;
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
    // A cadence-oriented progression needs a leading tone in minor too: use
    // the conventional harmonic-minor V rather than the natural-minor v.
    if (harmonicDominant && isMinorKey(key) && degree === 5) {
      return 'maj';
    }
    // The same frame the root was read in, so the two halves of one chord
    // cannot come from different degree spaces.
    return diatonicTriad(degree, heptatonicFrameOf(key)).quality;
  }
  if (degree === 14) {
    return 'dim';
  }
  if (degree === 12) {
    return 'min';
  }
  return 'maj';
}

/** One resolved step of a preset cycle. */
type CycleStep = { degree?: number; rootPc: number; quality: ChordQuality };

/**
 * Resolve a preset's degrees against a key, one step per degree.
 *
 * Presets are written in scale degrees plus a handful of chromatic borrowings
 * measured from the tonic, and the two can name the same chord: `bVI` is the
 * sixth degree of a minor key, so `vi bVI bVII I` — a major-key device — turns
 * into `bVI bVI bVII i` there. The repeat is kept, which is one chord held over
 * two bars rather than a chord change: dropping it shortened the loop to three
 * bars in that key and four in every other, and a harmony that turns over every
 * three bars crosses every phrase boundary the bass, the drums and the
 * countermelody are written against.
 */
function resolveCycle(
  degrees: readonly number[],
  key: KeyScale,
  ext: ProgressionOptions['ext'],
  harmonicDominant: boolean,
): CycleStep[] {
  const steps: CycleStep[] = degrees.map((degree) => {
    const step: CycleStep = {
      rootPc: degreeToRootPc(degree, key),
      quality:
        ext !== undefined && ext !== 'auto' ? ext : autoQuality(degree, key, harmonicDominant),
    };
    if (degree >= 1 && degree <= 7) {
      step.degree = degree;
    }
    return step;
  });
  // The fallback carries no degree at all: `ChordSpan.degree` is a scale degree,
  // one to seven, and a chord that stands for a cycle with nothing in it is on
  // none of them. Numbering it zero put a value outside the field's own domain
  // into a span a caller reads.
  return steps.length > 0 ? steps : [{ rootPc: degreeToRootPc(1, key), quality: 'maj' }];
}

/**
 * The preset {@link generateProgression} would choose for a style and seed.
 *
 * The choice is otherwise invisible: the generator returns chords, not the
 * preset it drew them from, so a caller who wants to show or reproduce it has
 * no way to name it.
 *
 * @param style The style pool to choose from.
 * @param ctx The same context the generator would be given, or the seed alone.
 * @returns The preset that context selects.
 * @throws If no preset claims the style.
 * @example
 * ```ts
 * import { pickProgressionPreset } from '@libraz/libcantus';
 * pickProgressionPreset('dance', 3).name;
 * ```
 * @category Composition
 */
export function pickProgressionPreset(
  style: ProgStyle,
  ctx: GenerationContextInput = 0,
): ProgressionPreset {
  return presetFor(style, resolveContext(ctx));
}

/**
 * The preset a style resolves to under a context that is already resolved.
 *
 * One top-level call resolves its context once and every draw of that call
 * comes from it, the preset choice included. Re-deriving a context from the
 * bare seed here took the choice from a source the caller never named — a
 * caller supplying its own positional source to reroll got the same loop every
 * time — and at whatever version the build defaults to, so a project
 * pinned to one version would get another version's loop under its own
 * substitutions.
 */
function presetFor(style: ProgStyle, ctx: ResolvedContext): ProgressionPreset {
  // A style no preset claims is a caller error, exactly as an unknown
  // presetId is: falling back to the whole pool would answer a typo with a
  // plausible but stylistically unrelated progression.
  const pool = PRESETS.filter((preset) => preset.styles.includes(style));
  if (pool.length === 0) {
    throw new InvalidInputError(`Unknown progression style: ${style}`);
  }
  const index = ctx.part('progression').range(0, pool.length - 1, 'preset');
  return pool[index] ?? (PRESETS[0] as ProgressionPreset);
}

/**
 * The pitch classes of the degrees this key can make a local tonic.
 *
 * The degrees come from the same predicate the analysis layer names an applied
 * numeral's target with, so a chord flagged as a secondary dominant here is one
 * that layer can write `V7/x` for.
 */
function tonicizableRootPcs(key: KeyScale): Set<number> {
  return new Set(tonicizableDegrees(key).map((degree) => degree.rootPc));
}

/**
 * Whether the chord a secondary dominant would resolve to can stand as a local
 * tonic.
 *
 * Nothing tonicizes a diminished triad: the supertonic of a minor key is one,
 * and a dominant seventh placed in front of it is a chord read against the home
 * key rather than as an applied dominant. Both the degree and the chord
 * actually sounding on it have to hold a perfect fifth, since a caller's `ext`
 * can force a quality the degree does not carry.
 *
 * @param span The chord the dominant would point at.
 * @param tonicizable The key's tonicizable degree roots, as pitch classes.
 */
function canBeTonicized(span: ChordSpan, tonicizable: ReadonlySet<number>): boolean {
  if (!tonicizable.has(span.rootPc)) {
    return false;
  }
  return fifthPcOf(makeChord(span.rootPc, span.quality)) === (span.rootPc + 7) % 12;
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
 * `secondaryDominant`. Only a chord the key can make a local tonic is given one:
 * nothing tonicizes a diminished triad, so the supertonic of a minor key takes
 * no dominant of its own.
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
  assertRecord(opts, 'progression options');
  assertPositiveInt(opts.bars, 'progression bars');
  assertGenerationBudget(opts.bars, 'progression chords');
  // The key is read into its plain form once, here at the boundary; the degree
  // resolution below is given the scale it resolved to.
  const key = toKeyScale(opts.key);
  const ctx = resolveContext(opts.ctx);
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
  preset ??= presetFor(opts.style, ctx);
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
    const tonicizable = tonicizableRootPcs(key);
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
      const takesNoDominant = !canBeTonicized(next, tonicizable);
      if (
        targetsTonic ||
        isLastTonicStatement ||
        alreadySecondary ||
        isResolutionTarget ||
        takesNoDominant
      ) {
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
