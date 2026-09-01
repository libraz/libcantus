/**
 * The structured reading of a chord: what it is built from, not what it is
 * called.
 *
 * A quality name is a closed vocabulary and a lead sheet's harmony is not. A
 * chart writes a *set* of alterations over a base — `maj7#11`, `7b9#11`,
 * `sus4(add9)` — so an enumeration of names can never be complete, and every
 * name added to one is a name missing from its neighbours. A {@link ChordSpec}
 * names the parts instead: a base triad, an optional seventh, altered, added
 * and omitted degrees. A combination nothing names still has exact intervals,
 * an exact pitch-class set, and a symbol that reads back as itself.
 *
 * Each {@link ChordQuality} is an alias for one spec, so the two directions
 * cannot drift: a named chord's interval template is derived from its spec
 * rather than listed beside it.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import { assertFiniteNumber, describeRejected } from '../../core/validation/index.js';

/**
 * Chord quality identifiers understood by the chord builder.
 *
 * Each name is an alias for one {@link ChordSpec}. The union is closed, so it
 * names the chords a chart writes most often rather than every chord that can
 * be written; build the rest from a spec.
 *
 * @category Chords
 */
export type ChordQuality =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | 'maj7'
  | 'min7'
  | 'dom7'
  | 'dim7'
  | 'm7b5'
  | 'minMaj7'
  | 'minMaj9'
  | 'minMaj11'
  | 'minMaj13'
  | 'aug7'
  | 'augMaj7'
  | 'majb5'
  | '6'
  | 'min6'
  | '6/9'
  | 'sus2'
  | 'sus4'
  | 'add9'
  | 'add11'
  | 'maj9'
  | 'min9'
  | 'dom9'
  | '7b9'
  | '7#9'
  | '7#11'
  | '7b13'
  | '11'
  | '13'
  | '5'
  | '7sus4'
  | '7b5'
  | '7alt'
  | '13b9'
  | 'maj13'
  | 'maj7#11'
  | 'min11'
  | 'min13'
  | 'minAdd9'
  | 'min6/9';

/**
 * The triad (or dyad) a chord is built on, before any seventh or tension.
 *
 * `sus2` and `sus4` replace the third rather than sitting beside it, and
 * `power` is the bare root and fifth, so the base says which tones the chord
 * has before anything is added to them.
 *
 * @category Chords
 */
export type ChordBase = 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4' | 'power';

/**
 * The seventh stacked over a base: major, minor, or diminished.
 *
 * @category Chords
 */
export type ChordSeventh = 'maj7' | 'min7' | 'dim7';

/**
 * A chord degree that can be raised or lowered: the fifth and the tensions.
 *
 * @category Chords
 */
export type AlteredDegree = 5 | 9 | 11 | 13;

/**
 * One altered degree: which one, and by how much.
 *
 * `alter: 0` is not redundant — it says the degree is *present* and unaltered,
 * which is what the natural ninth of a thirteenth chord is.
 *
 * @category Chords
 */
export type Alteration = {
  degree: AlteredDegree;
  alter: -1 | 0 | 1;
};

/**
 * A chord as its parts: base, seventh, alterations, additions and omissions.
 *
 * The library's structural chord model. `alterations` are tensions over a
 * seventh chord; `additions` are degrees added without one (`add9`, and the
 * sixth of a sixth chord); `omissions` are degrees the chord leaves out (the
 * third of an eleventh chord, the fifth of a shell voicing) named by chord
 * degree, so `omissions: [5]` is a fifth-less chord.
 *
 * @category Chords
 */
export type ChordSpec = {
  rootPc: number;
  base: ChordBase;
  seventh?: ChordSeventh;
  alterations: Alteration[];
  additions: number[];
  omissions: number[];
  bassPc?: number;
};

/** The tones each base names, as `[chord degree, semitones above the root]`. */
const BASE_TONES: Record<ChordBase, readonly (readonly [number, number])[]> = {
  maj: [
    [1, 0],
    [3, 4],
    [5, 7],
  ],
  min: [
    [1, 0],
    [3, 3],
    [5, 7],
  ],
  dim: [
    [1, 0],
    [3, 3],
    [5, 6],
  ],
  aug: [
    [1, 0],
    [3, 4],
    [5, 8],
  ],
  sus2: [
    [1, 0],
    [3, 2],
    [5, 7],
  ],
  sus4: [
    [1, 0],
    [3, 5],
    [5, 7],
  ],
  power: [
    [1, 0],
    [5, 7],
  ],
};

