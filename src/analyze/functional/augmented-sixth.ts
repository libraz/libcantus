/**
 * Augmented-sixth chords: the Italian, French, and German sixths.
 *
 * All three stand on the lowered submediant (b6) in the bass and carry an
 * augmented sixth above it, and all three are predominants whose two outer
 * voices resolve outward onto the dominant. The family is defined by that bass
 * and that interval rather than by a stack of thirds, so a chord is recognized
 * here from the tones sounding over that bass rather than through the
 * Roman-numeral degree tables.
 *
 * The interval is spelled, so recognition reads letters and not only pitch
 * classes: over an Ab bass the augmented sixth is F# and the minor seventh of
 * the bVI7 it otherwise sounds exactly like is Gb. A caller holding pitch
 * classes alone — an analysis of a MIDI track, which names no accidentals —
 * makes that reading with {@link augmentedSixthFromPitchClasses}, and the chord
 * it hands back carries the spelling that decided it.
 */

import type { Note, SpelledInterval } from '../../core/pitch/index.js';
import { diatonicLetterOf, parseInterval, transposeByInterval } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertOneOf } from '../../core/validation/index.js';
import type { Chord, ChordQuality, PitchSpelling } from '../../theory/chord/index.js';
import { chordPitchClasses, makeChord } from '../../theory/chord/index.js';
import { spelledKeyOf } from '../../theory/scale/index.js';
import { spellChord } from '../../theory/spelling/index.js';
import { mod12 } from './internal.js';

/**
 * The three augmented-sixth chords, under the nationalities convention gives
 * them.
 *
 * Over an Ab bass in C: the Italian sixth is Ab C F#, the French sixth adds the
 * supertonic (Ab C D F#), and the German sixth adds the lowered mediant
 * (Ab C Eb F#).
 *
 * @category Functional Harmony
 */
export type AugmentedSixthKind = 'italian' | 'french' | 'german';

/** Every kind, in the order a sounding chord is matched against them. */
const KINDS: readonly AugmentedSixthKind[] = ['italian', 'french', 'german'];

/** Semitones from the tonic up to the lowered submediant, the family's bass. */
const BASS_ABOVE_TONIC = 8;

/** Semitone offsets above the bass for each kind's tones. */
const TONES_ABOVE_BASS: Record<AugmentedSixthKind, readonly number[]> = {
  italian: [0, 4, 10],
  french: [0, 4, 6, 10],
  german: [0, 4, 7, 10],
};

/**
 * Spelled intervals above the bass for each kind, bass first.
 *
 * The top note is an augmented sixth and never a minor seventh: over an Ab bass
 * it is F#, which resolves outward to G, rather than the Gb a dominant seventh
 * would spell. Naming the intervals rather than the semitones is what keeps
 * that true in every key, at the cost of the double flats a far flat-side key
 * genuinely needs (the German sixth of Db major is Bbb Db Fb G).
 */
const SPELLED_ABOVE_BASS: Record<AugmentedSixthKind, readonly SpelledInterval[]> = {
  italian: ['P1', 'M3', 'A6'].map((name) => parseInterval(name)),
  french: ['P1', 'M3', 'A4', 'A6'].map((name) => parseInterval(name)),
  german: ['P1', 'M3', 'P5', 'A6'].map((name) => parseInterval(name)),
};

/** The minor sixth from the tonic up to the bass every kind stands on. */
const BASS_INTERVAL = parseInterval('m6');

/**
 * How each kind is carried by the pitch-class {@link Chord} type: the root it
 * is measured from, the nearest quality label, and its interval template.
 *
 * None of the three stacks in thirds over its own bass, so the `quality` field
 * can only name the closest tertian sonority: the Italian and German sixths are
 * a dominant seventh without and with its fifth. The French sixth does stack in
 * thirds one rotation away — it is the supertonic seventh with a lowered fifth
 * — so it is rooted there, which is the conventional derivation and the only
 * rooting whose letters a stack of thirds gets right on its own. The other two
 * carry their letters as tone spellings instead.
 *
 * The interval template always names the tones that actually sound, so the
 * pitch classes are exact whatever the quality label says.
 */
