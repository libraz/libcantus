import { InvalidInputError } from '../../core/errors/index.js';
import {
  diatonicLetterOf,
  noteToPitchClass,
  pitchClassOf as pitchClass,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertDegree, assertFiniteNumber, assertInteger } from '../../core/validation/index.js';
import { type KeyLike, scaleTonesInDegreeOrder, toKeyScale } from '../scale/index.js';
import type { ChordQuality, ChordSpec } from './spec.js';
import {
  assertChordSpec,
  chordSpecForQuality,
  chordSpecFromIntervals,
  chordSpecIntervals,
  chordSpecQuality,
  QUALITY_INTERVALS,
  QUALITY_ORDER,
} from './spec.js';

export type {
  Alteration,
  AlteredDegree,
  ChordBase,
  ChordQuality,
  ChordSeventh,
  ChordSpec,
} from './spec.js';
export { chordSpecIntervals, chordSpecQuality } from './spec.js';

/**
 * The basic role a chord tone plays: the degrees a chord's own template names.
 *
 * The shared vocabulary behind {@link chordToneRole}, the harmony layer's
 * `HarmonyRole`, and the voice analyser's labels, so the three cannot drift.
 *
 * @category Chords
 */
export type ChordToneRole = 'root' | 'third' | 'fifth' | 'sixth' | 'seventh';

/**
 * A bare spelled pitch used as an enharmonic hint: a diatonic letter
 * (0..6 = C..B) plus a chromatic alteration (-2 double-flat .. +2 double-sharp).
 * Mirrors the letter/alter half of the pitch module's `Note` without an octave.
 *
 * @category Chords
 */
export type PitchSpelling = {
  letter: number;
  alter: number;
};

/**
 * A chord expressed as a root pitch class plus semitone offsets.
 *
 * `intervals` is what the chord sounds and `quality` is what it is called. The
 * two are not equally expressive: a chart writes any set of alterations over a
 * base, while {@link ChordQuality} is a closed list of names, so `quality` is a
 * *derived* label — the name that fits the chord exactly, or else the nearest
 * name inside it (see {@link chordSpecQuality}). Read the structure with
 * {@link chordSpecOf} rather than the name when the alterations matter; that is
 * also what {@link formatChordSymbol} does, so a chord no name covers still
 * writes itself out in full.
 *
 * `rootSpelling`/`bassSpelling` are optional enharmonic hints recorded by
 * parsers (e.g. `parseChordSymbol('Bb7')`) so formatters can reproduce the
 * original spelling instead of defaulting to sharps. Consumers may ignore
 * them; a hint is only trusted when its pitch class still matches the
 * corresponding `rootPc`/`bassPc`.
 *
 * `toneSpellings` is the same kind of hint for the tones themselves, one
 * spelling per entry in `intervals`. It exists for the chords whose letters do
 * not follow from stacking thirds: an augmented sixth is ten semitones like a
 * minor seventh but is five letters above its root rather than six, and no
 * {@link ChordQuality} can say so. Builders that know better attach it, and
 * {@link spellChordFromRoot} reads the letter distances back out of it; a hint
 * is trusted as a whole or not at all, and only while every spelling still
 * names the pitch class its interval names.
 *
 * @category Chords
 */
export type Chord = {
  rootPc: number;
  quality: ChordQuality;
  intervals: number[];
  bassPc?: number;
  rootSpelling?: PitchSpelling;
  bassSpelling?: PitchSpelling;
  toneSpellings?: PitchSpelling[];
};

/**
 * A chord positioned in time: a root pitch class and quality placed at a beat,
 * with optional harmonic-analysis hints. Serves as the neutral exchange record
 * between progression generators and timeline analysers.
 *
 * @category Composition
 */
export type ChordSpan = {
  rootPc: number;
  quality: ChordQuality;
  startBeat: number;
  bassPc?: number;
  /**
   * Semitone offsets from the root, for a chord the {@link ChordQuality} union
   * cannot name exactly. Omitted for a standard chord: the template is then
   * derived from `quality`, which is what every producer and consumer did
   * before the field existed. Read a span with {@link chordFromSpan} so either
   * case yields the same chord.
   */
  intervals?: number[];
  /** 1-based scale degree of the chord root, when known. */
  degree?: number;
  /** True when the chord is a secondary dominant tonicizing another degree. */
  secondaryDominant?: boolean;
};

/**
 * A chord occupying a half-open beat span `[startBeat, endBeat)`.
 *
 * The exchange record between anything that lays chords out in time — a
 * timeline analysis, a bass-line plan, an accompaniment generator — so those
 * surfaces share one definition instead of agreeing by coincidence.
 *
 * @category Composition
 */