/** Semitones above the root of each seventh. */
const SEVENTH_SEMITONES: Record<ChordSeventh, number> = { maj7: 11, min7: 10, dim7: 9 };

/** Semitones above the root of each addable/alterable degree, unaltered. */
const DEGREE_SEMITONES: Record<number, number> = { 6: 9, 9: 14, 11: 17, 13: 21 };

/** Semitones above the root of an unaltered fifth, the tone alterations move. */
const PERFECT_FIFTH = 7;

/** Chord degrees a chord may omit: root, third, fifth. */
const OMITTABLE_DEGREES = [1, 3, 5];

/** The quality naming each base on its own, when nothing closer fits. */
const BASE_QUALITY: Record<ChordBase, ChordQuality> = {
  maj: 'maj',
  min: 'min',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  power: '5',
};

/** The parts of a quality's spec, in the order a chord is built from them. */
type SpecParts = {
  seventh?: ChordSeventh;
  alt?: readonly (readonly [AlteredDegree, -1 | 0 | 1])[];
  add?: readonly number[];
  omit?: readonly number[];
};

/** Build a rootless spec for the alias table, so it reads as the chord does. */
function parts(base: ChordBase, spec: SpecParts = {}): ChordSpec {
  const built: ChordSpec = {
    rootPc: 0,
    base,
    alterations: (spec.alt ?? []).map(([degree, alter]) => ({ degree, alter })),
    additions: [...(spec.add ?? [])],
    omissions: [...(spec.omit ?? [])],
  };
  if (spec.seventh !== undefined) {
    built.seventh = spec.seventh;
  }
  return built;
}

/**
 * The spec each quality name stands for.
 *
 * Declaration order is stable but carries no meaning: {@link chordQualities}
 * publishes it and chord detection uses it as a final tie-break, so it is part
 * of the observable behaviour and does not get reshuffled casually.
 */
const QUALITY_SPECS: Record<ChordQuality, ChordSpec> = {
  maj: parts('maj'),
  min: parts('min'),
  dim: parts('dim'),
  aug: parts('aug'),
  majb5: parts('maj', { alt: [[5, -1]] }),
  maj7: parts('maj', { seventh: 'maj7' }),
  min7: parts('min', { seventh: 'min7' }),
  dom7: parts('maj', { seventh: 'min7' }),
  dim7: parts('dim', { seventh: 'dim7' }),
  m7b5: parts('dim', { seventh: 'min7' }),
  minMaj7: parts('min', { seventh: 'maj7' }),
  minMaj9: parts('min', { seventh: 'maj7', alt: [[9, 0]] }),
  minMaj11: parts('min', {
    seventh: 'maj7',
    alt: [
      [9, 0],
      [11, 0],
    ],
  }),
  minMaj13: parts('min', {
    seventh: 'maj7',
    alt: [
      [9, 0],
      [13, 0],
    ],
  }),
  aug7: parts('aug', { seventh: 'min7' }),
  augMaj7: parts('aug', { seventh: 'maj7' }),
  '6': parts('maj', { add: [6] }),
  min6: parts('min', { add: [6] }),
  '6/9': parts('maj', { add: [6, 9] }),
  sus2: parts('sus2'),
  sus4: parts('sus4'),
  add9: parts('maj', { add: [9] }),
  add11: parts('maj', { add: [11] }),
  maj9: parts('maj', { seventh: 'maj7', alt: [[9, 0]] }),
  min9: parts('min', { seventh: 'min7', alt: [[9, 0]] }),
  dom9: parts('maj', { seventh: 'min7', alt: [[9, 0]] }),
  '7b9': parts('maj', { seventh: 'min7', alt: [[9, -1]] }),
  '7#9': parts('maj', { seventh: 'min7', alt: [[9, 1]] }),
  '7#11': parts('maj', { seventh: 'min7', alt: [[11, 1]] }),
  '7b13': parts('maj', { seventh: 'min7', alt: [[13, -1]] }),
  // The eleventh chord as a chart voices it: the third gives way to the
  // eleventh a semitone above it rather than sounding against it.
  '11': parts('maj', {
    seventh: 'min7',
    alt: [
      [9, 0],
      [11, 0],
    ],
    omit: [3],
  }),
  '13': parts('maj', {
    seventh: 'min7',
    alt: [
      [9, 0],
      [13, 0],
    ],
  }),
  '5': parts('power'),
  '7sus4': parts('sus4', { seventh: 'min7' }),
  '7b5': parts('maj', { seventh: 'min7', alt: [[5, -1]] }),
  // The altered dominant as it is voiced from a lead sheet: a dominant seventh
  // with a raised fifth and a raised ninth. The full seven-note altered stack
  // has no seven-letter spelling, so it is not what this symbol denotes.
  '7alt': parts('aug', { seventh: 'min7', alt: [[9, 1]] }),
  '13b9': parts('maj', {
    seventh: 'min7',
    alt: [
      [9, -1],
      [13, 0],
    ],
  }),
  maj13: parts('maj', {
    seventh: 'maj7',
    alt: [
      [9, 0],
      [13, 0],
    ],
  }),
  'maj7#11': parts('maj', { seventh: 'maj7', alt: [[11, 1]] }),
  min11: parts('min', {
    seventh: 'min7',
    alt: [
      [9, 0],
      [11, 0],
    ],
  }),
  min13: parts('min', {
    seventh: 'min7',
    alt: [
      [9, 0],
      [13, 0],
    ],
  }),
  minAdd9: parts('min', { add: [9] }),
  'min6/9': parts('min', { add: [6, 9] }),
};

