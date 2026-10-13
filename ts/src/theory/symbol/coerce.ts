import { InvalidInputError } from '../../core/errors/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import { assertFiniteNumber } from '../../core/validation/index.js';
import type { Chord } from '../chord/index.js';
import { parseChordSymbol } from './index.js';

/**
 * Reading a caller's chord into the one shape the library works in.
 *
 * The widening counterpart of the other `to*Data` coercers, kept beside the
 * grammar it falls back on rather than inside it: what a chord symbol means is
 * the parser's question, and what shapes stand for a chord is this one's.
 */

/**
 * Anything that names a chord: a chord symbol, plain chord data, or a value
 * that serializes to chord data such as the `Chord` class.
 *
 * @category Chords
 */
export type ChordLike =
  | string
  | Chord
  | {
      /** The chord data this value stands for. */
      toJSON(): Chord;
    };

/** Validate plain chord data and return it in the canonical shape. */
function normalizedChord(data: Chord): Chord {
  if (!Array.isArray(data.intervals)) {
    throw new InvalidInputError('chord.intervals must be an array of semitone offsets');
  }
  const copy: Chord = {
    rootPc: pitchClass(assertFiniteNumber(data.rootPc, 'chord.rootPc')),
    quality: data.quality,
    // Each offset is checked rather than copied blind: a chord holding a NaN
    // interval voices, spells and formats as a chord that looks real, and the
    // failure surfaces wherever the number is finally used.
    intervals: data.intervals.map((interval, index) =>
      assertFiniteNumber(interval, `chord.intervals[${index}]`),
    ),
  };
  if (data.bassPc !== undefined) {
    copy.bassPc = pitchClass(assertFiniteNumber(data.bassPc, 'chord.bassPc'));
  }
  // Spelling hints are carried through untouched. They are the caller's record
  // of how the chord is written, and deriving or discarding one here would
  // overrule a decision made where the key was known.
  if (data.rootSpelling !== undefined) {
    copy.rootSpelling = data.rootSpelling;
  }
  if (data.bassSpelling !== undefined) {
    copy.bassSpelling = data.bassSpelling;
  }
  if (data.toneSpellings !== undefined) {
    copy.toneSpellings = data.toneSpellings;
  }
  return copy;
}

/**
 * Resolve any chord-shaped value to plain {@link Chord} data.
 *
 * The counterpart of {@link toSpelledInterval} for chords: an entry point takes
 * whatever form the caller has — the symbol a chart holds, the data the chord
 * module returns, or a `Chord` instance — and gets one shape back. An instance
 * is accepted through its `toJSON` method rather than by its type, so the
 * layers below the model can read a class without importing it.
 *
 * @param value A chord symbol, plain chord data, or a value whose `toJSON`
 *   returns chord data.
 * @returns The validated chord data, with root and bass reduced to pitch
 *   classes and any spelling hint carried through.
 * @throws If the value names no chord, or an interval, root, or bass is not a
 *   finite number.
 * @example
 * ```ts
 * import { toChordData } from '@libraz/libcantus';
 * toChordData('Cmaj7').intervals; // [0, 4, 7, 11]
 * toChordData({ rootPc: 0, quality: 'maj', intervals: [0, 4, 7] }).rootPc; // 0
 * ```
 * @category Chords
 */
export function toChordData(value: ChordLike): Chord {
  if (typeof value === 'string') {
    return parseChordSymbol(value);
  }
  if (typeof value === 'object' && value !== null) {
    const data = 'toJSON' in value && typeof value.toJSON === 'function' ? value.toJSON() : value;
    return normalizedChord(data as Chord);
  }
  throw new InvalidInputError(
    `chord must be a chord symbol or chord data; received ${typeof value}`,
  );
}