export type ChordSegment = {
  startBeat: number;
  endBeat: number;
  chord: Chord;
};

/** Widest semitone offset a custom interval template may name: one MIDI range. */
const MAX_CHORD_INTERVAL = 127;

/**
 * All chord qualities the builder understands, in declaration order.
 *
 * The order is stable but carries no meaning: it is neither alphabetical nor
 * sorted by template size. {@link detectChord} uses it as its final tie-break,
 * so it is part of the observable behaviour and does not get reshuffled
 * casually — but do not read it as a ranking.
 *
 * @category Chords
 */
export function chordQualities(): ChordQuality[] {
  return [...QUALITY_ORDER];
}

/**
 * Reject a quality the chord tables do not name.
 *
 * The single check every way of building a chord runs, so a quality that no
 * table has a row for is refused where the chord is made rather than surfacing
 * as an undefined lookup somewhere downstream.
 *
 * Not part of the package's public surface.
 *
 * @param quality The quality name to check.
 * @returns The quality, unchanged.
 * @throws If the quality is not a known name ({@link InvalidInputError}).
 */
export function assertChordQuality(quality: ChordQuality): ChordQuality {
  if (!Object.hasOwn(QUALITY_INTERVALS, quality)) {
    throw new InvalidInputError(`Unknown chord quality: ${String(quality)}`);
  }
  return quality;
}

/**
 * Build a chord rooted on a diatonic scale degree.
 *
 * The root pitch class is the degree's diatonic pitch class in `key`; the
 * quality's interval template is attached unchanged. Degrees beyond the scale
 * length wrap around, so degree 8 of a heptatonic scale is its degree 1.
 *
 * @param degree 1-based scale degree of the chord root: 1 is the tonic.
 * @param ext Chord quality to apply.
 * @param key Key context supplying the diatonic root, as a key name, a
 *   key/scale, or a `Key`.
 * @returns The constructed chord.
 * @throws If `degree` is not a positive integer, or `ext` is not a known
 *   quality.
 *
 * @category Chords
 */
export function chordFromDegree(degree: number, ext: ChordQuality, key: KeyLike): Chord {
  // Degree 0 is rejected rather than wrapped onto the last degree: a caller
  // still counting from zero gets an error instead of a plausible chord.
  assertDegree(degree, 'chord degree');
  assertChordQuality(ext);
  const scale = toKeyScale(key);
  const tones = scaleTonesInDegreeOrder(scale);
  const length = tones.length;
  const index = length > 0 ? (degree - 1) % length : 0;
  const rootPc = tones[index] ?? pitchClass(scale.rootPc);
  return { rootPc, quality: ext, intervals: [...QUALITY_INTERVALS[ext]] };
}

/**
 * Build a chord from an explicit root pitch class and quality.
 *
 * @param rootPc Root pitch class (0..11).
 * @param quality Chord quality supplying the interval template.
 * @param bassPc Optional slash-chord bass pitch class.
 * @returns The constructed chord.
 *
 * @example
 * ```ts
 * import { makeChord } from '@libraz/libcantus';
 * const cmaj7 = makeChord(0, 'maj7');
 * // { rootPc: 0, quality: 'maj7', intervals: [0, 4, 7, 11] }
 * ```
 *
 * @category Chords
 */
export function makeChord(rootPc: number, quality: ChordQuality, bassPc?: number): Chord {
  // A NaN root formats as 'C' and an unknown quality as 'Cundefined', so both
  // travel on into voicing, detection, and serialization as a chord that looks
  // real. They are rejected where the chord is built instead.
  assertFiniteNumber(rootPc, 'chord rootPc');
  if (bassPc !== undefined) {
    assertFiniteNumber(bassPc, 'chord bassPc');
  }
  assertChordQuality(quality);
  const chord: Chord = {
    rootPc: pitchClass(rootPc),
    quality,
    intervals: [...(QUALITY_INTERVALS[quality] ?? [])],
  };
  if (bassPc !== undefined) {
    chord.bassPc = pitchClass(bassPc);
  }
  return chord;
}