const CHORD_SHAPE: Record<
  AugmentedSixthKind,
  { rootAboveBass: number; quality: ChordQuality; intervals: readonly number[] }
> = {
  italian: { rootAboveBass: 0, quality: 'dom7', intervals: [0, 4, 10] },
  french: { rootAboveBass: 6, quality: '7b5', intervals: [0, 4, 6, 10] },
  german: { rootAboveBass: 0, quality: 'dom7', intervals: [0, 4, 7, 10] },
};

/** Roman-numeral symbol accepted for each kind, including the figured variant. */
const KIND_BY_SYMBOL: ReadonlyMap<string, AugmentedSixthKind> = new Map([
  ['It6', 'italian'],
  ['Fr6', 'french'],
  ['Ger6', 'german'],
  // The German sixth's figures over its bass are 6/5; both spellings are in use.
  ['Ger65', 'german'],
]);

/** The symbol emitted for each kind, one per kind so rendering is canonical. */
const SYMBOL_BY_KIND: Record<AugmentedSixthKind, string> = {
  italian: 'It6',
  french: 'Fr6',
  german: 'Ger6',
};

/** The pitch class of the lowered submediant, the bass every kind stands on. */
function bassPcOf(key: KeyScale): number {
  return mod12(key.rootPc + BASS_ABOVE_TONIC);
}

/** Reduce a spelled note to the bare letter/alter a chord records as a hint. */
function bareSpelling(note: Note): PitchSpelling {
  return { letter: note.letter, alter: note.alter };
}

/**
 * The kind's spelled tones in the order its own interval template names them.
 *
 * {@link spellAugmentedSixth} spells upward from the bass, which is the order
 * the chord sounds in but not the order it is measured in. Rotating that
 * spelling onto the tone the template is rooted from puts the letters back in
 * step with the intervals, so both orderings stay derived from one table.
 */
function spelledInChordOrder(kind: AugmentedSixthKind, tonic: Note): Note[] {
  const tones = spellAugmentedSixth(kind, tonic);
  const rootIndex = TONES_ABOVE_BASS[kind].indexOf(CHORD_SHAPE[kind].rootAboveBass);
  return [...tones.slice(rootIndex), ...tones.slice(0, rootIndex)];
}

/**
 * Build an augmented-sixth chord in a key.
 *
 * The chord always carries an explicit `bassPc` on the lowered submediant,
 * which is what makes it an augmented sixth rather than the dominant seventh or
 * the altered supertonic seventh it shares pitch classes with, and an explicit
 * interval template naming exactly the tones that sound.
 *
 * It also carries its spelling: the tones as `toneSpellings`, and the root and
 * bass as the usual hints. Those are what let the ordinary chord speller and
 * the symbol formatter name the chord — `Ab C Eb F#` and `Ab7` for the German
 * sixth of C major — since a stack of thirds over that root would put a Gb
 * where the augmented sixth belongs. The spelling is the one the key is written
 * on, so a flat-side key takes the double flats it genuinely needs.
 *
 * The lowered submediant is taken as eight semitones above the tonic in every
 * mode, since the chord is a chromatic alteration rather than a degree of the
 * prevailing scale.
 *
 * @param kind Which of the three augmented sixths to build.
 * @param key The prevailing key.
 * @returns The chord, with its bass on the lowered submediant.
 * @throws If `kind` is not one of the three, or the key's root is not finite.
 * @see {@link spellAugmentedSixth} to spell the family from a tonic without
 *   building a chord at all.
 * @example
 * ```ts
 * import { augmentedSixthChord, majorKey } from '@libraz/libcantus';
 * augmentedSixthChord('german', majorKey(0));
 * // Ab C Eb F# in C: { rootPc: 8, quality: 'dom7', intervals: [0, 4, 7, 10], bassPc: 8, ... }
 * ```
 * @category Functional Harmony
 */
