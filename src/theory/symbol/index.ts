/**
 * Lead-sheet chord symbol parsing and formatting.
 *
 * Bridges the informal `<root><quality>[/<bass>]` notation musicians write
 * (`Cmaj7`, `F#m7b5`, `Bb7`, `C/G`) and the library's structured {@link Chord}
 * type, so callers can accept/emit plain text at the edges of the API.
 *
 * The root and the slash bass are note names, so they are read and written in
 * whichever notation system the caller names — a German chart's `H7`, `As7` and
 * `Ges/B` included. Unlike a note name, a chord symbol is never attributed to a
 * system on its own: German `B` is a B flat and English `B` a B natural, and a
 * symbol carries no `dur`/`moll` word to break the tie, so the most common
 * symbol in the vocabulary would otherwise change chord with the source it came
 * from. With no system given a symbol is English.
 */

import {
  InvalidInputError,
  type ParseResult,
  parseFailure,
  unwrapParse,
} from '../../core/errors/index.js';
import {
  type NoteNameOptions,
  noteToPitchClass,
  parseNote,
  pitchClassOf as pitchClass,
  spelledInterval,
  transposeByInterval,
  transposeNote,
} from '../../core/pitch/index.js';
import { assertFiniteSemitones, describeRejected } from '../../core/validation/index.js';
import type { Chord, PitchSpelling } from '../chord/index.js';
import { chordPitchClasses, chordSpecOf } from '../chord/index.js';
import { type ChordLike, toChordData } from './coerce.js';
import { chordAfterRoot, DEFAULT_SYSTEM, rootSplits } from './grammar.js';
import { CANONICAL_SUFFIX, specSuffix } from './suffix.js';

// The unit's public surface is this file, so what the neighbouring modules
// define is re-exported from here rather than reached for directly.
export { type ChordLike, toChordData } from './coerce.js';

import {
  bareSpelling,
  bySameStep,
  carriedBass,
  hintFor,
  isWrittenSpelling,
  onAccidentalSide,
  pitchClassName,
  plainSpelling,
  rootSpellingFor,
  symbolName,
} from './spelling.js';

/**
 * Parse a lead-sheet chord symbol into a {@link Chord}.
 *
 * Accepts `<root><quality>[/<bass>]`, e.g. `Cmaj7`, `F#m7b5`, `Bb7`, `C/G`,
 * `C6/9`, `C6/9/E`. Root and bass letters are case-insensitive, matching
 * {@link parseNote}. A `/` is ambiguous between a slash bass and the `6/9`
 * quality; the text splits at the last `/` whose right-hand side is a valid
 * bare note preceded by a recognized quality, so `6/9` (with or without a
 * further slash bass) parses as a quality.
 *
 * The root and bass are read in `system`, so a German chart's `H7`, `As7` and
 * `Ges/B` are read by asking for `'german'`. The system is never inferred: with
 * none given the symbol is English, where `B` is the B natural and `H` no note
 * at all. Case carries nothing in a chord symbol — unlike a German key name,
 * where the case of the tonic is the mode — so the quality suffix alone says
 * major or minor. Where a German root's flat suffix could equally open the
 * quality, the longest root that leaves a known quality behind wins: `Asus4` is
 * an A suspended chord and `Assus4` the A flat one.
 *
 * The quality suffix is read structurally when no name covers it, so a chart's
 * bracketed tensions parse as readily as the names do: `Cmaj7(#11)`,
 * `C7(b9,#11)`, `C7(13)`, `Csus4(add9)`, `C-Δ9`, `C6/9(#11)`. A `/` between two
 * figures separates them as it does inside brackets, which is what the sixth
 * and ninth of a `6/9` are. Such a chord carries the tones it names and reports
 * the nearest quality name (see {@link chordSpecQuality}); read
 * {@link chordSpecOf} for its structure.
 *
 * The parsed chord carries the root/bass spellings as enharmonic hints
 * (`rootSpelling`/`bassSpelling`) so {@link formatChordSymbol} can reproduce
 * flat spellings such as `Bbmaj7` instead of respelling them with sharps.
 *
 * @param text The chord symbol text.
 * @param opts `system` reads the root and bass in that notation system instead
 *   of English.
 * @returns The parsed chord.
 * @throws If the root or quality is not recognized in that system. Use
 *   {@link tryParseChordSymbol} where failure is ordinary, such as a chord
 *   field read on every keystroke.
 * @example
 * ```ts
 * import { parseChordSymbol, formatChordSymbol } from '@libraz/libcantus';
 * const c = parseChordSymbol('Bbmaj7');
 * formatChordSymbol(c); // 'Bbmaj7' — flat spelling is preserved on round-trip
 * parseChordSymbol('H7', { system: 'german' }).rootPc; // 11 — the B natural
 * parseChordSymbol('B', { system: 'german' }).rootPc; // 10 — the German B flat
 * ```
 * @category Chords
 */