/**
 * Build a chord from a {@link ChordSpec}.
 *
 * The structural way in, for the chords a quality name cannot reach: the tones
 * come from the spec, and `quality` is the name that fits it, or the nearest
 * name when none does. A chord built this way is an ordinary {@link Chord} —
 * every consumer reads its `intervals` as before, and
 * {@link formatChordSymbol} writes the alterations back out.
 *
 * @param spec The chord spec; its `rootPc`/`bassPc` become the chord's.
 * @returns The constructed chord.
 * @throws If any part of the spec is not one the model defines.
 *
 * @example
 * ```ts
 * import { chordFromSpec } from '@libraz/libcantus';
 * chordFromSpec({
 *   rootPc: 0,
 *   base: 'maj',
 *   seventh: 'maj7',
 *   alterations: [{ degree: 11, alter: 1 }],
 *   additions: [],
 *   omissions: [],
 * });
 * // { rootPc: 0, quality: 'maj7#11', intervals: [0, 4, 7, 11, 18] }
 * ```
 *
 * @category Chords
 */
export function chordFromSpec(spec: ChordSpec): Chord {
  const checked = assertChordSpec(spec);
  const chord: Chord = {
    rootPc: pitchClass(checked.rootPc),
    quality: chordSpecQuality(checked),
    intervals: chordSpecIntervals(checked),
  };
  if (checked.bassPc !== undefined) {
    chord.bassPc = pitchClass(checked.bassPc);
  }
  return chord;
}

/**
 * Read a chord structurally: which base, seventh, alterations and omissions it
 * is made of.
 *
 * The reading comes from the tones themselves, so it describes a chord whatever
 * built it — a parsed symbol, a detected pitch set, a span carrying a template
 * no name covers. Only a template with no structural reading at all falls back
 * to the one its `quality` names.
 *
 * @param chord The chord to read.
 * @returns The spec, carrying the chord's own root and slash bass.
 * @throws If the chord's template has no reading and its quality is unknown.
 *
 * @example
 * ```ts
 * import { chordSpecOf, parseChordSymbol } from '@libraz/libcantus';
 * chordSpecOf(parseChordSymbol('C7(b9,#11)')).alterations;
 * // [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }]
 * ```
 *
 * @category Chords
 */
export function chordSpecOf(chord: Chord): ChordSpec {
  assertFiniteNumber(chord.rootPc, 'chord rootPc');
  const rootPc = pitchClass(chord.rootPc);
  const bassPc = chord.bassPc === undefined ? undefined : pitchClass(chord.bassPc);
  // A chord with no tones at all says nothing about its own structure, so the
  // name it carries is the only thing left to read it by.
  const intervals = chord.intervals ?? [];
  const read = intervals.length === 0 ? undefined : chordSpecFromIntervals(intervals);
  if (read === undefined) {
    return chordSpecForQuality(chord.quality, rootPc, bassPc);
  }
  read.rootPc = rootPc;
  if (bassPc !== undefined) {
    read.bassPc = bassPc;
  }
  return read;
}

/**
 * Validate a span's custom interval template and return a defensive copy.
 *
 * Such a template reaches the library without passing any builder, so it is
 * checked here: a fractional offset would place a chord tone between pitch
 * classes, and a hole in the array would read as an undefined chord tone in
 * every consumer downstream.
 */
function copySpanIntervals(intervals: readonly number[]): number[] {
  const name = 'chord span intervals';
  if (!Array.isArray(intervals)) {
    throw new InvalidInputError(`${name} must be an array; received ${typeof intervals}`);
  }
  if (intervals.length === 0) {
    throw new InvalidInputError(`${name} must name at least one interval`);
  }
  const copy: number[] = [];
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    if (interval === undefined) {
      throw new InvalidInputError(
        `${name}[${index}] must be a semitone offset; received undefined`,
      );
    }
    copy.push(
      assertInteger(interval, `${name}[${index}]`, -MAX_CHORD_INTERVAL, MAX_CHORD_INTERVAL),
    );
  }
  return copy;
}

/** Whether a chord's template departs from the one its quality names. */
function hasCustomIntervals(chord: Chord): boolean {
  return !matchesQualityIntervals(chord.quality, chord.intervals);
}

/**
 * Read a {@link ChordSpan} as a chord.
 *
 * The canonical way to cross from a span to a chord. A span carrying no
 * `intervals` yields exactly the chord {@link makeChord} builds from its root,
 * quality and bass; a span carrying an explicit template keeps it, so a color
 * tone the {@link ChordQuality} union cannot name survives the trip through a
 * progression, a timeline, or a generator. The template is copied, so the
 * chord and the span never share an array.
 *
 * @param span The span to read.
 * @returns The chord the span describes.
 * @throws If the span's root, bass or quality is invalid, or its `intervals`
 *   are not a non-empty array of integer semitone offsets.
 *
 * @example
 * ```ts
 * import { chordFromSpan } from '@libraz/libcantus';
 * chordFromSpan({ rootPc: 0, quality: 'maj7', startBeat: 0 });
 * // { rootPc: 0, quality: 'maj7', intervals: [0, 4, 7, 11] }
 * chordFromSpan({ rootPc: 0, quality: 'maj7', startBeat: 0, intervals: [0, 4, 11, 18] });
 * // the same span with a fifth-less, #11 voicing the quality cannot name
 * ```
 *
 * @category Composition
 */