/**
 * Reduce a spec to the one form that stands for its harmony.
 *
 * Two specs that name the same chord must compare equal, or a name lookup would
 * miss the chord it holds: an augmented fifth over a major triad *is* the
 * augmented triad, and a natural ninth over a chord with no seventh *is* an
 * added ninth. Normalizing is what lets `C7(#5)` and `C7#5` reach one spec, and
 * `C(9)` reach the same spec as `Cadd9`.
 *
 * Not part of the package's public surface: every spec the library hands out is
 * already normalized.
 *
 * @param spec The spec to reduce.
 * @returns An equivalent spec in canonical form.
 */
export function normalizeChordSpec(spec: ChordSpec): ChordSpec {
  let base = spec.base;
  const alterations = new Map<AlteredDegree, -1 | 0 | 1>();
  for (const alteration of spec.alterations ?? []) {
    alterations.set(alteration.degree, alteration.alter);
  }
  const additions = new Set(spec.additions ?? []);
  const omissions = new Set(spec.omissions ?? []);
  const fifth = alterations.get(5);
  if (fifth !== undefined) {
    // The alteration is the statement about the fifth, so a base that already
    // alters it steps back to its plain form before the two are combined.
    if (base === 'aug') {
      base = 'maj';
    } else if (base === 'dim') {
      base = 'min';
    }
    if (fifth === 0) {
      alterations.delete(5);
    } else if (base === 'maj' && fifth === 1) {
      base = 'aug';
      alterations.delete(5);
    } else if (base === 'min' && fifth === -1) {
      base = 'dim';
      alterations.delete(5);
    }
  }
  if (spec.seventh === undefined) {
    // Without a seventh under it, an unaltered upper degree is an added tone
    // rather than a tension: C(9) is the chord Cadd9 names.
    for (const [degree, alter] of [...alterations]) {
      if (degree !== 5 && alter === 0) {
        alterations.delete(degree);
        additions.add(degree);
      }
    }
  }
  const normalized: ChordSpec = {
    rootPc: spec.rootPc,
    base,
    alterations: [...alterations]
      .sort((a, b) => a[0] - b[0])
      .map(([degree, alter]) => ({ degree, alter })),
    additions: [...additions].sort((a, b) => a - b),
    omissions: [...omissions].sort((a, b) => a - b),
  };
  if (spec.seventh !== undefined) {
    normalized.seventh = spec.seventh;
  }
  if (spec.bassPc !== undefined) {
    normalized.bassPc = spec.bassPc;
  }
  return normalized;
}

/**
 * Derive the tones of a spec that is already validated and normalized.
 *
 * Not part of the package's public surface, and the one derivation that skips
 * {@link assertChordSpec}: the alias table below is built from it before the
 * checker's own tables are complete, and every other caller reaches it through
 * a public entry point that has already checked its spec.
 *
 * @param normalized A normalized spec whose parts the model defines.
 * @returns Semitone offsets above the root, ascending and deduplicated.
 */
