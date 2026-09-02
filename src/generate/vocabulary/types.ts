/**
 * The shared vocabulary model: a remembered figure, plus the conditions under
 * which a player would reach for it.
 *
 * A rule-based generator can build a correct line and still sound characterless,
 * because a player does not synthesise from scales — they assemble figures they
 * already know. Those figures are not derivable, so they are held as data here:
 * one record per figure, carrying its own applicability conditions, so choosing
 * one is a deterministic lookup rather than a branch in a generator.
 *
 * ## Provenance
 *
 * No entry may reproduce a phrase from a particular recorded song. Only figures
 * that belong to nobody are admitted — the common currency of a genre, the
 * things every player of that music already plays. Every entry records which
 * basis it qualifies under in {@link Vocabulary.provenance}, and the field is
 * required so the judgment cannot be skipped while curating.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import { ARTICULATIONS, type Articulation } from '../../core/instrument/index.js';
import {
  type MeterLike,
  meterAt,
  type TimeSignature,
  toMeterData,
} from '../../core/meter/index.js';
import {
  assertArray,
  assertFunction,
  assertOneOf,
  assertRange,
  assertRecord,
  assertTimeSignature,
  describeRejected,
} from '../../core/validation/index.js';
import { type ChordQuality, chordQualities } from '../../theory/chord/index.js';
import type { Draw } from '../context/draw.js';
import { PUBLIC_SECTIONS, type Section } from '../drums/internal.js';

/**
 * Every genre name a vocabulary entry may carry, in declaration order.
 *
 * Each built-in dictionary stocks part of the list, not all of it: the drum
 * patterns carry `motown`, `funk`, `blues`, `bossa`, `samba`, `gospel` and
 * `dnb`; the bass licks carry `motown`, `soul`, `funk`, `blues`, `jazz`,
 * `bossa`, `gospel`, `country` and `reggae`. Asking a dictionary for a genre it
 * has nothing for selects nothing rather than failing.
 *
 * The list is open in spirit even though the type is closed: a caller with a
 * genre of its own — or one the built-ins do not stock — supplies entries
 * through the generation context rather than waiting for this list to grow.
 *
 * @category Composition
 */
export const GENRES = Object.freeze([
  'pop',
  'rock',
  'motown',
  'funk',
  'soul',
  'gospel',
  'jazz',
  'blues',
  'bossa',
  'samba',
  'reggae',
  'country',
  'hiphop',
  'house',
  'dnb',
] as const);

/**
 * The genre a figure belongs to. Genre is what selects material; it never
 * deforms or rejects it.
 *
 * @category Composition
 */
export type Genre = (typeof GENRES)[number];

/**
 * Every ground on which a figure may enter a dictionary, in declaration order.
 *
 * - `'idiom'`: a genre-defining figure no one owns, played by every player of
 *   that music — a backbeat, a walking approach, a two-and-four side stick.
 * - `'construction'`: derived here from the genre's rhythmic grid rather than
 *   remembered from any performance.
 * - `'traditional'`: from a folk or traditional repertoire with no author.
 *
 * @category Composition
 */
export const PROVENANCE_BASES = Object.freeze(['idiom', 'construction', 'traditional'] as const);

/**
 * The ground on which a figure qualifies for a dictionary.
 *
 * @category Composition
 */
export type ProvenanceBasis = (typeof PROVENANCE_BASES)[number];

/**
 * Why a figure may be published as vocabulary.
 *
 * @category Composition
 */
export type Provenance = {
  /** Which ground the figure qualifies under. */
  basis: ProvenanceBasis;
  /**
   * What the figure is, in the terms a player would use — "the genre's
   * two-and-four side stick", not the name of a record it appears on.
   */
  note: string;
};