export function chordFromSpan(span: ChordSpan): Chord {
  const chord = makeChord(span.rootPc, span.quality, span.bassPc);
  if (span.intervals !== undefined) {
    chord.intervals = copySpanIntervals(span.intervals);
  }
  return chord;
}

/**
 * Place a chord at a beat as a {@link ChordSpan}.
 *
 * The interval template is recorded only when it departs from the one the
 * chord's quality names, so a span built from a standard chord carries the
 * same fields it always did while a custom template is not lost.
 *
 * @param chord The chord to place.
 * @param startBeat Beat the chord starts on.
 * @returns The span describing that chord at that beat.
 * @throws If `startBeat` is not finite, or the chord's quality is unknown.
 *
 * @example
 * ```ts
 * import { makeChord, spanFromChord } from '@libraz/libcantus';
 * spanFromChord(makeChord(0, 'maj7'), 4);
 * // { rootPc: 0, quality: 'maj7', startBeat: 4 } — no intervals for a standard chord
 * ```
 *
 * @category Composition
 */
export function spanFromChord(chord: Chord, startBeat: number): ChordSpan {
  assertFiniteNumber(startBeat, 'chord span startBeat');
  assertChordQuality(chord.quality);
  const span: ChordSpan = { rootPc: chord.rootPc, quality: chord.quality, startBeat };
  if (chord.bassPc !== undefined) {
    span.bassPc = chord.bassPc;
  }
  if (hasCustomIntervals(chord)) {
    span.intervals = [...chord.intervals];
  }
  return span;
}

/**
 * Transpose a chord by a number of semitones.
 *
 * The interval template is carried over untouched, so a chord whose intervals
 * were customised keeps them, and a slash bass moves with the root. Enharmonic
 * spelling hints are dropped rather than shifted: the letter a transposed root
 * should take depends on the destination key, which a semitone count does not
 * carry. Pass the result through {@link spellChord} to respell it.
 *
 * @param chord The chord to transpose.
 * @param semitones The signed semitone offset.
 * @returns The transposed chord.
 * @throws If `semitones` is not finite.
 *
 * @example
 * ```ts
 * import { formatChordSymbol, parseChordSymbol, transposeChord } from '@libraz/libcantus';
 * formatChordSymbol(transposeChord(parseChordSymbol('C/G'), 2)); // 'D/A'
 * ```
 *
 * @category Chords
 */
export function transposeChord(chord: Chord, semitones: number): Chord {
  assertFiniteNumber(semitones, 'semitones');
  const steps = Math.round(semitones);
  const moved: Chord = {
    rootPc: pitchClass(chord.rootPc + steps),
    quality: chord.quality,
    intervals: [...chord.intervals],
  };
  if (chord.bassPc !== undefined) {
    moved.bassPc = pitchClass(chord.bassPc + steps);
  }
  return moved;
}

/**
 * A chord's per-tone spelling hints, when they still describe its own tones.
 *
 * The hint is trusted as a whole or not at all: it must name one spelling per
 * interval, and each spelling must still sound the pitch class its interval
 * names. A hint that has fallen out of step with the template — one left behind
 * by a transposition that moved the intervals and not the letters — is dropped
 * rather than half-applied, the same discipline a stale `rootSpelling` gets.
 *
 * Not part of the package's public surface: the readers of the hint
 * ({@link spellChordFromRoot} and the class API) share this check so they
 * cannot disagree about which hints are usable.
 */
export function chordToneSpellings(chord: Chord): PitchSpelling[] | undefined {
  const hints = chord.toneSpellings;
  if (hints === undefined || hints.length !== chord.intervals.length) {
    return undefined;
  }
  const usable: PitchSpelling[] = [];
  for (let index = 0; index < hints.length; index += 1) {
    const hint = hints[index];
    const interval = chord.intervals[index];
    if (hint === undefined || interval === undefined) {
      return undefined;
    }
    if (noteToPitchClass(hint) !== pitchClass(chord.rootPc + interval)) {
      return undefined;
    }
    usable.push({ letter: diatonicLetterOf(hint.letter), alter: hint.alter });
  }
  return usable;
}