export function parseChordSymbol(text: string, opts?: NoteNameOptions): Chord {
  return unwrapParse(tryParseChordSymbol(text, opts));
}

/**
 * Parse a lead-sheet chord symbol, reporting failure instead of throwing it.
 *
 * The same reading as {@link parseChordSymbol} — that function is this one with
 * its error thrown — for the callers where a symbol that does not parse yet is
 * the normal state of the input rather than a fault: a chord field says what is
 * wrong with what has been typed so far, and does not need a `try` around every
 * keystroke to do it.
 *
 * @param text The chord symbol text.
 * @param opts `system` reads the root and bass in that notation system instead
 *   of English.
 * @returns The chord, or the error explaining why the text is not one.
 * @example
 * ```ts
 * import { tryParseChordSymbol } from '@libraz/libcantus';
 * const result = tryParseChordSymbol('Cmaj7(#11)');
 * result.ok ? result.value.intervals : result.error.message;
 * ```
 * @category Chords
 */
export function tryParseChordSymbol(text: string, opts?: NoteNameOptions): ParseResult<Chord> {
  try {
    if (typeof text !== 'string') {
      throw new InvalidInputError(`chord symbol must be a string; received ${typeof text}`);
    }
    const system = opts?.system ?? DEFAULT_SYSTEM;
    const trimmed = text
      .trim()
      .replaceAll('♯', '#')
      .replaceAll('♭', 'b')
      .replaceAll('𝄪', 'x')
      .replaceAll('𝄫', 'bb')
      // Both delta glyphs in circulation stand for the same major seventh.
      .replaceAll('∆', 'Δ');
    const splits = rootSplits(trimmed, system);
    if (splits.length === 0) {
      throw new InvalidInputError(`Invalid chord symbol: ${describeRejected(text)}`);
    }
    for (const { root, rest } of splits) {
      const chord = chordAfterRoot(root, rest, system);
      if (chord !== undefined) {
        return { ok: true, value: chord };
      }
    }
    throw new InvalidInputError(`Unrecognized chord quality: ${describeRejected(text)}`);
  } catch (error) {
    return parseFailure(error);
  }
}

/**
 * How a chord symbol is written: in which notation system, and on which side of
 * the enharmonic fence.
 *
 * @category Chords
 */
export type ChordSymbolOptions = NoteNameOptions & {
  /**
   * Which side of the staff the whole symbol is written on: `true` writes it in
   * flats, `false` in sharps. The root, the slash bass and the chord's tones are
   * spelled together, so a symbol never pairs a flat root with a sharp bass, and
   * a spelling hint already on the requested side is kept rather than renamed.
   * Where that side cannot spell the chord at all, the spelling a chart writes
   * wins over an unwritable one.
   */
  flats?: boolean;
};

/**
 * Format a {@link Chord} as a lead-sheet chord symbol.
 *
 * The inverse of {@link parseChordSymbol} in every notation system: each
 * quality maps to one canonical suffix spelling, the root and bass are written
 * in `system`, and a slash bass is appended only when it differs from the root.
 * Every symbol written here reads back through {@link parseChordSymbol} as the
 * same root, sounding bass and tones apart from the degrees the chord omits —
 * whatever combination of tensions it carries, and whether or not a quality
 * name covers it. Those omissions are the one difference the round trip has: a
 * chord that leaves a degree out is written without saying so, so reading the
 * symbol back puts the degree in.
 * When the chord carries `rootSpelling`/`bassSpelling` hints (as chords from
 * {@link parseChordSymbol} do) and no explicit `flats` preference is given, the
 * hints are reused so flat symbols round-trip unchanged.
 *
 * The suffix is written from the chord's own tones (see {@link chordSpecOf}),
 * not from its quality name, so a chord carrying alterations no name covers is
 * written out in full — `C7(b9,#11)` — rather than under the nearest name. A
 * tone the chord leaves out is not written: the symbol names the harmony, so a
 * fifth-less dominant is still `C7`.
 *
 * @param chord The chord to format, as a chord symbol, chord data, or a
 *   `Chord`.
 * @param opts `system` writes the root and bass in that notation system instead
 *   of English; `flats` chooses the side of the staff the whole symbol is
 *   written on, as {@link ChordSymbolOptions} describes.
 * @returns The chord symbol text.
 * @example
 * ```ts
 * import { makeChord, formatChordSymbol, parseChordSymbol } from '@libraz/libcantus';
 * formatChordSymbol(makeChord(0, 'min7')); // 'Cm7'
 * formatChordSymbol(parseChordSymbol('Bb7'), { system: 'german' }); // 'B7'
 * formatChordSymbol(parseChordSymbol('B7'), { system: 'german' }); // 'H7'
 * ```
 * @category Chords
 */