export function augmentedSixthChord(kind: AugmentedSixthKind, key: KeyScale): Chord {
  const checked = assertOneOf(kind, KINDS, 'augmented sixth kind');
  const shape = CHORD_SHAPE[checked];
  const bassPc = bassPcOf(key);
  const chord = makeChord(mod12(bassPc + shape.rootAboveBass), shape.quality, bassPc);
  chord.intervals = [...shape.intervals];
  const tonic = spelledKeyOf(key).tonic;
  const bass = transposeByInterval(tonic, BASS_INTERVAL);
  const tones = spelledInChordOrder(checked, tonic);
  // The rotation starts on the tone the template is measured from, so the first
  // spelling is the root's own; the three kinds all sound, so it is never empty.
  const [root = bass] = tones;
  chord.rootSpelling = bareSpelling(root);
  chord.bassSpelling = bareSpelling(bass);
  chord.toneSpellings = tones.map(bareSpelling);
  return chord;
}

/** The kind whose tones over `bass` are exactly `pcs`, or null for none. */
function kindOfPitchClasses(pcs: ReadonlySet<number>, bass: number): AugmentedSixthKind | null {
  for (const kind of KINDS) {
    const tones = TONES_ABOVE_BASS[kind];
    if (pcs.size === tones.length && tones.every((tone) => pcs.has(mod12(bass + tone)))) {
      return kind;
    }
  }
  return null;
}

/** A spelled note or hint reduced to the letter/alter pair spellings compare by. */
function spellingId(note: Note | PitchSpelling): string {
  return `${diatonicLetterOf(note.letter)}:${note.alter}`;
}

/**
 * Whether a chord's own letters are the kind's.
 *
 * The chord is spelled the way the rest of the library spells it, which is by
 * its tone spellings when it carries them and by stacking thirds when it does
 * not. That is the whole test: a stack of thirds writes the top tone as a minor
 * seventh above the bass, and only a chord that says otherwise sounds the
 * augmented sixth the family is named for.
 */
function spellsAugmentedSixth(chord: Chord, kind: AugmentedSixthKind, key: KeyScale): boolean {
  const tonic = spelledKeyOf(key).tonic;
  const written = new Set(spellChord(chord, tonic, key).map(spellingId));
  const tones = spellAugmentedSixth(kind, tonic).map(spellingId);
  return written.size === tones.length && tones.every((tone) => written.has(tone));
}

/**
 * Identify a chord as one of the augmented sixths, or null when it is none.
 *
 * A chord qualifies when it sounds the lowered submediant of `key` in the bass,
 * its pitch classes are exactly one of the three sets built over that bass, and
 * its own letters spell the augmented sixth above it. All three are needed: the
 * same pitch classes over the same bass are an ordinary bVI7 when the tone ten
 * semitones above the bass is written as a minor seventh, and the letters are
 * the only place that distinction lives.
 *
 * A chord naming no `bassPc` sounds its root lowest, which is how the two
 * conventions for that field — the sounding bass always, or only a bass that
 * differs from the root — are read alike here.
 *
 * The root the chord is measured from is not consulted, so a chord voiced or
 * rebuilt around any of its own tones still identifies as long as it keeps its
 * spelling.
 *
 * @param chord The chord to test.
 * @param key The prevailing key.
 * @returns The kind of augmented sixth, or null.
 * @see {@link augmentedSixthFromPitchClasses} to make the reading from pitch
 *   classes that carry no spelling at all.
 * @example
 * ```ts
 * import { augmentedSixthKind, majorKey, romanToChord } from '@libraz/libcantus';
 * augmentedSixthKind(romanToChord('Fr6', majorKey(0)), majorKey(0)); // 'french'
 * ```
 * @category Functional Harmony
 */