/**
 * The letter distance above the chord root each of a chord's own tone spellings
 * implies, or undefined when the chord names none this function can trust.
 *
 * This is the one route by which a chord can name a tone a stack of thirds
 * cannot: the augmented sixth over the lowered submediant is ten semitones like
 * a minor seventh, but five letters above its root rather than six, and no
 * {@link ChordQuality} can say so. Distances are read out of the hint rather
 * than its letters, and they are measured from the hint's own root tone, so the
 * tones follow whichever spelling of the root is in force: the German sixth
 * spells Ab C Eb F# from an Ab root and G# B# D# E## from a G# one.
 *
 * Not part of the package's public surface: it is the single owner of "which
 * degree does this chord write this tone as", so the speller, the tone-role
 * reader and the part-writing rules cannot disagree about it.
 */
export function chordToneLetterOffsets(chord: Chord): number[] | undefined {
  const hints = chordToneSpellings(chord);
  const rootHint = hints?.[chord.intervals.findIndex((interval) => pitchClass(interval) === 0)];
  if (hints === undefined || rootHint === undefined) {
    return undefined;
  }
  return hints.map((hint) => diatonicLetterOf(hint.letter - rootHint.letter));
}

/**
 * The role a letter distance above the root names, for the chords that carry
 * their own spelling.
 *
 * Only the distances a basic role is defined for appear: a tone written two
 * letters above the root is its third and one written five its sixth, whatever
 * the semitones would say on their own.
 */
const ROLE_BY_LETTER_OFFSET: Record<number, ChordToneRole> = {
  0: 'root',
  2: 'third',
  4: 'fifth',
  5: 'sixth',
  6: 'seventh',
};

/** The role a chord's own spelling gives a pitch class, when it names one. */
function spelledToneRole(pitch: number, chord: Chord): ChordToneRole | null | undefined {
  const offsets = chordToneLetterOffsets(chord);
  if (offsets === undefined) {
    return undefined;
  }
  const index = chord.intervals.findIndex(
    (interval) => pitchClass(chord.rootPc + interval) === pitchClass(pitch),
  );
  const offset = offsets[index];
  return offset === undefined ? undefined : (ROLE_BY_LETTER_OFFSET[offset] ?? null);
}

/**
 * A chord's pitch classes as a twelve-bit mask, bit `n` for pitch class `n`.
 *
 * The same representation a scale is held in, and for the same reason: asking
 * whether a chord sounds a pitch is one shift and one and, on a number the
 * caller never has to allocate. The analysers ask it per note per beat, so the
 * set and the sorted array the enumeration hands out are built only where a
 * caller actually wants to walk the tones.
 *
 * @param chord The chord to read.
 * @param opts Set `includeBass: false` to omit a slash bass.
 * @returns The mask, in [0, 4095].
 */
export function chordPcMask(chord: Chord, opts: { includeBass?: boolean } = {}): number {
  let mask = 0;
  for (const interval of chord.intervals) {
    mask |= 1 << pitchClass(chord.rootPc + interval);
  }
  if (opts.includeBass !== false && chord.bassPc !== undefined) {
    mask |= 1 << pitchClass(chord.bassPc);
  }
  return mask;
}

/** Whether a twelve-bit pitch-class mask carries a pitch class. */
function hasPitchClass(mask: number, pc: number): boolean {
  return ((mask >> pc) & 1) === 1;
}

/**
 * A chord's intervals as a twelve-bit mask of interval classes above its root.
 *
 * The root's own frame rather than the sounding one: what a chord is made of is
 * a question about its template, so a slash bass is never part of the answer.
 */
function chordIntervalMask(chord: Chord): number {
  let mask = 0;
  for (const interval of chord.intervals) {
    mask |= 1 << (((interval % 12) + 12) % 12);
  }
  return mask;
}

/**
 * Get the sorted, deduplicated pitch classes of a chord.
 *
 * A slash bass is one of them: `F/G` sounds a G, the voicers put it in the
 * bass, and a set that omitted it would not re-detect as the chord it came
 * from. Pass `includeBass: false` to enumerate the interval template alone.
 *
 * @param chord The chord to enumerate.
 * @param opts Set `includeBass: false` to omit a slash bass.
 * @returns The chord's pitch classes, sorted ascending in [0, 11].
 *
 * @example
 * ```ts
 * import { makeChord, chordPitchClasses } from '@libraz/libcantus';
 * chordPitchClasses(makeChord(0, 'maj7')); // [0, 4, 7, 11]
 * chordPitchClasses(makeChord(5, 'maj', 7)); // [0, 5, 7, 9] — F/G, G included
 * ```
 *
 * @category Chords
 */