export function formatChordSymbol(chord: ChordLike, opts?: ChordSymbolOptions): string {
  // A chord rebuilt from JSON or arrived at through arithmetic can carry a
  // non-finite root or a quality this module has no suffix for; formatting
  // those produces 'C' and 'Cundefined', which read as real symbols.
  const data = toChordData(chord);
  if (!Object.hasOwn(CANONICAL_SUFFIX, data.quality)) {
    throw new InvalidInputError(`Unknown chord quality: ${String(data.quality)}`);
  }
  const system = opts?.system ?? DEFAULT_SYSTEM;
  const flats = opts?.flats;
  const rootPc = pitchClass(data.rootPc);
  const rootHint = hintFor(data.rootSpelling, rootPc);
  const rootSpelling = rootSpellingFor(rootPc, rootHint, flats);
  const suffix = specSuffix(chordSpecOf(data));
  let symbol = `${symbolName(rootSpelling, system)}${suffix}`;
  if (data.bassPc !== undefined && pitchClass(data.bassPc) !== rootPc) {
    const bassPc = pitchClass(data.bassPc);
    const bassHint = hintFor(data.bassSpelling, bassPc);
    // The chord's own tones, without the bass: a bass that is one of them is
    // spelled as the chord spells it, and the point of the test is to tell
    // that bass from the one merely standing under the chord.
    const tonePcs = new Set(chordPitchClasses(data, { includeBass: false }));
    // Respelling the root respells the bass with it: the two are one symbol, so
    // a preference that moves the root to the flat side takes the bass there
    // too rather than leaving a sharp bass under a flat root. The step the root
    // moved by is what keeps the bass inside the chord the root names, but it
    // is not a licence to write a name no chart writes, so a carried bass that
    // lands outside the written vocabulary falls back to the plain name of its
    // pitch class — the same policy transposing the symbol applies.
    const bassName =
      rootHint !== undefined && bassHint !== undefined
        ? symbolName(
            carriedBass(bassHint, rootHint, rootSpelling, flats ?? rootSpelling.alter < 0, (pc) =>
              tonePcs.has(pc),
            ),
            system,
          )
        : pitchClassName(bassPc, bassHint, system, flats, rootSpelling.alter < 0);
    symbol += `/${bassName}`;
  }
  return symbol;
}

/**
 * The spellings a caller attaches to a chord, which transposition carries with
 * it: the root, the slash bass, and one per chord tone.
 */
export type ChordSpellings = {
  /** How the root is written. */
  rootSpelling?: PitchSpelling;
  /** How the slash bass is written. */
  bassSpelling?: PitchSpelling;
  /** How each chord tone is written. */
  toneSpellings?: PitchSpelling[];
};

/**
 * Move a chord's spellings by a semitone count, keeping them writable.
 *
 * Moving a spelling by letter is what keeps B flat and A sharp apart, but
 * carried far enough it lands on a root no chart writes: B flat up a semitone
 * spells C flat, D flat up one spells E double flat. Where that happens the
 * spelling falls back to the plain name of the pitch class, taken on the
 * accidental side already in force — an explicit preference first, then the
 * side the moved root reads on, then the root's own, then the bass's — so one
 * symbol never pairs a sharp root with a flat bass. The same fallback catches a
 * root whose own letters would leave the bass unwritable, so `Cmaj7/B` up a
 * tritone is `Gbmaj7/F` rather than an F# chord over a bass spelled E#. The
 * bass and the tones then
 * follow the root's own step rather than the semitone count, so respelling the
 * root respells the chord with it and the letter distances inside the chord
 * survive: `Bb7/D` up a semitone is `B7/D#`, the third of the chord it names,
 * and never `B7/Eb`, a note B7 does not contain.
 *
 * A transposition by whole octaves returns every letter to itself and is left
 * alone: a chart that writes C flat keeps it.
 *
 * @param spellings The chord's spellings.
 * @param semitones The signed semitone offset.
 * @param flats Writes the whole symbol on the flat or the sharp side: the root
 *   is chosen so that the bass carried with it lands there too.
 * @returns The moved spellings, carrying only the ones that were given.
 */
