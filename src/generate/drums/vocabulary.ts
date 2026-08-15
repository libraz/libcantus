/**
 * The drum pattern dictionary: the bar-long figures that make a groove belong
 * to a genre rather than merely being correct.
 *
 * Provenance: every pattern here is the plain, unattributable pulse of its
 * genre — the figure taught as "this is how that music goes" — written out on
 * the sixteenth grid from that description. None reproduces the drum part of a
 * particular recording, and each entry says which ground it qualifies under.
 */

import { type Articulation, canSound, type Limb } from '../../core/instrument/index.js';
import { beatsPerBar, type TimeSignature } from '../../core/meter/index.js';
import {
  assertGenerationBudget,
  assertOneOf,
  assertPositiveInt,
  assertRange,
  assertTimeSignature,
} from '../../core/validation/index.js';
import { type GenerationContextInput, resolveContextWith } from '../context/index.js';
import {
  BAR_STEPS,
  deform,
  GENRES,
  type Genre,
  type GridEvent,
  mergeVocabulary,
  pickVocabulary,
  STEP_BEATS,
  type Vocabulary,
  vocabularyOfKind,
  withinCeiling,
} from '../vocabulary/index.js';
import { DRUM_NOTES, type DrumHit, type DrumVoice, HitList } from './hit.js';
import { PUBLIC_SECTIONS, type PublicSection } from './internal.js';

/**
 * One stroke of a pattern, on the bar's sixteenth grid.
 *
 * Velocity is a factor of the passage's base velocity rather than a MIDI
 * number, so the same figure sits right in a verse and in a chorus.
 */
export type DrumStroke = GridEvent & {
  voice: DrumVoice;
  /** Sounding length in quarter-note beats; one sixteenth when absent. */
  duration?: number;
  articulation?: Articulation;
  /** Which limb plays the stroke, where the figure depends on it. */
  limb?: Limb;
};

/**
 * A bar-long drum figure.
 *
 * @category Composition
 */
export type DrumPattern = {
  /** Sixteenth steps in the figure; a 4/4 bar is sixteen. */
  steps: number;
  strokes: DrumStroke[];
};

/**
 * A drum figure with the conditions it fits.
 *
 * @category Composition
 */
export type DrumVocabulary = Vocabulary<DrumPattern>;

/**
 * Whether a caller's material is a drum pattern.
 *
 * A context carries one dictionary for the whole piece, so each generator
 * recognises its own material: an entry meant for the bass is invisible here
 * rather than mis-read.
 *
 * @category Composition
 */
export function isDrumPattern(material: unknown): material is DrumPattern {
  const candidate = material as DrumPattern | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.steps === 'number' &&
    Array.isArray(candidate.strokes)
  );
}

/** One stroke. */
function hit(
  voice: DrumVoice,
  step: number,
  velocity: number,
  extra?: { duration?: number; articulation?: Articulation; limb?: Limb },
): DrumStroke {
  return { voice, step, velocity, ...extra };
}

/** A ghosted snare: decoration, so the ornament dial decides whether it stays. */
function ghost(step: number): DrumStroke {
  return hit('snare', step, 0.32, { articulation: 'ghost' });
}

/** A run of strokes on one voice at a fixed spacing. */
function pulse(voice: DrumVoice, every: number, velocity: number, from = 0): DrumStroke[] {
  const out: DrumStroke[] = [];
  for (let step = from; step < BAR_STEPS; step += every) {
    out.push(hit(voice, step, velocity));
  }
  return out;
}

/** A four-beat pattern on the sixteenth grid. */
function bar(strokes: DrumStroke[]): DrumPattern {
  return { steps: BAR_STEPS, strokes };
}

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };

/**
 * The built-in drum patterns, in declaration order.
 *
 * @category Composition
 */