export function chordPitchClasses(chord: Chord, opts: { includeBass?: boolean } = {}): number[] {
  const mask = chordPcMask(chord, opts);
  const pcs: number[] = [];
  for (let pc = 0; pc < 12; pc += 1) {
    if (hasPitchClass(mask, pc)) {
      pcs.push(pc);
    }
  }
  return pcs;
}

/**
 * A pitch's interval class above the chord root, in [0, 11].
 *
 * The shared reading of "where does this pitch sit in the chord", used by the
 * safety evaluator and the voice analyser alike so they cannot disagree.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param chord The chord providing the root reference.
 * @returns The interval class above the root.
 * @category Chords
 */
export function intervalAboveRoot(pitch: number, chord: Chord): number {
  return (((pitchClass(pitch) - pitchClass(chord.rootPc)) % 12) + 12) % 12;
}

/**
 * Whether a pitch is one of a chord's tones, ignoring octave.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param chord The chord, or null for no sounding harmony.
 * @returns True when the pitch class belongs to the chord.
 * @category Chords
 */
export function isChordMember(pitch: number, chord: Chord | null): boolean {
  return chord === null ? false : hasPitchClass(chordPcMask(chord), pitchClass(pitch));
}

/**
 * Determine a pitch's harmonic role within a chord.
 *
 * A chord carrying its own tone spellings is read by them, since the degree it
 * writes a tone as is the degree that tone plays: the ten semitones above the
 * root of a German sixth are written five letters up, so they are its sixth and
 * not a seventh owing a step downward. Everywhere else the role is derived from
 * the pitch's interval above the chord root, reduced modulo 12. A major sixth
 * (9) reads as a `sixth` for sixth chords but as a `seventh` for a
 * diminished-seventh chord; ninths and other tensions have no basic role and
 * return null.
 *
 * @param pitch MIDI pitch or bare pitch class.
 * @param chord The chord providing the root reference.
 * @returns The chord-tone role, or null if the pitch has no basic role.
 *
 * @category Chords
 */
export function chordToneRole(pitch: number, chord: Chord): ChordToneRole | null {
  const spelled = spelledToneRole(pitch, chord);
  if (spelled !== undefined) {
    return spelled;
  }
  const interval = (pitchClass(pitch) - pitchClass(chord.rootPc) + 12) % 12;
  const tones = chordIntervalMask(chord);
  const sounds = (ic: number): boolean => hasPitchClass(tones, ic);
  if (interval === 0) {
    // A chord that leaves its root out does not sound one, so the pitch has no
    // role in it: every other branch below asks the same of its own degree.
    return sounds(0) ? 'root' : null;
  }
  if (interval === 3 || interval === 4) {
    return sounds(interval) && (interval !== 3 || !sounds(4)) ? 'third' : null;
  }
  if (interval === 7) {
    return sounds(7) ? 'fifth' : null;
  }
  if (interval === 6) {
    // A diminished fifth is the chord's fifth only when no perfect fifth is
    // present; alongside a perfect fifth it is a #11 tension, not a fifth.
    return sounds(6) && !sounds(7) ? 'fifth' : null;
  }
  if (interval === 8) {
    // An augmented fifth is the chord's fifth only without a perfect fifth;
    // alongside a perfect fifth it is a b13 tension, not a fifth.
    return sounds(8) && !sounds(7) ? 'fifth' : null;
  }
  if (interval === 9) {
    const hasHigherSeventh = sounds(10) || sounds(11);
    const isDiminishedSeventh = sounds(3) && sounds(6) && !hasHigherSeventh;
    if (sounds(9) && isDiminishedSeventh) {
      return 'seventh';
    }
    if (sounds(9) && !hasHigherSeventh) {
      return 'sixth';
    }
    return null;
  }
  if (interval === 10 || interval === 11) {
    return sounds(interval) ? 'seventh' : null;
  }
  return null;
}

/** The degree a chord tone names, once the chord has said which tone it is. */
const DEGREE_BY_ROLE: Readonly<Record<ChordToneRole, number>> = {
  root: 1,
  third: 3,
  fifth: 5,
  sixth: 6,
  seventh: 7,
};

/**
 * The degree an interval class names when the chord's own template does not
 * claim it, indexed by interval class.
 *
 * A tone the chord does not read as one of its degrees is a tension, and the
 * degree a tension names is the one its letter would be written on: the six and
 * the eight beside a perfect fifth are the sharp eleventh and the flat
 * thirteenth, not a second fifth and a sixth.
 */
const TENSION_DEGREE: readonly number[] = [1, 2, 2, 2, 3, 4, 4, 5, 6, 6, 7, 7];