export function transposeChordSpellings(
  spellings: ChordSpellings,
  semitones: number,
  flats?: boolean,
): ChordSpellings {
  const byLetter = (spelling: PitchSpelling | undefined): PitchSpelling | undefined =>
    spelling === undefined ? undefined : bareSpelling(transposeNote(spelling, semitones));
  const movedRoot = byLetter(spellings.rootSpelling);
  const movedBass = byLetter(spellings.bassSpelling);
  const side = [movedRoot, spellings.rootSpelling, movedBass, spellings.bassSpelling].find(
    (spelling) => spelling !== undefined && spelling.alter !== 0,
  );
  const preferFlats = flats ?? (side !== undefined && side.alter < 0);
  const octaveOnly = pitchClass(semitones) === 0;
  const plainName = (spelling: PitchSpelling, asFlat: boolean): PitchSpelling =>
    plainSpelling(noteToPitchClass(spelling), asFlat);
  const writable = (spelling: PitchSpelling): PitchSpelling =>
    octaveOnly || isWrittenSpelling(spelling) ? spelling : plainName(spelling, preferFlats);
  const root = spellings.rootSpelling;
  const bass = spellings.bassSpelling;
  // Whether a candidate root leaves a bass the chart can still write, on the
  // side the caller asked for. A bass that already reads as an odd name is no
  // test of the root, but one that reads plainly must stay that way, so a chord
  // whose sharp root would need E# under it is written on the flat side.
  const carriesBass = (candidate: PitchSpelling): boolean => {
    if (root === undefined || bass === undefined || octaveOnly || !isWrittenSpelling(bass)) {
      return true;
    }
    const carried = bySameStep(bass, root, candidate);
    return isWrittenSpelling(carried) && onAccidentalSide(carried, flats);
  };
  const moved: ChordSpellings = {};
  if (movedRoot !== undefined) {
    // The root is chosen for the symbol as a whole: the letter it moves to
    // first, then the plain name of its pitch class on the side in force, then
    // the other side. A caller who named a side is offered one more reading
    // before the symbol turns around — the letters' own spelling, odd as it may
    // be — because `Cb/Gb` is the flat side of that chord and `B/Gb` is not a
    // chord at all. Without a named side the written vocabulary wins.
    const asked = flats !== undefined && !octaveOnly && !isWrittenSpelling(movedRoot);
    const candidates = [
      ...(octaveOnly || isWrittenSpelling(movedRoot) ? [movedRoot] : []),
      plainName(movedRoot, preferFlats),
      ...(asked ? [movedRoot] : []),
      plainName(movedRoot, !preferFlats),
    ];
    moved.rootSpelling = candidates.find(carriesBass) ?? plainName(movedRoot, preferFlats);
  }
  // The one step the whole chord moves by: from the root as written to the root
  // as it comes out, fallback included. Everything below it takes this same step
  // instead of the semitone count, which is what keeps the bass and the tones
  // inside the chord the root names.
  const step =
    root !== undefined && moved.rootSpelling !== undefined
      ? spelledInterval(root, moved.rootSpelling)
      : undefined;
  const byStep = (spelling: PitchSpelling): PitchSpelling =>
    bareSpelling(
      step === undefined ? transposeNote(spelling, semitones) : transposeByInterval(spelling, step),
    );
  if (bass !== undefined) {
    moved.bassSpelling = writable(byStep(bass));
  }
  if (spellings.toneSpellings !== undefined) {
    moved.toneSpellings = spellings.toneSpellings.map(byStep);
  }
  return moved;
}

/**
 * Transpose a chord symbol by a number of semitones.
 *
 * The symbol is read in the same system it is written back in, so a German
 * chart stays German across the transposition.
 *
 * The root and the bass are respelled where moving them by letter would leave
 * a name no chart writes, so raising a flat chart a semitone gives `Bmaj7`
 * rather than `Cbmaj7`. Pass `flats` to write the whole symbol on one side of
 * the staff, root and bass together.
 *
 * @param text The chord symbol text.
 * @param semitones Signed semitone offset to apply to the root and bass.
 * @param opts Options for reading and writing the symbol; see
 *   {@link ChordSymbolOptions}.
 * @returns The transposed chord symbol text.
 * @throws If `text` does not parse as a chord symbol.
 * @example
 * ```ts
 * import { transposeChordSymbol } from '@libraz/libcantus';
 * transposeChordSymbol('C/G', 2); // 'D/A'
 * transposeChordSymbol('H7', 1, { system: 'german' }); // 'C7'
 * ```
 * @category Chords
 */
export function transposeChordSymbol(
  text: string,
  semitones: number,
  opts?: ChordSymbolOptions,
): string {
  assertFiniteSemitones(semitones);
  const chord = parseChordSymbol(text, opts);
  const transposed: Chord = { ...chord, rootPc: pitchClass(chord.rootPc + semitones) };
  if (chord.bassPc !== undefined) {
    transposed.bassPc = pitchClass(chord.bassPc + semitones);
  }
  const spellings = transposeChordSpellings(chord, semitones, opts?.flats);
  if (spellings.rootSpelling !== undefined) {
    transposed.rootSpelling = spellings.rootSpelling;
  }
  if (spellings.bassSpelling !== undefined) {
    transposed.bassSpelling = spellings.bassSpelling;
  }
  if (spellings.toneSpellings !== undefined) {
    transposed.toneSpellings = spellings.toneSpellings;
  }
  return formatChordSymbol(transposed, opts);
}