function specIntervals(normalized: ChordSpec): number[] {
  const tones = new Map<number, number>(BASE_TONES[normalized.base]);
  for (const { degree, alter } of normalized.alterations) {
    if (degree === 5 && tones.has(5)) {
      tones.set(5, PERFECT_FIFTH + alter);
    }
  }
  for (const degree of normalized.omissions) {
    tones.delete(degree);
  }
  const offsets = new Set(tones.values());
  if (normalized.seventh !== undefined) {
    offsets.add(SEVENTH_SEMITONES[normalized.seventh]);
  }
  for (const { degree, alter } of normalized.alterations) {
    if (degree !== 5) {
      offsets.add((DEGREE_SEMITONES[degree] ?? 0) + alter);
    }
  }
  for (const degree of normalized.additions) {
    offsets.add(DEGREE_SEMITONES[degree] ?? 0);
  }
  return [...offsets].sort((a, b) => a - b);
}

/**
 * The semitone offsets above the root a spec sounds, ascending.
 *
 * The library's single derivation of chord tones: a name contributes nothing
 * here, so a combination of alterations no name covers yields its intervals the
 * same way a `maj7` does.
 *
 * @param spec The chord spec.
 * @returns Semitone offsets above the root, ascending and deduplicated.
 * @throws If any part of the spec is not one the model defines
 *   ({@link InvalidInputError}), exactly as {@link chordFromSpec} rejects it.
 *
 * @example
 * ```ts
 * import { chordSpecIntervals } from '@libraz/libcantus';
 * chordSpecIntervals({
 *   rootPc: 0,
 *   base: 'maj',
 *   seventh: 'min7',
 *   alterations: [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }],
 *   additions: [],
 *   omissions: [],
 * });
 * // [0, 4, 7, 10, 13, 18] — the C7(b9,#11) no quality name covers
 * ```
 *
 * @category Chords
 */
export function chordSpecIntervals(spec: ChordSpec): number[] {
  return specIntervals(assertChordSpec(spec));
}

/** Semitone offsets from the root for each supported chord quality. */
export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = Object.fromEntries(
  (Object.keys(QUALITY_SPECS) as ChordQuality[]).map((quality) => [
    quality,
    specIntervals(normalizeChordSpec(QUALITY_SPECS[quality])),
  ]),
) as Record<ChordQuality, number[]>;

/** A spec's identity as text, so two readings of one chord compare equal. */
function specKey(spec: ChordSpec): string {
  const normalized = normalizeChordSpec(spec);
  return [
    normalized.base,
    normalized.seventh ?? '',
    normalized.alterations.map(({ degree, alter }) => `${alter}:${degree}`).join('.'),
    normalized.additions.join('.'),
    normalized.omissions.join('.'),
  ].join('|');
}

/** The quality naming each spec exactly, keyed by the spec's own identity. */
const QUALITY_BY_KEY: ReadonlyMap<string, ChordQuality> = new Map(
  (Object.keys(QUALITY_SPECS) as ChordQuality[]).map((quality) => [
    specKey(QUALITY_SPECS[quality]),
    quality,
  ]),
);

/**
 * A copy of the spec a quality name stands for, rooted on `rootPc`.
 *
 * @param quality The quality name.
 * @param rootPc Root pitch class to root the spec on.
 * @param bassPc Optional slash-chord bass pitch class.
 * @returns The spec, freshly built so the alias table is never shared.
 * @throws If the quality is not a known name.
 *
 * @category Chords
 */
export function chordSpecForQuality(
  quality: ChordQuality,
  rootPc: number,
  bassPc?: number,
): ChordSpec {
  if (!Object.hasOwn(QUALITY_SPECS, quality)) {
    throw new InvalidInputError(`Unknown chord quality: ${String(quality)}`);
  }
  const spec = normalizeChordSpec(QUALITY_SPECS[quality]);
  spec.rootPc = rootPc;
  if (bassPc !== undefined) {
    spec.bassPc = bassPc;
  }
  return spec;
}

/**
 * The quality naming a spec exactly, or undefined when none does.
 *
 * Not part of the package's public surface: {@link chordSpecQuality} is the
 * total answer callers want, and this is the half of it that admits there is no
 * name.
 *
 * @param spec The chord spec.
 * @returns The quality name, or undefined.
 */
export function exactChordSpecQuality(spec: ChordSpec): ChordQuality | undefined {
  return QUALITY_BY_KEY.get(specKey(spec));
}

