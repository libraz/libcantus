// Fixture module for `gen_tables.mjs --self-test`.

export const MAX_ITEMS = 64;
export const RATIO = 0.5;
export const NEGATIVE = -1;
export const ENABLED = true;
export const EPS = 1e-9;

interface Tone {
  degree: number;
  optional?: boolean;
}

export const SHAPES: { name: string; size: number; tones: Tone[] }[] = [
  { name: 'triad', size: 3, tones: [{ degree: 1 }, { degree: 3, optional: true }] },
  { name: 'é"\\', size: 2, tones: [] },
];

export const WEIGHTS: Record<string, number[]> = {
  major: [1, -0, Number.NaN],
  minor: [Number.POSITIVE_INFINITY, 0.1],
};

export const HOOKS = [() => 1];