export function augmentedSixthKind(chord: Chord, key: KeyScale): AugmentedSixthKind | null {
  const bass = bassPcOf(key);
  if (mod12(chord.bassPc ?? chord.rootPc) !== bass) {
    return null;
  }
  const kind = kindOfPitchClasses(new Set(chordPitchClasses(chord)), bass);
  if (kind === null || !spellsAugmentedSixth(chord, kind, key)) {
    return null;
  }
  return kind;
}

/**
 * Read a set of sounding pitch classes over a sounding bass as an augmented
 * sixth, or null when they are none.
 *
 * The reading a caller holding no spelling has to make for itself: pitch
 * classes name no accidentals, so nothing downstream can tell the German sixth
 * from the bVI7 it sounds like once the letters are gone. The chord returned is
 * the one {@link augmentedSixthChord} builds, spelling and all, so it keeps
 * identifying as an augmented sixth everywhere it travels.
 *
 * Not every b6-1-b3-#4 over a b6 bass is an augmented sixth, and this cannot
 * know which one is: it answers what the tones would spell, and the caller
 * decides whether that reading is the one the music supports.
 *
 * @param pcs The sounding pitch classes; duplicates and unreduced values are
 *   fine.
 * @param bassPc The pitch class sounding in the bass.
 * @param key The prevailing key.
 * @returns The augmented-sixth chord, or null.
 */
export function augmentedSixthFromPitchClasses(
  pcs: readonly number[],
  bassPc: number,
  key: KeyScale,
): Chord | null {
  const bass = bassPcOf(key);
  if (mod12(bassPc) !== bass) {
    return null;
  }
  const kind = kindOfPitchClasses(new Set(pcs.map(mod12)), bass);
  return kind === null ? null : augmentedSixthChord(kind, key);
}

/**
 * Spell an augmented-sixth chord from a spelled tonic, lowest note first.
 *
 * This is the spelled counterpart of {@link augmentedSixthChord}, and the table
 * the chord's own spelling is built from: every tone is placed by a named
 * interval above the bass, so the outer interval is an augmented sixth in every
 * key rather than the minor seventh its ten semitones would otherwise imply.
 * Reach for it when a spelled tonic is all there is; spelling the chord itself
 * with {@link spellChord} names the same notes, in the chord's own order.
 *
 * A tonic carrying an octave yields notes carrying octaves, ascending from the
 * bass; an octave-less tonic yields octave-less notes.
 *
 * @param kind Which of the three augmented sixths to spell.
 * @param tonic The spelled tonic of the key.
 * @returns The spelled tones, bass first and ascending.
 * @throws If `kind` is not one of the three, or `tonic` is not a note.
 * @example
 * ```ts
 * import { noteNames, parseNote, spellAugmentedSixth } from '@libraz/libcantus';
 * noteNames(spellAugmentedSixth('german', parseNote('C'))); // ['Ab', 'C', 'Eb', 'F#']
 * noteNames(spellAugmentedSixth('italian', parseNote('E'))); // ['C', 'E', 'A#']
 * ```
 * @category Functional Harmony
 */
export function spellAugmentedSixth(kind: AugmentedSixthKind, tonic: Note): Note[] {
  const checked = assertOneOf(kind, KINDS, 'augmented sixth kind');
  const bass = transposeByInterval(tonic, BASS_INTERVAL);
  return SPELLED_ABOVE_BASS[checked].map((interval) => transposeByInterval(bass, interval));
}

/** The chord an augmented-sixth symbol names in a key, or null for other text. */
export function augmentedSixthFromSymbol(symbol: string, key: KeyScale): Chord | null {
  const kind = KIND_BY_SYMBOL.get(symbol);
  return kind === undefined ? null : augmentedSixthChord(kind, key);
}

/** The symbol a chord renders as when it is an augmented sixth, else null. */
export function augmentedSixthSymbol(chord: Chord, key: KeyScale): string | null {
  const kind = augmentedSixthKind(chord, key);
  return kind === null ? null : SYMBOL_BY_KIND[kind];
}
