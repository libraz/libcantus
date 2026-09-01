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

import { ARTICULATIONS, type Articulation } from '../../core/instrument/index.js';
import {
  type MeterLike,
  meterAt,
  type TimeSignature,
  toMeterData,
} from '../../core/meter/index.js';
import { assertOneOf, assertRange, assertTimeSignature } from '../../core/validation/index.js';
import { type ChordQuality, chordQualities } from '../../theory/chord/index.js';
import type { Draw } from '../context/draw.js';
import { PUBLIC_SECTIONS, type Section } from '../drums/internal.js';

/**
 * Every genre the built-in dictionaries name, in declaration order.
 *
 * The list is open in spirit even though the type is closed: a caller with a
 * genre of its own supplies entries through the generation context rather than
 * waiting for this list to grow.
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
  if (query.genre !== undefined && entry.genre !== query.genre) {
    return false;
  }
  if (query.section !== undefined && entry.sections && !entry.sections.includes(query.section)) {
    return false;
  }
  if (query.bpm !== undefined && entry.tempoRange) {
    const [low, high] = entry.tempoRange;
    if (query.bpm < low || query.bpm > high) {
      return false;
    }
  }
  if (
    query.ts !== undefined &&
    entry.ts &&
    !sameTs(entry.ts, meterAt(0, toMeterData(query.ts, 'ts')))
  ) {
    return false;
  }
  if (query.quality !== undefined && entry.fitsOver && !entry.fitsOver.includes(query.quality)) {
    return false;
  }
  if (query.articulations !== undefined) {
    const available = query.articulations;
    if (entry.articulations.some((articulation) => !available.includes(articulation))) {
      return false;
    }
  }
  // The ceiling is the one condition the entry does not state itself: it is the
  // caller's limit, and it only ever takes candidates away.
  return query.difficulty === undefined || entry.difficulty <= query.difficulty;
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
  return dictionary.filter((entry) => fitsQuery(entry, query));
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
  return candidates[draw.range(0, candidates.length - 1, ...path)];
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
  if (!supplied || supplied.length === 0) {
    return [...builtIn];
  }
  const byId = new Map(supplied.map((entry) => [entry.id, entry]));
  const merged = builtIn.map((entry) => byId.get(entry.id) ?? entry);
  const replaced = new Set(builtIn.map((entry) => entry.id));
  for (const entry of supplied) {
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
  for (const entry of entries) {
    if (isMaterial(entry.material)) {
      out.push(entry as Vocabulary<T>);
    }
  }
  return out;
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
  assertOneOf(entry.genre, GENRES, `${label} genre`);
  assertOneOf(entry.provenance?.basis, PROVENANCE_BASES, `${label} provenance basis`);
  entry.articulations.forEach((articulation, index) => {
    assertOneOf(articulation, ARTICULATIONS, `${label} articulations[${index}]`);
  });
  entry.sections?.forEach((section, index) => {
    assertOneOf(section, PUBLIC_SECTIONS, `${label} sections[${index}]`);
  });
  entry.fitsOver?.forEach((quality, index) => {
    assertOneOf(quality, chordQualities(), `${label} fitsOver[${index}]`);
  });
  if (entry.ts !== undefined) {
    assertTimeSignature(entry.ts, `${label} ts`);
  }
  assertRange(entry.difficulty, 1, 5, `${label} difficulty`);
  if (entry.tempoRange) {
    const [low, high] = entry.tempoRange;
    assertRange(low, Number.MIN_VALUE, 1000, `${label} tempoRange low`);
    assertRange(high, low, 1000, `${label} tempoRange high`);
  }
  return entry;
}