export const DRUM_PATTERNS: readonly DrumVocabulary[] = Object.freeze([
  {
    id: 'motownBackbeat',
    genre: 'motown',
    difficulty: 2,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [96, 136],
    material: bar([
      hit('kick', 0, 1),
      hit('kick', 6, 0.85),
      hit('kick', 8, 0.9),
      hit('kick', 14, 0.8),
      hit('snare', 4, 1),
      hit('snare', 12, 1),
      ...pulse('tambourine', 2, 0.5),
    ]),
    provenance: {
      basis: 'idiom',
      note: 'the label sound of a four-square backbeat under a tambourine on every eighth',
    },
  },
  {
    id: 'funkSixteenth',
    genre: 'funk',
    difficulty: 4,
    articulations: ['ghost'],
    ts: FOUR_FOUR,
    tempoRange: [84, 120],
    material: bar([
      hit('kick', 0, 1),
      hit('kick', 3, 0.8),
      hit('kick', 6, 0.85),
      hit('kick', 10, 0.8),
      hit('snare', 4, 1),
      hit('snare', 12, 1),
      ghost(2),
      ghost(7),
      ghost(9),
      ghost(15),
      ...pulse('closedHiHat', 1, 0.55),
    ]),
    provenance: {
      basis: 'idiom',
      note: 'the genre-defining sixteenth-note hi-hat with ghosted snares around the backbeat',
    },
  },
  {
    id: 'halfTimeShuffle',
    genre: 'blues',
    difficulty: 5,
    articulations: ['ghost'],
    ts: FOUR_FOUR,
    tempoRange: [72, 104],
    material: bar([
      hit('kick', 0, 1),
      hit('kick', 10, 0.85),
      hit('snare', 8, 1),
      ghost(3),
      ghost(7),
      ghost(11),
      ghost(15),
      ...pulse('closedHiHat', 2, 0.5),
    ]),
    provenance: {
      basis: 'idiom',
      note: 'the shuffle with its backbeat displaced to beat three; the triplet feel is the groove feel applied at render, not written into the grid',
    },
  },
  {
    id: 'bossaNova',
    genre: 'bossa',
    difficulty: 3,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [110, 160],
    material: bar([
      hit('kick', 0, 0.9),
      hit('kick', 6, 0.8),
      hit('kick', 8, 0.9),
      hit('kick', 14, 0.8),
      hit('sideStick', 0, 0.7),
      hit('sideStick', 3, 0.7),
      hit('sideStick', 6, 0.7),
      hit('sideStick', 10, 0.7),
      hit('sideStick', 12, 0.7),
      ...pulse('closedHiHat', 2, 0.45),
    ]),
    provenance: {
      basis: 'traditional',
      note: 'the Brazilian dance pattern: a rim-click clave over a two-beat bass figure',
    },
  },
  {
    id: 'samba',
    genre: 'samba',
    difficulty: 4,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [92, 140],
    material: bar([
      hit('kick', 0, 0.85),
      hit('kick', 3, 0.7),
      hit('kick', 4, 1),
      hit('kick', 7, 0.7),
      hit('kick', 8, 0.85),
      hit('kick', 11, 0.7),
      hit('kick', 12, 1),
      hit('kick', 15, 0.7),
      hit('sideStick', 4, 0.75),
      hit('sideStick', 12, 0.75),
      ...pulse('shaker', 1, 0.4),
    ]),
    provenance: {
      basis: 'traditional',
      note: 'the surdo accent on the second beat of each pair, under a continuous shaker',
    },
  },
  {
    id: 'gospelPocket',
    genre: 'gospel',
    difficulty: 4,
    articulations: ['ghost'],
    ts: FOUR_FOUR,
    tempoRange: [64, 104],
    material: bar([
      hit('kick', 0, 1),
      hit('kick', 6, 0.8),
      hit('kick', 10, 0.85),
      hit('kick', 14, 0.75),
      hit('snare', 4, 1),
      hit('snare', 12, 1),
      ghost(2),
      ghost(6),
      ghost(11),
      ghost(14),
      ...pulse('closedHiHat', 1, 0.5),
    ]),
    provenance: {
      basis: 'idiom',
      note: 'the deep pocket of the church backbeat, ghosted between the accents',
    },
  },
  {
    id: 'drumAndBassBreak',
    genre: 'dnb',
    difficulty: 4,
    articulations: ['ghost'],
    ts: FOUR_FOUR,
    tempoRange: [160, 180],
    material: bar([
      hit('kick', 0, 1),
      hit('kick', 10, 0.9),
      hit('snare', 4, 1),
      hit('snare', 11, 0.85),
      hit('snare', 12, 1),
      ghost(7),
      ghost(15),
      ...pulse('closedHiHat', 2, 0.45),
    ]),
    provenance: {
      basis: 'construction',
      note: 'the two-bar break skeleton of the genre, written out from its rhythmic grid',
    },
  },
]);

/**
 * Options controlling {@link placeDrumPattern}.
 *
 * @category Composition
 */
export type DrumPatternOptions = {
  /** Number of bars to generate. */
  bars: number;
  /**
   * The genre whose figures may be used. Genre is what selects the material;
   * the complexity dials then deform it and the difficulty ceiling rejects it.
   */
  genre: Genre;
  /** Section the pattern plays in, matched against each entry's own sections. */
  section?: PublicSection;
  /** Time signature; defaults to 4/4. */
  ts?: TimeSignature;
  /** Tempo in BPM. Sugar for `ctx: { bpm }`; the context wins over both. */
  bpm?: number;
  /** Seed for the deterministic PRNG. Sugar for `ctx: { seed }`. */
  seed?: number;
  /**
   * The generation context. `complexity.rhythmic` thins the figure below its
   * middle setting and syncopates it above, `complexity.ornament` decides how
   * many ghosts survive, `complexity.difficulty` rejects a figure the player
   * could not keep up at this tempo, and `vocabulary` brings figures of the
   * caller's own.
   */
  ctx?: GenerationContextInput;
  /**
   * Play the figure at half or double its written rate. This is a deformation
   * like the dials, not a different figure: the dictionary entry is the same.
   *
   * @defaultValue `'straight'`
   */
  feel?: 'straight' | 'half' | 'double';
  /** Base velocity the figure's own factors are read against. */
  velocity?: number;
};

