/**
 * Reharmonization: chord substitution, modal-interchange palettes, and negative
 * harmony. These transforms take an existing chord (or a key) and propose
 * alternative harmonies that preserve a chosen relationship — a shared function,
 * a common tone, or a reflection across the key axis.
 *
 * Roots are pitch classes (0..11); no spelled key signature is required. Every
 * proposed chord nevertheless carries the spelling hints of the key it was asked
 * for, so a flat-side key names its chromatic chords with flats (the tritone
 * substitute of G7 in C major is Db7, not C#7).
 */

import { detectChordBest } from '../../analyze/detect/index.js';
import {
  type BorrowedSource,
  borrowedSource,
  chordToRoman,
  functionOf,
  type HarmonicFunction,
  isDiatonic,
  parallelKey,
} from '../../analyze/functional/index.js';
import {
  pitchClassOf as mod12,
  type Note,
  noteToPitchClass,
  transposeNote,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import {
  type Chord,
  type ChordQuality,
  chordPitchClasses,
  diatonicTriad,
  makeChord,
  type PitchSpelling,
} from '../../theory/chord/index.js';
import {
  isScaleTone,
  resolveKey,
  type SpelledKeyLike,
  scaleTonesInDegreeOrder,
} from '../../theory/scale/index.js';
import { spellPitchClass } from '../../theory/spelling/index.js';
import { type ChordLike, toChordData } from '../../theory/symbol/index.js';
import { soundsDominantSeventh } from '../../theory/tendency/index.js';

/**
 * The kind of substitution relationship a candidate realizes.
 *
 * An applied dominant is not among them: which dominant applies is decided by
 * the harmony that follows, and {@link substituteChord} is given one chord and a
 * key. Build one with `secondaryDominantOf` where the target is known, or let
 * `harmonizeMelody` open its vocabulary with `reharmonize: 'secondaryDominant'`
 * where the progression is being chosen as a whole.
 *
 * @category Reharmonization
 */
export type SubstitutionType = 'tritone' | 'relative' | 'borrowed' | 'chromaticMediant';

/**
 * A proposed chord substitution with its relationship, numeral, and function.
 *
 * @category Reharmonization
 */
export type Substitution = {
  chord: Chord;
  type: SubstitutionType;
  roman: string;
  function: HarmonicFunction;
};

/**
 * Options controlling which substitutions {@link substituteChord} returns.
 *
 * @category Reharmonization
 */
export type SubstituteOptions = {
  /**
   * Melody pitch classes that must remain chord tones. When given, only
   * substitutions whose pitch classes contain every listed pitch class are
   * kept, so the melody stays consonant against the new harmony.
   */
  melodyPcs?: number[];
};

/** Count the pitch classes shared between two pitch-class sets. */
function commonToneCount(a: number[], b: number[]): number {
  const set = new Set(b);
  return a.filter((pc) => set.has(pc)).length;
}

/** The plain triad quality underlying a chord's own quality. */
function triadQualityOf(chord: Chord): ChordQuality {
  const semis = new Set(chord.intervals.map((interval) => mod12(interval)));
  const hasThird = semis.has(4) ? 'maj' : semis.has(3) ? 'min' : undefined;
  if (hasThird === undefined) {
    return chord.quality; // sus, power, and other non-tertian chords stand alone
  }
  if (semis.has(6) && !semis.has(7)) {
    return hasThird === 'min' ? 'dim' : 'majb5';
  }
  if (semis.has(8) && !semis.has(7)) {
    return 'aug';
  }
  return hasThird;
}

/** The diatonic triads of a key, one per scale degree. */
function diatonicTriadsOf(key: KeyScale): Chord[] {
  const degrees = scaleTonesInDegreeOrder(key).length;
  const triads: Chord[] = [];
  for (let degree = 1; degree <= degrees; degree += 1) {
    triads.push(diatonicTriad(degree, key));
  }
  return triads;
}

/** Whether two chords share the same root pitch class and quality. */
function sameChord(a: Chord, b: Chord): boolean {
  return mod12(a.rootPc) === mod12(b.rootPc) && a.quality === b.quality;
}

/** Root offsets (semitones) that form a third above or below a root. */
const THIRD_OFFSETS = [3, 4, 8, 9] as const;

/** Widest alteration a {@link PitchSpelling} hint may carry: a double accidental. */
const MAX_HINT_ALTER = 2;

/** Reduce a spelled note to the bare letter/alter a chord records as a hint. */
function bareSpelling(note: Note): PitchSpelling {
  return { letter: note.letter, alter: note.alter };
}

/**
 * Copy a chord with `root` recorded as its root spelling, plus the key's own
 * spelling of the bass when one is set.
 *
 * A hint is only worth carrying while it still names the pitch class it belongs
 * to, so a root spelling that does not — or that would need more than a double
 * accidental — gives way to the key's spelling of that pitch class.
 */
function spelledOnRoot(chord: Chord, root: Note, tonic: Note, key: KeyScale): Chord {
  const usable =
    noteToPitchClass(root) === mod12(chord.rootPc) && Math.abs(root.alter) <= MAX_HINT_ALTER;
  const spelled: Chord = {
    ...chord,
    rootSpelling: bareSpelling(usable ? root : spellPitchClass(chord.rootPc, tonic, key)),
  };
  if (chord.bassPc !== undefined) {
    spelled.bassSpelling = bareSpelling(spellPitchClass(chord.bassPc, tonic, key));
  }
  return spelled;
}

/** Copy a chord with the key's own spelling of its root and bass attached. */
function spelledInKey(chord: Chord, tonic: Note, key: KeyScale): Chord {
  return spelledOnRoot(chord, spellPitchClass(chord.rootPc, tonic, key), tonic, key);
}

/**
 * The root spelling of a tritone substitute: the flattened supertonic of the
 * chord the substituted dominant resolves to, since the substitute is that
 * chord's bII7. G7 resolves to C, so its substitute is written Db7 — never C#7,
 * whichever letter the pitch class alone would suggest.
 *
 * A pitch class the key already spells as a scale degree keeps that letter
 * instead: the same substitution read in B major is the II7 written C#7.
 */
function tritoneSubstituteRoot(dominant: Chord, tonic: Note, key: KeyScale): Note {
  const substituteRootPc = mod12(dominant.rootPc + 6);
  if (isScaleTone(substituteRootPc, key)) {
    return spellPitchClass(substituteRootPc, tonic, key);
  }
  const resolution = spellPitchClass(mod12(dominant.rootPc + 5), tonic, key);
  return transposeNote(resolution, 1);
}

/**
 * Propose substitutions for a chord within a key.
 *
 * Candidates are generated by several relationships and deduplicated against the
 * original chord and each other:
 *
 * - `tritone`: for a dominant-type chord, the dominant seventh a tritone away.
 * - `relative`: a diatonic triad a third away that shares two common tones.
 * - `borrowed`: a triad from the parallel mode with the same harmonic function.
 * - `chromaticMediant`: a major/minor triad a third away sharing one common
 *   tone.
 *
 * These four are the whole vocabulary. An applied dominant is not proposed
 * because the chord it applies to is the one that follows, which a call about a
 * single chord cannot see; `secondaryDominantOf` builds one from a named target.
 *
 * Each result carries its Roman numeral and harmonic function in `key`. When
 * `opts.melodyPcs` is given, only substitutions whose pitch classes contain all
 * of those pitch classes are returned.
 *
 * Every substitution is spelled the way `key` writes it, as `rootSpelling` and
 * `bassSpelling` hints, so a flat-side key keeps flat names: in C major the
 * tritone substitute of G7 formats as `Db7` and its chromatic mediants as `Bb`
 * and `Eb`. Where the substitution's function and the bare pitch class disagree,
 * the function decides — a tritone substitute is a bII7 and so is written on the
 * flattened supertonic of the chord it resolves to, and a borrowed chord takes
 * the spelling of the mode it is borrowed from.
 *
 * @param chord The chord to reharmonize, as a chord symbol or as chord data.
 * @param key The prevailing key, as a key name or as a key/scale.
 * @param opts Optional melody-preservation constraint.
 * @returns The deduplicated substitution candidates.
 * @example
 * ```ts
 * import { substituteChord, makeChord, majorKey, formatChordSymbol } from '@libraz/libcantus';
 * const subs = substituteChord(makeChord(7, 'dom7'), majorKey(0));
 * subs
 *   .filter((sub) => sub.type === 'tritone')
 *   .map((sub) => formatChordSymbol(sub.chord)); // ['Db7'] — the bII7 of C major, not 'C#7'
 * ```
 * @category Reharmonization
 */
export function substituteChord(
  chord: ChordLike,
  key: SpelledKeyLike,
  opts?: SubstituteOptions,
): Substitution[] {
  // Chord and key are read once, here at the boundary. The key keeps the tonic
  // it was named with: everything below spells from that tonic, so the letters
  // are the caller's key's rather than the ones its pitch classes read best as.
  const source = toChordData(chord);
  const { scale, tonic } = resolveKey(key);
  // The relative test counts common tones against the chord's triad, not its
  // full pitch-class set: an exact count of two would otherwise be decided by
  // how many tensions the input carries, so C proposes both Em and Am while
  // Cmaj7 proposes only Am — penalising the candidate that overlaps *more*.
  const originalTriad = chordPitchClasses(makeChord(source.rootPc, triadQualityOf(source)));
  const candidates: { chord: Chord; type: SubstitutionType }[] = [];

  // Tritone substitution: only for dominant-type chords.
  if (soundsDominantSeventh(source)) {
    const substitute = makeChord(mod12(source.rootPc + 6), 'dom7');
    candidates.push({
      chord: spelledOnRoot(substitute, tritoneSubstituteRoot(source, tonic, scale), tonic, scale),
      type: 'tritone',
    });
  }

  // Relative: a diatonic triad a third away sharing two common tones.
  for (const triad of diatonicTriadsOf(scale)) {
    const offset = mod12(triad.rootPc - source.rootPc);
    if (
      (THIRD_OFFSETS as readonly number[]).includes(offset) &&
      commonToneCount(originalTriad, chordPitchClasses(triad)) === 2
    ) {
      candidates.push({ chord: spelledInKey(triad, tonic, scale), type: 'relative' });
    }
  }

  // Borrowed: a parallel-mode triad sharing the original's harmonic function.
  // It is written the way the mode it comes from writes it, which is also how
  // the key names the borrowing: C major borrows Eb and Ab from C minor.
  const targetFunction = functionOf(source, scale);
  const parallel = parallelKey(scale);
  for (const triad of diatonicTriadsOf(parallel)) {
    if (functionOf(triad, scale) === targetFunction && !isDiatonic(triad, scale)) {
      candidates.push({ chord: spelledInKey(triad, tonic, parallel), type: 'borrowed' });
    }
  }

  // Chromatic mediants: major/minor triads a third away sharing one common tone.
  for (const offset of THIRD_OFFSETS) {
    for (const quality of ['maj', 'min'] as const) {
      const mediant = makeChord(mod12(source.rootPc + offset), quality);
      if (
        commonToneCount(originalTriad, chordPitchClasses(mediant)) === 1 &&
        !isDiatonic(mediant, scale)
      ) {
        candidates.push({ chord: spelledInKey(mediant, tonic, scale), type: 'chromaticMediant' });
      }
    }
  }

  const melodyPcs = opts?.melodyPcs?.map(mod12);
  const seen = new Set<string>();
  const results: Substitution[] = [];
  for (const candidate of candidates) {
    if (sameChord(candidate.chord, source)) {
      continue;
    }
    const dedupeKey = `${mod12(candidate.chord.rootPc)}:${candidate.chord.quality}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    if (melodyPcs !== undefined) {
      const pcs = new Set(chordPitchClasses(candidate.chord));
      if (!melodyPcs.every((pc) => pcs.has(pc))) {
        continue;
      }
    }
    results.push({
      chord: candidate.chord,
      type: candidate.type,
      roman: chordToRoman(candidate.chord, scale),
      function: functionOf(candidate.chord, scale),
    });
  }
  return results;
}

/**
 * A borrowed chord in the modal-interchange palette of a key.
 *
 * @category Reharmonization
 */
export type BorrowedChord = {
  chord: Chord;
  roman: string;
  source: BorrowedSource;
};

/**
 * The modal-interchange palette of a key.
 *
 * Lists the diatonic triads of the parallel key that are not diatonic to
 * `key` (the classic borrowed chords such as `iv`, `bVI`, and `bVII` in a major
 * key), plus the Neapolitan (a major triad on the flat second degree). Each
 * carries its Roman numeral and {@link borrowedSource} relative to `key`.
 *
 * Every chord is spelled as the mode it is borrowed from writes it, recorded as
 * a `rootSpelling` hint: C major borrows `Fm`, `Ab` and `Bb` from C minor and
 * takes `Db` as its Neapolitan, while a minor key borrows in the other direction
 * (A minor borrows `A`, `D` and `F#m` from A major, with `Bb` as its
 * Neapolitan). The major dominant of a minor key — `E` in A minor — is not among
 * them: raising the seventh degree is an alteration inside the key rather than a
 * chord taken from the parallel mode.
 *
 * @param key The prevailing key, as a key name or as a key/scale.
 * @returns The borrowed-chord palette.
 * @example
 * ```ts
 * import { modalInterchangePalette, majorKey, formatChordSymbol } from '@libraz/libcantus';
 * const palette = modalInterchangePalette(majorKey(0));
 * palette.map((borrowed) => formatChordSymbol(borrowed.chord));
 * // ['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Db'] — flat-side, not 'D#'/'G#'/'A#'
 * ```
 * @category Reharmonization
 */
export function modalInterchangePalette(key: SpelledKeyLike): BorrowedChord[] {
  // The key is read once, here at the boundary, and keeps the tonic it was
  // named with: every chord below is spelled from that tonic.
  const { scale, tonic } = resolveKey(key);
  const palette: BorrowedChord[] = [];
  const seen = new Set<string>();
  const add = (chord: Chord) => {
    const dedupeKey = `${mod12(chord.rootPc)}:${chord.quality}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    palette.push({
      chord,
      roman: chordToRoman(chord, scale),
      source: borrowedSource(chord, scale),
    });
  };

  const parallel = parallelKey(scale);
  for (const triad of diatonicTriadsOf(parallel)) {
    if (!isDiatonic(triad, scale) && borrowedSource(triad, scale) !== null) {
      add(spelledInKey(triad, tonic, parallel));
    }
  }
  // The Neapolitan (major triad on b2) sits outside both parallel modes, so it
  // is added explicitly — unless b2 is already diatonic (e.g. in a Phrygian key,
  // where it is a native chord rather than a borrowing). Being a bII, it is
  // written a minor second above the tonic: Db in C major, C in B major.
  const neapolitan = makeChord(mod12(scale.rootPc + 1), 'maj');
  if (!isDiatonic(neapolitan, scale)) {
    add(spelledOnRoot(neapolitan, transposeNote(tonic, 1), tonic, scale));
  }
  return palette;
}

/**
 * Reflect a chord across the tonic–dominant axis of a key (negative harmony).
 *
 * Every pitch class `p` maps to `(2*T + 7 - p) mod 12`, where `T` is the key
 * tonic — the reflection that swaps the tonic with the dominant. The mirrored
 * pitch classes (including the bass, if set) are reassembled into a chord by
 * {@link detectChordBest}; when no chord is recognized, the mirrored root and
 * the original quality are used as a fallback.
 *
 * The result is spelled the way `key` writes it, as `rootSpelling` and
 * `bassSpelling` hints, so the reflection of a chord in a flat-side key keeps
 * flat names: in Eb major the mirror of Bb formats as `Abm`, not `G#m`.
 *
 * @param chord The chord to reflect, as a chord symbol or as chord data.
 * @param key The prevailing key, as a key name or as a key/scale.
 * @returns The negative-harmony counterpart of the chord.
 * @example
 * ```ts
 * import { negativeHarmonyMirror, makeChord, majorKey } from '@libraz/libcantus';
 * negativeHarmonyMirror(makeChord(7, 'maj'), majorKey(0));
 * // G major reflected across C's axis => F minor (rootPc 5, quality 'min')
 * ```
 * @category Reharmonization
 */
export function negativeHarmonyMirror(chord: ChordLike, key: SpelledKeyLike): Chord {
  // Chord and key are read once, here at the boundary. The key keeps the tonic
  // it was named with, which is what the mirrored chord is spelled from.
  const source = toChordData(chord);
  const { scale, tonic } = resolveKey(key);
  const tonicPc = mod12(scale.rootPc);
  const mirror = (p: number) => mod12(2 * tonicPc + 7 - p);
  const pcs = chordPitchClasses(source).map(mirror);
  const bassPc = source.bassPc !== undefined ? mirror(source.bassPc) : undefined;
  // Place the mirrored bass below the rest so it is recognized as the lowest
  // note and preserved through detection. The others move up rather than the
  // bass moving down: a pitch class is already at the bottom of the MIDI range,
  // so dropping one an octave leaves it, and every chord carrying a bass was
  // refused by the pitch check rather than mirrored.
  const pitches = bassPc !== undefined ? [bassPc, ...pcs.map((pc) => pc + 12)] : pcs;
  const detected = detectChordBest(pitches);
  if (detected) {
    // Without an input bass the mirrored tones are octave-less, so detection may
    // read the lowest pitch class as a slash bass and report a spurious
    // inversion. Restore the recognized chord to root position in that case.
    if (bassPc === undefined && detected.bassPc !== undefined) {
      return spelledInKey(makeChord(detected.rootPc, detected.quality), tonic, scale);
    }
    return spelledInKey(detected, tonic, scale);
  }
  const quality: ChordQuality = source.quality;
  return spelledInKey(makeChord(mirror(source.rootPc), quality, bassPc), tonic, scale);
}