/**
 * Which chord degree one of a chord's own intervals spells.
 *
 * The chord decides, through the same reading every other layer asks — a flat
 * thirteenth over a chord that already sounds its fifth is a thirteenth, and a
 * flattened fifth over a chord that does not is the fifth. Answering from the
 * interval class alone folded 6, 7 and 8 onto the fifth, so a figure asking a
 * `7(b13)` for its thirteenth matched nothing, fell through to the key, and
 * played a tone the chord had already contradicted.
 */
export function degreeOfInterval(interval: number, chord: Chord): number | undefined {
  const role = chordToneRole(pitchClass(chord.rootPc + interval), chord);
  if (role !== null) {
    return DEGREE_BY_ROLE[role];
  }
  return TENSION_DEGREE[((interval % 12) + 12) % 12];
}

/**
 * What occupies a chord's third slot: the degree that says what the chord is.
 *
 * A discriminated union rather than a nullable interval, because the three
 * cases are not degrees of one thing. A chord states a third, or a suspension
 * stands in its place, or the slot is empty — and a reader that has to handle
 * the suspension differently from the third (the avoid-note rule, the voicing
 * lock) says so in the shape of the answer rather than in a comment beside it.
 */
export type ThirdSlot =
  /** The chord states its own third: 4 for a major, 3 for a minor. */
  | { readonly kind: 'third'; readonly interval: 3 | 4 }
  /** A suspension stands in the third's place: the fourth, or the second. */
  | { readonly kind: 'suspension'; readonly interval: 2 | 5 }
  /** The chord names no third and suspends nothing into its place. */
  | { readonly kind: 'none' };

/**
 * Read what stands in a chord's third slot.
 *
 * One reading for every layer that needs it — the avoid notes a suspension
 * creates, the voicing lock that says a tone identifies the chord, the cadence
 * reader asking whether a chord carries a leading tone. Three of them had their
 * own, and the loosest of the three answered a suspension by whichever of the
 * fourth and the second happened to sound, which is not a question folded pitch
 * classes can answer: an eleventh chord's tensions fold onto 2 and 5 alike. So
 * the spelling decides — the suspension a `sus4` or a `sus2` names is its
 * fourth or its second, and an eleventh chord's is the eleventh its omitted
 * third gave way to.
 *
 * At most one interval class is ever reported, so a consumer reading the answer
 * as "this is the tone that identifies the chord" gets one tone rather than two.
 *
 * @param chord The chord to read.
 * @returns What occupies the slot.
 */
export function thirdSlotOf(chord: Chord): ThirdSlot {
  const tones = chordIntervalMask(chord);
  if (hasPitchClass(tones, 4)) {
    return { kind: 'third', interval: 4 };
  }
  if (hasPitchClass(tones, 3)) {
    return { kind: 'third', interval: 3 };
  }
  const spec = chordSpecOf(chord);
  if (spec.base === 'sus2') {
    return hasPitchClass(tones, 2) ? { kind: 'suspension', interval: 2 } : { kind: 'none' };
  }
  // An eleventh chord states its suspension by omitting the third rather than
  // by naming one, so it is read the same way a `sus4` is.
  if (spec.base === 'sus4' || spec.omissions.includes(3)) {
    return hasPitchClass(tones, 5) ? { kind: 'suspension', interval: 5 } : { kind: 'none' };
  }
  return { kind: 'none' };
}

/**
 * The thirds a suspension is standing in for, as pitch classes.
 *
 * Sounding either of them against the chord resolves the suspension and the
 * chord stops being the chord that was written: over a `Csus2` an E makes a
 * `Cadd9`. Both are named because the suspension does not say which third it
 * displaced — that is what suspending is — so both are what it must not meet.
 *
 * @param chord The chord to read.
 * @returns The two thirds, or an empty array when the chord states its own.
 */
export function displacedThirds(chord: Chord): number[] {
  return thirdSlotOf(chord).kind === 'suspension'
    ? [pitchClass(chord.rootPc + 3), pitchClass(chord.rootPc + 4)]
    : [];
}

/** Classify a stacked-thirds triad into a chord quality from its interval set. */
function classifyTriad(thirdIc: number, fifthIc: number): ChordQuality {
  if (thirdIc === 4 && fifthIc === 8) {
    return 'aug';
  }
  if (thirdIc === 4 && fifthIc === 6) {
    return 'majb5';
  }
  if (thirdIc === 3 && fifthIc === 6) {
    return 'dim';
  }
  if (thirdIc === 3) {
    return 'min';
  }
  return 'maj';
}