/**
 * The quality name a spec is reported under.
 *
 * A spec no name covers still has to answer, because `quality` is a required
 * field of every {@link Chord} and of the records that travel with one. The
 * answer is the *nearest* name: the largest named chord whose every tone this
 * spec also sounds, and failing that the name of its base. Nothing is lost by
 * it — the spec and the interval template still carry the alterations, and a
 * symbol is written from those rather than from this name.
 *
 * @param spec The chord spec.
 * @returns The name that fits the spec exactly, or the nearest one that fits
 *   inside it.
 * @throws If any part of the spec is not one the model defines
 *   ({@link InvalidInputError}), exactly as {@link chordFromSpec} rejects it.
 *
 * @example
 * ```ts
 * import { chordSpecQuality, parseChordSymbol } from '@libraz/libcantus';
 * parseChordSymbol('C7(b9,#11)').quality; // '7b9' — the nearest name
 * chordSpecQuality({ rootPc: 0, base: 'maj', seventh: 'min7', alterations: [],
 *   additions: [], omissions: [] }); // 'dom7'
 * ```
 *
 * @category Chords
 */
export function chordSpecQuality(spec: ChordSpec): ChordQuality {
  const checked = assertChordSpec(spec);
  const exact = exactChordSpecQuality(checked);
  if (exact !== undefined) {
    return exact;
  }
  const offsets = new Set(specIntervals(checked));
  let nearest: ChordQuality | undefined;
  let size = 0;
  for (const quality of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
    const template = QUALITY_INTERVALS[quality];
    if (template.length > size && template.every((offset) => offsets.has(offset))) {
      nearest = quality;
      size = template.length;
    }
  }
  return nearest ?? BASE_QUALITY[checked.base];
}

/** The degree and alteration each compound semitone offset names. */
const EXTENSION_BY_SEMITONE: ReadonlyMap<number, Alteration> = new Map([
  [13, { degree: 9, alter: -1 } as Alteration],
  [14, { degree: 9, alter: 0 } as Alteration],
  [15, { degree: 9, alter: 1 } as Alteration],
  [16, { degree: 11, alter: -1 } as Alteration],
  [17, { degree: 11, alter: 0 } as Alteration],
  [18, { degree: 11, alter: 1 } as Alteration],
  [20, { degree: 13, alter: -1 } as Alteration],
  [21, { degree: 13, alter: 0 } as Alteration],
  [22, { degree: 13, alter: 1 } as Alteration],
]);

/** Whether two ascending offset lists name the same tones. */
function sameOffsets(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((offset, index) => offset === b[index]);
}

/**
 * Read an interval template structurally, or undefined when it has no reading.
 *
 * The inverse of {@link chordSpecIntervals}, and checked against it: a template
 * whose reading does not rebuild the template exactly has no spec, which is how
 * an arbitrary set of offsets — a cluster, a voicing recorded as a chord — is
 * kept from being reported as a chord it is not.
 *
 * Not part of the package's public surface: `chordSpecOf` is the entry point,
 * and it has a chord's quality to fall back on when this finds no reading.
 *
 * @param intervals Semitone offsets above the root.
 * @returns The spec (rooted on pitch class 0), or undefined.
 */