/** Base velocity a pattern's factors are read against when none is given. */
const DEFAULT_VELOCITY = 100;

/** Tempo assumed when neither the context nor the options name one. */
const DEFAULT_BPM = 120;

/** Generous upper bound on onsets one bar of a pattern emits. */
const MAX_STROKES_PER_BAR = 64;

/**
 * Generate a genre-characteristic groove from the pattern dictionary.
 *
 * The three dials never fight, because each owns a different step: the genre
 * chooses which figures are candidates, the complexity dials deform the chosen
 * figure, and the difficulty ceiling rejects a figure whose closest pair of
 * strokes is faster than a player at that ceiling sustains. A rejected figure
 * is dropped from the candidates rather than simplified, since a simplified
 * figure is a different figure.
 *
 * @param opts Generation options.
 * @returns Percussion onsets in onset order, ties broken by pitch.
 * @throws If the bar count, tempo, or time signature is invalid, or the genre
 *   is not one this library names.
 *
 * @example
 * ```ts
 * import { placeDrumPattern } from '@libraz/libcantus';
 * const hits = placeDrumPattern({ bars: 2, genre: 'bossa', ctx: { seed: 7, bpm: 130 } });
 * ```
 *
 * @category Composition
 */
export function placeDrumPattern(opts: DrumPatternOptions): DrumHit[] {
  assertPositiveInt(opts.bars, 'drum pattern bars');
  assertGenerationBudget(opts.bars * MAX_STROKES_PER_BAR, 'drum pattern hits');
  const genre = assertOneOf(opts.genre, GENRES, 'drum pattern genre');
  const section =
    opts.section === undefined
      ? undefined
      : assertOneOf(opts.section, PUBLIC_SECTIONS, 'drum pattern section');
  const ts = opts.ts ?? FOUR_FOUR;
  assertTimeSignature(ts, 'drum pattern time signature');
  if (opts.velocity !== undefined) {
    assertRange(opts.velocity, 1, 127, 'drum pattern velocity');
  }
  const resolved = resolveContextWith(opts.ctx, { seed: opts.seed, bpm: opts.bpm });
  const bpm = resolved.bpm ?? DEFAULT_BPM;
  const draw = resolved.part('drums');
  const baseVelocity = opts.velocity ?? DEFAULT_VELOCITY;
  const barBeats = beatsPerBar(ts);

  const dictionary = mergeVocabulary(
    DRUM_PATTERNS,
    vocabularyOfKind(resolved.vocabulary, isDrumPattern),
  );
  const track = new HitList();

  for (let bar = 0; bar < opts.bars; bar += 1) {
    const entry = pickVocabulary(
      dictionary,
      { genre, section, bpm, ts, difficulty: resolved.difficulty },
      draw,
      'pattern',
      bar,
    );
    if (!entry) {
      continue;
    }
    const strokes = deform(
      entry.material.strokes,
      {
        ...(resolved.rhythmic === undefined ? {} : { rhythmic: resolved.rhythmic }),
        ...(resolved.ornament === undefined ? {} : { ornament: resolved.ornament }),
        isOrnament: (stroke) => (stroke as DrumStroke).articulation === 'ghost',
        feel: opts.feel ?? 'straight',
        spanSteps: entry.material.steps,
      },
      draw,
      'pattern',
      bar,
    );
    // The ceiling judges what the dials actually produced, not what the
    // dictionary wrote: syncopating a figure can bring two strokes together.
    if (!withinCeiling(strokes, bpm, resolved.difficulty)) {
      continue;
    }
    const barStart = bar * barBeats;
    for (const stroke of strokes) {
      const pitch = DRUM_NOTES[stroke.voice];
      if (pitch === undefined) {
        continue;
      }
      track.add(
        pitch,
        barStart + stroke.step * STEP_BEATS,
        stroke.duration ?? STEP_BEATS,
        baseVelocity * stroke.velocity,
        stroke.articulation,
      );
    }
  }

  // Naming a kit is the request that the part be playable on it, so a voice the
  // kit does not have is an absent stroke rather than a hard one.
  const endBeat = opts.bars * barBeats;
  const kit = resolved.instrument('drums');
  return track.hits
    .filter((h) => h.startBeat < endBeat && (kit === undefined || canSound(kit, h.pitch)))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
}