/**
 * One remembered figure, together with the conditions it fits.
 *
 * The optional conditions are read as "no restriction" when absent: an entry
 * with no `sections` fits every section, one with no `tempoRange` fits every
 * tempo. {@link Vocabulary.difficulty} is on the same 1..5 scale as the
 * playability report, and is compared against the difficulty ceiling: an entry
 * harder than the ceiling is rejected, never simplified in place.
 *
 * @typeParam T - The material this kind of figure is made of: chord-relative
 *   degrees for a bass lick, voices on a grid for a drum pattern.
 *
 * @category Composition
 */
export type Vocabulary<T> = {
  /** Stable identifier; a caller entry with the same id replaces a built-in. */
  id: string;
  genre: Genre;
  /** The figure itself. */
  material: T;
  /**
   * How the figure is played, over and above the material's own strokes.
   *
   * These are requirements, not decoration: where a query names the techniques
   * the instrument can produce, an entry asking for one the instrument does not
   * have is not offered. A kit with no flam is never handed flam material.
   */
  articulations: Articulation[];
  /** Chord qualities the figure works over; absent means any chord. */
  fitsOver?: ChordQuality[];
  /** Sections the figure suits; absent means any section. */
  sections?: Section[];
  /** Inclusive tempo band in BPM; absent means any tempo. */
  tempoRange?: [number, number];
  /** Time signature the figure is written in; absent means any. */
  ts?: TimeSignature;
  /** How hard the figure is to play, from 1 to 5. */
  difficulty: number;
  /** Why this figure may be published; see the module documentation. */
  provenance: Provenance;
};

/**
 * What a generator knows about the moment it is choosing a figure for.
 *
 * Every field is optional and an absent field asks nothing: a query with no
 * genre matches every genre, exactly as an entry with no `sections` matches
 * every section.
 *
 * @category Composition
 */
export type VocabularyQuery = {
  genre?: Genre;
  section?: Section;
  /** Tempo in BPM, matched against each entry's band. */
  bpm?: number;
  /** The meter in force, matched against each entry's own signature. */
  ts?: MeterLike;
  /** The difficulty ceiling: entries above it are rejected. */
  difficulty?: number;
  /** The chord in force, matched against each entry's `fitsOver`. */
  quality?: ChordQuality;
  /**
   * The techniques the instrument this part is written for can produce, from
   * its profile. An entry asking for one that is not here is not offered;
   * absent asks nothing, which is the programmed case.
   */
  articulations?: readonly Articulation[];
};