/** Classify a stacked-thirds seventh chord into a chord quality. */
function classifySeventh(thirdIc: number, fifthIc: number, seventhIc: number): ChordQuality {
  if (thirdIc === 3 && fifthIc === 6 && seventhIc === 9) {
    return 'dim7';
  }
  if (thirdIc === 3 && fifthIc === 6 && seventhIc === 10) {
    return 'm7b5';
  }
  if (thirdIc === 3 && seventhIc === 11) {
    return 'minMaj7';
  }
  if (thirdIc === 3) {
    return 'min7';
  }
  if (fifthIc === 8 && seventhIc === 10) {
    return 'aug7';
  }
  if (fifthIc === 8 && seventhIc === 11) {
    return 'augMaj7';
  }
  if (fifthIc === 6 && seventhIc === 10) {
    return '7b5';
  }
  if (seventhIc === 11) {
    return 'maj7';
  }
  return 'dom7';
}

/** Whether a classified quality describes precisely the stacked pitch classes. */
function matchesQualityIntervals(quality: ChordQuality, intervals: readonly number[]): boolean {
  const template = QUALITY_INTERVALS[quality];
  return (
    template.length === intervals.length &&
    template.every((interval, index) => interval === intervals[index])
  );
}

/**
 * Stack scale thirds from a 1-based scale degree into a chord of `size` notes.
 * Degrees beyond the scale length wrap around.
 */
function stackThirds(degree: number, key: KeyScale, size: 3 | 4): Chord {
  // Degree 0 is rejected rather than wrapped onto the last degree: a caller
  // still counting from zero gets an error instead of a plausible chord.
  assertDegree(degree, 'chord degree');
  const tones = scaleTonesInDegreeOrder(key);
  const length = tones.length;
  if (length !== 7) {
    throw new InvalidInputError(
      `diatonic chord stacking requires a heptatonic scale (received ${length} tones)`,
    );
  }
  const idx = (step: number) => (degree - 1 + step) % length;
  const rootPc = tones[idx(0)] ?? pitchClass(key.rootPc);
  const offsets = [0, 2, 4, 6].slice(0, size).map((step) => {
    const pc = tones[idx(step)] ?? rootPc;
    return (((pc - rootPc) % 12) + 12) % 12;
  });
  const thirdIc = offsets[1] ?? 4;
  const fifthIc = offsets[2] ?? 7;
  const quality =
    size === 3
      ? classifyTriad(thirdIc, fifthIc)
      : classifySeventh(thirdIc, fifthIc, offsets[3] ?? 11);
  if (!matchesQualityIntervals(quality, offsets)) {
    throw new InvalidInputError(
      `scale thirds at degree ${degree} produce unsupported intervals [${offsets.join(', ')}]`,
    );
  }
  return { rootPc, quality, intervals: offsets };
}

/**
 * Build the diatonic triad rooted on a scale degree by stacking scale thirds.
 *
 * Unlike {@link chordFromDegree}, the chord quality is derived from the scale
 * rather than supplied, so degrees yield their scale-correct triads (e.g. a
 * diminished triad on the leading tone of a major key).
 *
 * @param degree 1-based scale degree of the chord root: 1 is the tonic.
 * @param key Key/scale context, as a key name, a key/scale, or a `Key`.
 * @returns The diatonic triad.
 * @throws If the scale is not heptatonic. Stacking thirds means skipping every
 *   other degree, which only lands on a triad when there are seven of them, so
 *   the pentatonic, blues, whole-tone, octatonic and chromatic scales have no
 *   diatonic triad; use {@link chordFromDegree} with an explicit quality there.
 *
 * @example
 * ```ts
 * import { majorKey, diatonicTriad } from '@libraz/libcantus';
 * const tonic = diatonicTriad(1, majorKey(0)); // C major triad (degree 1 of C major)
 * ```
 *
 * @category Chords
 */
export function diatonicTriad(degree: number, key: KeyLike): Chord {
  return stackThirds(degree, toKeyScale(key), 3);
}

/**
 * Build the diatonic seventh chord rooted on a scale degree.
 *
 * @param degree 1-based scale degree of the chord root: 1 is the tonic.
 * @param key Key/scale context, as a key name, a key/scale, or a `Key`.
 * @returns The diatonic seventh chord.
 * @throws If the scale is not heptatonic, for the reason given on
 *   {@link diatonicTriad}.
 *
 * @category Chords
 */
export function diatonicSeventh(degree: number, key: KeyLike): Chord {
  return stackThirds(degree, toKeyScale(key), 4);
}
