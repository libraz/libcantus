import type { ChordQuality } from '../chord/index.js';
import { scaleTonesInDegreeOrder } from '../scale/index.js';
import type { KeyScale } from '../types.js';

/** Broad production style a progression preset suits. */
export type ProgStyle = 'minimal' | 'dance' | 'idol' | 'rock';

/** Harmonic-function role of a progression as a whole. */
export type ProgFunction = 'loop' | 'tensionBuild' | 'cadenceStrong' | 'stable';

/** A named chord-progression preset expressed in scale degrees. */
export type ProgressionPreset = {
  id: string;
  name: string;
  degrees: number[];
  functional: ProgFunction;
  styles: ProgStyle[];
};

/** A chord placed on the timeline by {@link generateProgression}. */
export type GeneratedChord = {
  rootPc: number;
  quality: ChordQuality;
  startBeat: number;
  bassPc?: number;
  /** 0-based scale degree of the chord root, when known. */
  degree?: number;
  /** True when the chord is a secondary dominant tonicizing another degree. */
  secondaryDominant?: boolean;
};

/** Options controlling {@link generateProgression}. */
export type GenerateProgressionOptions = {
  key: KeyScale;
  style: ProgStyle;
  bars: number;
  presetId?: string;
  ext?: ChordQuality | 'auto';
  reharmonize?: boolean;
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
  8: 8, // bVI
  10: 10, // bVII
  11: 3, // bIII
  12: 5, // iv
  13: 1, // bII
  14: 6, // #IV
};

/** All built-in progression presets. */
export function progressions(): ProgressionPreset[] {
  return PRESETS.map((p) => ({ ...p, degrees: [...p.degrees], styles: [...p.styles] }));
}

/** Presets whose style list includes the given style. */
export function progressionsByStyle(style: ProgStyle): ProgressionPreset[] {
  return progressions().filter((p) => p.styles.includes(style));
}

/** Deterministic 32-bit PRNG producing a float in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/** Diatonic (or borrowed) triad quality of a degree in a major-key context. */
function autoQuality(degree: number): ChordQuality {
  if (degree === 6 || degree === 14) {
    return 'dim';
  }
  if (degree === 1 || degree === 2 || degree === 5 || degree === 12) {
    return 'min';
  }
  return 'maj';
}

/**
 * Generate a chord progression laid out one chord per bar.
 *
 * A preset is chosen by `presetId` when given, otherwise deterministically from
 * the presets matching `style`, seeded by `seed`. The preset's degrees cycle to
 * fill `bars`; each bar is four beats, so `startBeat` is `barIndex * 4`. Chord
 * roots come from the key's diatonic scale-degree mapping. When `ext` is
 * omitted or `'auto'`, each chord takes its diatonic triad quality; otherwise
 * `ext` is forced on every chord. `reharmonize` is reserved and currently has
 * no effect.
 *
 * @param opts Generation options.
 * @returns One chord per bar in timeline order.
 */
export function generateProgression(opts: GenerateProgressionOptions): GeneratedChord[] {
  const seed = opts.seed ?? 0;
  let preset: ProgressionPreset | undefined;
  if (opts.presetId !== undefined) {
    preset = PRESETS.find((p) => p.id === opts.presetId);
  }
  if (preset === undefined) {
    const pool = PRESETS.filter((p) => p.styles.includes(opts.style));
    const candidates = pool.length > 0 ? pool : PRESETS;
    const rng = mulberry32(seed);
    const index = Math.floor(rng() * candidates.length) % candidates.length;
    preset = candidates[index] ?? PRESETS[0];
  }
  const degrees = preset?.degrees ?? [0];
  const chords: GeneratedChord[] = [];
  for (let bar = 0; bar < opts.bars; bar += 1) {
    const degree = degrees[bar % degrees.length] ?? 0;
    const quality = opts.ext !== undefined && opts.ext !== 'auto' ? opts.ext : autoQuality(degree);
    chords.push({ rootPc: degreeToRootPc(degree, opts.key), quality, startBeat: bar * 4 });
  }
  return chords;
}
