import type {
  Alteration,
  ChordBase,
  ChordQuality,
  ChordSeventh,
  ChordSpec,
} from '../chord/index.js';
import { chordQualities } from '../chord/index.js';
import { chordSpecForQuality, exactChordSpecQuality } from '../chord/spec.js';

/**
 * The suffix a chord symbol writes after its root.
 *
 * The other direction from the grammar: the grammar reads a suffix into a spec,
 * this writes a spec back out as one. They are kept apart because a symbol is
 * read far more loosely than it is written — `-7`, `m7` and `min7` all read as
 * a minor seventh, and exactly one of them is written.
 */

/** Canonical lead-sheet suffix emitted for each chord quality when formatting. */
export const CANONICAL_SUFFIX: Record<ChordQuality, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  maj7: 'maj7',
  min7: 'm7',
  dom7: '7',
  dim7: 'dim7',
  m7b5: 'm7b5',
  minMaj7: 'mMaj7',
  minMaj9: 'mMaj9',
  minMaj11: 'mMaj11',
  minMaj13: 'mMaj13',
  aug7: 'aug7',
  augMaj7: 'augMaj7',
  majb5: 'maj(b5)',
  '6': '6',
  min6: 'm6',
  '6/9': '6/9',
  sus2: 'sus2',
  sus4: 'sus4',
  add9: 'add9',
  add11: 'add11',
  maj9: 'maj9',
  min9: 'm9',
  dom9: '9',
  '7b9': '7b9',
  '7#9': '7#9',
  '7#11': '7#11',
  '7b13': '7b13',
  '11': '11',
  '13': '13',
  '5': '5',
  '7sus4': '7sus4',
  '7b5': '7b5',
  '7alt': '7alt',
  '13b9': '13b9',
  maj13: 'maj13',
  'maj7#11': 'maj7#11',
  min11: 'm11',
  min13: 'm13',
  minAdd9: 'madd9',
  'min6/9': 'm6/9',
};

/**
 * The named chords a symbol can write as its core, with the spec each stands
 * for.
 *
 * A core carries no tension of its own beyond the ones a chart writes into the
 * name itself — the unaltered ninth of an `m9`, the flattened fifth of a `7b5`
 * — so what is left over is written as figures rather than swallowed by a name
 * that does not say it.
 */
const CORE_CANDIDATES: readonly (readonly [ChordQuality, ChordSpec])[] = chordQualities()
  .map((quality) => [quality, chordSpecForQuality(quality, 0)] as const)
  .filter(([, spec]) => spec.alterations.every(({ degree, alter }) => degree === 5 || alter === 0));

/** Whether `part` is one of the alterations `spec` carries. */
function carriesAlteration(spec: ChordSpec, part: Alteration): boolean {
  return spec.alterations.some(
    ({ degree, alter }) => degree === part.degree && alter === part.alter,
  );
}

/**
 * The largest named chord a spec can be written as before its figures.
 *
 * Every part of the name must be a part of the chord: same base and seventh,
 * and no alteration, addition or omission the chord does not have. The largest
 * such name is the core, which is what makes a minor ninth with a raised
 * eleventh `Cm9(#11)` rather than `Cm7(9,#11)`.
 */
function coreQuality(spec: ChordSpec): ChordQuality | undefined {
  let core: ChordQuality | undefined;
  let named = -1;
  for (const [quality, candidate] of CORE_CANDIDATES) {
    const size = candidate.alterations.length + candidate.additions.length;
    if (
      size <= named ||
      candidate.base !== spec.base ||
      candidate.seventh !== spec.seventh ||
      !candidate.alterations.every((part) => carriesAlteration(spec, part)) ||
      !candidate.additions.every((degree) => spec.additions.includes(degree)) ||
      !candidate.omissions.every((degree) => spec.omissions.includes(degree))
    ) {
      continue;
    }
    core = quality;
    named = size;
  }
  return core;
}

/** How each base opens a suffix that no quality name covers. */
const BASE_SUFFIX: Record<ChordBase, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  power: '5',
};

/** How each seventh is written where it opens a suffix of its own. */
const SEVENTH_SUFFIX: Record<ChordSeventh, string> = { maj7: 'maj7', min7: '7', dim7: 'dim7' };

/**
 * The major seventh written after a base letter, which has taken the word's
 * place: `mMaj7` and `augMaj7` capitalize where a bare `maj7` cannot, since the
 * letter before it would otherwise read as the start of the word.
 */
const MAJOR_SEVENTH_AFTER_BASE = 'Maj7';

/**
 * A core no quality name covers, written from its parts.
 *
 * A suspension carries its seventh in front of it the way a chart writes
 * `7sus4`, and a major base writes the seventh alone, since `maj` says nothing
 * a bare root does not. Both of those put the seventh at the front of the
 * suffix, where it is the lowercase word a chart writes — `maj7sus4`, not a
 * capitalized form that reads as a base letter.
 */
function builtCoreSuffix(spec: ChordSpec): string {
  const base = BASE_SUFFIX[spec.base];
  if (spec.seventh === undefined) {
    return base;
  }
  const seventh = SEVENTH_SUFFIX[spec.seventh];
  if (spec.base === 'sus2' || spec.base === 'sus4') {
    return `${seventh}${base}`;
  }
  if (spec.base === 'maj') {
    return seventh;
  }
  return `${base}${spec.seventh === 'maj7' ? MAJOR_SEVENTH_AFTER_BASE : seventh}`;
}

/**
 * The figures a symbol writes after its core, in degree order.
 *
 * Whatever the core already names is left out of them, and so is an omitted
 * tone: a symbol names the harmony a player reads, and one that spelled out its
 * own omissions would not read as a chart's.
 */
function figureText(spec: ChordSpec, core: ChordSpec | undefined): string[] {
  const figures: { degree: number; text: string }[] = [];
  for (const alteration of spec.alterations) {
    if (core !== undefined && carriesAlteration(core, alteration)) {
      continue;
    }
    const { degree, alter } = alteration;
    figures.push({ degree, text: `${alter < 0 ? 'b' : alter > 0 ? '#' : ''}${degree}` });
  }
  for (const degree of spec.additions) {
    if (core?.additions.includes(degree) !== true) {
      figures.push({ degree, text: `add${degree}` });
    }
  }
  return figures.sort((a, b) => a.degree - b.degree).map(({ text }) => text);
}

/**
 * The suffix a chord's structure is written as.
 *
 * A spec a quality name covers is written under that name, so every symbol a
 * chart already uses is unchanged. Anything else is written as the largest name
 * that fits inside it followed by the figures it does not cover — the way a
 * lead sheet writes tensions — so a combination no name covers still writes
 * itself out, and reads back as the same tones bar the ones it omits, which
 * {@link figureText} leaves unwritten.
 */
export function specSuffix(spec: ChordSpec): string {
  const named = exactChordSpecQuality(spec);
  if (named !== undefined) {
    return CANONICAL_SUFFIX[named];
  }
  const core = coreQuality(spec);
  const coreSpec = core === undefined ? undefined : chordSpecForQuality(core, 0);
  const text = core === undefined ? builtCoreSuffix(spec) : CANONICAL_SUFFIX[core];
  const figures = figureText(spec, coreSpec);
  return figures.length === 0 ? text : `${text}(${figures.join(',')})`;
}