export function chordSpecFromIntervals(intervals: readonly number[]): ChordSpec | undefined {
  const offsets = [...new Set(intervals)].sort((a, b) => a - b);
  const has = (offset: number): boolean => offsets.includes(offset);
  const alterations: Alteration[] = [];
  const additions: number[] = [];
  const omissions: number[] = [];
  if (!has(0)) {
    omissions.push(1);
  }
  const third = has(4) ? 4 : has(3) ? 3 : has(5) ? 5 : has(2) ? 2 : undefined;
  const fifth = has(7) ? 7 : has(6) ? 6 : has(8) ? 8 : undefined;
  let base: ChordBase = 'maj';
  if (third === 3) {
    base = 'min';
  } else if (third === 5) {
    base = 'sus4';
  } else if (third === 2) {
    base = 'sus2';
  } else if (third === undefined) {
    // A bare root and fifth is the power chord itself; anything more is a chord
    // that left its third out.
    if (fifth === 7 && offsets.length === 2 && has(0)) {
      base = 'power';
    } else {
      omissions.push(3);
    }
  }
  if (fifth === undefined) {
    omissions.push(5);
  } else if (fifth !== 7) {
    if (base === 'maj' && fifth === 8) {
      base = 'aug';
    } else if (base === 'min' && fifth === 6) {
      base = 'dim';
    } else {
      alterations.push({ degree: 5, alter: fifth === 6 ? -1 : 1 });
    }
  }
  let seventh: ChordSeventh | undefined = has(11) ? 'maj7' : has(10) ? 'min7' : undefined;
  if (has(9)) {
    // Nine semitones is the diminished seventh only over a diminished triad
    // with no seventh of its own; anywhere else it is the added sixth.
    if (seventh === undefined && base === 'dim') {
      seventh = 'dim7';
    } else {
      additions.push(6);
    }
  }
  for (const offset of offsets) {
    if (offset <= 12) {
      continue;
    }
    const extension = EXTENSION_BY_SEMITONE.get(offset);
    if (extension === undefined) {
      return undefined;
    }
    alterations.push(extension);
  }
  const spec: ChordSpec = { rootPc: 0, base, alterations, additions, omissions };
  if (seventh !== undefined) {
    spec.seventh = seventh;
  }
  const normalized = normalizeChordSpec(spec);
  return sameOffsets(specIntervals(normalized), offsets) ? normalized : undefined;
}

/** Reject a value that is not one of a fixed set of spec parts. */
function assertPart<T extends string>(value: T, allowed: readonly T[], name: string): T {
  if (!allowed.includes(value)) {
    throw new InvalidInputError(
      `${name} must be one of ${allowed.join(', ')}; received ${describeRejected(value)}`,
    );
  }
  return value;
}

/** Reject a degree a spec cannot alter, add, or omit. */
function assertDegreeIn(value: number, allowed: readonly number[], name: string): number {
  if (!allowed.includes(value)) {
    throw new InvalidInputError(
      `${name} must be one of ${allowed.join(', ')}; received ${String(value)}`,
    );
  }
  return value;
}

/** Reject a list of degrees that is not a list, before it is iterated. */
function assertDegreeList(
  value: readonly number[],
  allowed: readonly number[],
  name: string,
): void {
  if (!Array.isArray(value)) {
    throw new InvalidInputError(`${name} must be an array; received ${typeof value}`);
  }
  for (const degree of value) {
    assertDegreeIn(degree, allowed, name);
  }
}

/**
 * Validate a spec and return it in canonical form.
 *
 * A spec arrives from a caller as plain data, so every part is checked before
 * any of it reaches the interval derivation: an unknown base has no tones, an
 * alteration of a degree the chord cannot alter would silently contribute
 * nothing, and a list of degrees that is not a list would fail as a `TypeError`
 * from inside the derivation rather than as this library's own error.
 *
 * @param spec The spec to check.
 * @returns The normalized spec.
 * @throws If the spec is not an object, if `alterations`, `additions` or
 *   `omissions` is not an array, or if any part of the spec is not one the
 *   model defines ({@link InvalidInputError}).
 *
 * @category Chords
 */
export function assertChordSpec(spec: ChordSpec): ChordSpec {
  if (spec === null || typeof spec !== 'object') {
    throw new InvalidInputError(`chord spec must be an object; received ${typeof spec}`);
  }
  assertFiniteNumber(spec.rootPc, 'chord spec rootPc');
  if (spec.bassPc !== undefined) {
    assertFiniteNumber(spec.bassPc, 'chord spec bassPc');
  }
  assertPart(spec.base, Object.keys(BASE_TONES) as ChordBase[], 'chord spec base');
  if (spec.seventh !== undefined) {
    assertPart(
      spec.seventh,
      Object.keys(SEVENTH_SEMITONES) as ChordSeventh[],
      'chord spec seventh',
    );
  }
  if (!Array.isArray(spec.alterations)) {
    throw new InvalidInputError('chord spec alterations must be an array');
  }
  for (const alteration of spec.alterations) {
    assertDegreeIn(alteration?.degree, [5, 9, 11, 13], 'chord spec alteration degree');
    assertDegreeIn(alteration.alter, [-1, 0, 1], 'chord spec alteration');
  }
  assertDegreeList(spec.additions, [6, 9, 11, 13], 'chord spec additions');
  assertDegreeList(spec.omissions, OMITTABLE_DEGREES, 'chord spec omissions');
  return normalizeChordSpec(spec);
}