/** Whether two time signatures name the same bar. */
function sameTs(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

/**
 * Whether one entry answers a query.
 *
 * @param entry The dictionary entry.
 * @param query What the generator knows about the moment.
 * @returns True when every condition the entry states is met.
 *
 * @category Composition
 */
export function fitsQuery<T>(entry: Vocabulary<T>, query: VocabularyQuery): boolean {
  // Both sides are read field by field below, so both are read as records
  // first: a `null` from a JavaScript caller or a restored session would report
  // this library's own `TypeError` from inside the comparison instead.
  const candidate = assertRecord<Vocabulary<T>>(entry, 'vocabulary entry');
  const asked = assertRecord<VocabularyQuery>(query, 'vocabulary query');
  if (asked.genre !== undefined && candidate.genre !== asked.genre) {
    return false;
  }
  if (
    asked.section !== undefined &&
    candidate.sections &&
    !candidate.sections.includes(asked.section)
  ) {
    return false;
  }
  if (asked.bpm !== undefined && candidate.tempoRange) {
    const [low, high] = candidate.tempoRange;
    if (asked.bpm < low || asked.bpm > high) {
      return false;
    }
  }
  if (
    asked.ts !== undefined &&
    candidate.ts &&
    !sameTs(candidate.ts, meterAt(0, toMeterData(asked.ts, 'ts')))
  ) {
    return false;
  }
  if (
    asked.quality !== undefined &&
    candidate.fitsOver &&
    !candidate.fitsOver.includes(asked.quality)
  ) {
    return false;
  }
  if (asked.articulations !== undefined) {
    const available = asked.articulations;
    if (candidate.articulations.some((articulation) => !available.includes(articulation))) {
      return false;
    }
  }
  // The ceiling is the one condition the entry does not state itself: it is the
  // caller's limit, and it only ever takes candidates away.
  return asked.difficulty === undefined || candidate.difficulty <= asked.difficulty;
}

/**
 * Every entry of a dictionary that answers a query, in dictionary order.
 *
 * Order is preserved so a selection made from the result is reproducible: the
 * same dictionary and the same query always offer the same candidates in the
 * same positions.
 *
 * @param dictionary The entries to search.
 * @param query What the generator knows about the moment.
 * @returns The matching entries, in the order they appear in the dictionary.
 *
 * @example
 * ```ts
 * import { BASS_LICKS, selectVocabulary } from '@libraz/libcantus';
 * const candidates = selectVocabulary(BASS_LICKS, { genre: 'motown', difficulty: 3 });
 * ```
 *
 * @category Composition
 */
export function selectVocabulary<T>(
  dictionary: readonly Vocabulary<T>[],
  query: VocabularyQuery,
): Vocabulary<T>[] {
  return assertArray<Vocabulary<T>>(dictionary, 'dictionary').filter((entry) =>
    fitsQuery(entry, query),
  );
}

/**
 * Choose one entry from a dictionary at a position.
 *
 * The choice is addressed by the path, not by how many choices came before it,
 * so the figure at bar 12 does not move because the figure at bar 3 changed.
 *
 * @param dictionary The entries to choose from.
 * @param query What the generator knows about the moment.
 * @param draw The position-addressed sampler.
 * @param path Where the choice is being made.
 * @returns The chosen entry, or undefined when nothing fits.
 *
 * @category Composition
 */
export function pickVocabulary<T>(
  dictionary: readonly Vocabulary<T>[],
  query: VocabularyQuery,
  draw: Draw,
  ...path: readonly (string | number)[]
): Vocabulary<T> | undefined {
  const candidates = selectVocabulary(dictionary, query);
  if (candidates.length === 0) {
    return undefined;
  }
  const sampler = assertRecord<Draw>(draw, 'draw');
  assertFunction(sampler.range, 'draw.range');
  return candidates[sampler.range(0, candidates.length - 1, ...path)];
}

/**
 * Merge a caller's dictionary into a built-in one.
 *
 * Caller entries are appended, so every built-in figure stays reachable, except
 * where a caller entry carries the id of a built-in: that one is a replacement
 * and takes the built-in's place, which is how a caller corrects a figure it
 * disagrees with rather than having both offered.
 *
 * @param builtIn The library's own entries.
 * @param supplied The caller's entries, if any.
 * @returns The merged dictionary, built-ins first.
 *
 * @category Composition
 */
export function mergeVocabulary<T>(
  builtIn: readonly Vocabulary<T>[],
  supplied: readonly Vocabulary<T>[] | undefined,
): Vocabulary<T>[] {
  const library = assertArray<Vocabulary<T>>(builtIn, 'builtIn');
  const extra =
    supplied === undefined || supplied === null
      ? []
      : assertArray<Vocabulary<T>>(supplied, 'supplied');
  if (extra.length === 0) {
    return [...library];
  }
  // The id is what decides whether a caller's entry replaces a built-in, so
  // every entry on both sides is read as one before the ids are compared: an
  // entry that is not a record has no id to match on, and reading it as one
  // would report this library's own `TypeError` from inside the merge.
  const idOf = (entry: Vocabulary<T>, index: number, side: string): string =>
    assertRecord<Vocabulary<T>>(entry, `${side}[${index}]`).id;
  const byId = new Map(extra.map((entry, index) => [idOf(entry, index, 'supplied'), entry]));
  const merged = library.map((entry, index) => byId.get(idOf(entry, index, 'builtIn')) ?? entry);
  const replaced = new Set(library.map((entry, index) => idOf(entry, index, 'builtIn')));
  for (const entry of extra) {
    if (!replaced.has(entry.id)) {
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * Narrow a mixed dictionary to the entries one part understands.
 *
 * A context carries a single list, because a caller thinks in terms of "the
 * vocabulary of this piece" rather than of one list per generator. Each
 * generator recognises its own material by shape, so an entry meant for the
 * bass is invisible to the drums instead of being mis-read by it.
 *
 * @param entries The mixed dictionary.
 * @param isMaterial Guard recognising one kind of material.
 * @returns The entries whose material the guard accepts.
 *
 * @category Composition
 */
export function vocabularyOfKind<T>(
  entries: readonly Vocabulary<unknown>[],
  isMaterial: (material: unknown) => material is T,
): Vocabulary<T>[] {
  const out: Vocabulary<T>[] = [];
  const recognises = assertFunction<(material: unknown) => material is T>(isMaterial, 'isMaterial');
  for (const entry of assertArray<Vocabulary<unknown>>(entries, 'entries')) {
    if (recognises(assertRecord<Vocabulary<unknown>>(entry, 'entry').material)) {
      out.push(entry as Vocabulary<T>);
    }
  }
  return out;
}

/**
 * Check a list of names against the table that defines them, the list included.
 *
 * A required list that is absent is the case this exists for: reading it as a
 * list would report the library's own TypeError, where every other field of an
 * entry from a config file is refused by name.
 */
function assertNames(values: unknown, allowed: readonly string[], label: string): void {
  if (!Array.isArray(values)) {
    throw new InvalidInputError(
      `${label} must be an array of names; received ${describeRejected(values)}`,
    );
  }
  values.forEach((value, index) => {
    assertOneOf(value, allowed, `${label}[${index}]`);
  });
}

/**
 * Reject a dictionary entry whose declared fields are outside their domains.
 *
 * Applied to caller-supplied entries at the point they enter a generator: an
 * entry with a difficulty of 40 would otherwise pass every ceiling and be
 * chosen for a beginner's part.
 *
 * @param entry The entry to check.
 * @param label Name used in the error message.
 * @returns The entry, unchanged.
 * @throws If the difficulty is outside 1..5 or the tempo band is inverted.
 *
 * @category Composition
 */
export function assertVocabulary<T>(
  entry: Vocabulary<T>,
  label = 'vocabulary entry',
): Vocabulary<T> {
  // The names are checked against the tables that define them rather than
  // against a list written out again here: a genre or an articulation added to
  // the library is admitted by this check on the same commit, and a typo from a
  // JavaScript caller or a config file is a stated error instead of an entry
  // that silently matches nothing.
  if (typeof entry !== 'object' || entry === null) {
    throw new InvalidInputError(
      `${label} must be a dictionary entry; received ${describeRejected(entry)}`,
    );
  }
  assertOneOf(entry.genre, GENRES, `${label} genre`);
  assertOneOf(entry.provenance?.basis, PROVENANCE_BASES, `${label} provenance basis`);
  assertNames(entry.articulations, ARTICULATIONS, `${label} articulations`);
  if (entry.sections !== undefined) {
    assertNames(entry.sections, PUBLIC_SECTIONS, `${label} sections`);
  }
  if (entry.fitsOver !== undefined) {
    assertNames(entry.fitsOver, chordQualities(), `${label} fitsOver`);
  }
  if (entry.ts !== undefined) {
    assertTimeSignature(entry.ts, `${label} ts`);
  }
  assertRange(entry.difficulty, 1, 5, `${label} difficulty`);
  if (entry.tempoRange !== undefined) {
    if (!Array.isArray(entry.tempoRange) || entry.tempoRange.length !== 2) {
      throw new InvalidInputError(
        `${label} tempoRange must be a low and a high tempo; received ${describeRejected(entry.tempoRange)}`,
      );
    }
    const [low, high] = entry.tempoRange;
    assertRange(low, Number.MIN_VALUE, 1000, `${label} tempoRange low`);
    assertRange(high, low, 1000, `${label} tempoRange high`);
  }
  return entry;
}
