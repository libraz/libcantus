/**
 * Transposing instruments: the fixed interval between the pitch a player reads
 * and the pitch the instrument sounds.
 *
 * The distance is a spelled interval, never a semitone count. A clarinet in A
 * sounds a minor third below what it reads, so a written C sounds A, a written
 * D sounds B, and a written D# sounds B#: the letter always moves by the
 * interval's diatonic number, where a bare count of three semitones would take
 * the last of those to C natural and lose the letter the part is written on.
 *
 * The octave is part of that interval rather than folded away into a pitch
 * class, so instruments pitched in the same key stay apart: the alto saxophone
 * sounds a major sixth lower, the baritone saxophone a major thirteenth (the
 * same key an octave further down), and the E flat clarinet a minor third
 * higher. The pure octave transposers — piccolo, double bass, contrabassoon,
 * guitar — are a perfect octave, a unison-class interval displaced by one
 * octave.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { IntervalLike, Note, SpelledInterval } from '../../core/pitch/index.js';
import { parseInterval, toSpelledInterval, transposeByInterval } from '../../core/pitch/index.js';

/**
 * The interval from a written pitch to the pitch the instrument sounds, one
 * entry per built-in instrument.
 *
 * Each value is an interval name as {@link parseInterval} reads it, in the
 * written-to-sounding direction: a leading `'-'` marks an instrument that
 * sounds below what it reads, which is most of them. A transposition wider than
 * an octave is named by its compound interval rather than reduced, because the
 * octave is exactly what separates the tenor saxophone from the soprano and the
 * baritone from the alto.
 *
 * @example
 * ```ts
 * import { TRANSPOSING_INSTRUMENTS } from '@libraz/libcantus';
 * TRANSPOSING_INSTRUMENTS.clarinetA; // '-m3' — sounds a minor third lower
 * TRANSPOSING_INSTRUMENTS.piccolo; // 'P8' — sounds an octave higher
 * ```
 * @category Pitch & Intervals
 */
export const TRANSPOSING_INSTRUMENTS = Object.freeze({
  // In B flat: a written C sounds B flat. The lower members of the family read
  // in the same key an octave higher, so their interval is the compound one.
  clarinetBb: '-M2',
  trumpetBb: '-M2',
  sopranoSax: '-M2',
  tenorSax: '-M9',
  bassClarinet: '-M9',
  // In A: a written C sounds A.
  clarinetA: '-m3',
  // In F: a written C sounds F.
  hornF: '-P5',
  englishHorn: '-P5',
  // In E flat: one key, three registers. The sopranino clarinet sounds above
  // what it reads, the alto saxophone a major sixth below, and the baritone
  // saxophone an octave below that.
  clarinetEb: 'm3',
  altoSax: '-M6',
  baritoneSax: '-M13',
  // In D: a written C sounds D.
  trumpetD: 'M2',
  // Octave transposers: the instrument is in C, only the register moves.
  piccolo: 'P8',
  doubleBass: '-P8',
  contrabassoon: '-P8',
  guitar: '-P8',
});

/**
 * The name of a built-in transposing instrument, as
 * {@link TRANSPOSING_INSTRUMENTS} keys them.
 *
 * @example
 * ```ts
 * import type { TransposingInstrumentName } from '@libraz/libcantus';
 * const part: TransposingInstrumentName = 'clarinetA';
 * ```
 * @category Pitch & Intervals
 */
export type TransposingInstrumentName = keyof typeof TRANSPOSING_INSTRUMENTS;

/**
 * A transposing instrument: one of the built-in names, or a spelled interval
 * for an instrument the table does not carry.
 *
 * An interval is read in the same written-to-sounding direction as the table,
 * so `'-M2'` is any instrument in B flat and `'P8'` any that sounds an octave
 * up. The names complete in an editor while any other string is still accepted,
 * which is what lets an instrument read from configuration go straight in.
 *
 * @example
 * ```ts
 * import type { TransposingInstrument } from '@libraz/libcantus';
 * const clarinet: TransposingInstrument = 'clarinetA';
 * const altoFlute: TransposingInstrument = '-P4';
 * ```
 * @category Pitch & Intervals
 */
export type TransposingInstrument =
  | TransposingInstrumentName
  | (string & {})
  | Exclude<IntervalLike, string>;

/**
 * The interval a transposing instrument sounds at, measured from what it reads.
 *
 * This is the table's own direction: the answer descends for an instrument that
 * sounds below the printed part, which is most of them. Applying it to a
 * written pitch is {@link toSoundingPitch}, and applying it to a concert key is
 * how a written key is read back as the key it sounds in.
 *
 * @param instrument A built-in instrument name, or an interval naming a
 *   transposition the table does not carry.
 * @returns The written-to-sounding interval.
 * @throws If the value is neither a known instrument nor a spelled interval.
 * @example
 * ```ts
 * import { instrumentTransposition } from '@libraz/libcantus';
 * instrumentTransposition('clarinetA');
 * // { number: 3, quality: 'm', semitones: -3, descending: true }
 * instrumentTransposition('piccolo'); // { number: 8, quality: 'P', semitones: 12 }
 * ```
 * @category Pitch & Intervals
 */
export function instrumentTransposition(instrument: TransposingInstrument): SpelledInterval {
  if (typeof instrument !== 'string') {
    return toSpelledInterval(instrument);
  }
  // Looked up through `hasOwn` so a name such as `'constructor'` cannot resolve
  // to something inherited from `Object.prototype`.
  if (Object.hasOwn(TRANSPOSING_INSTRUMENTS, instrument)) {
    return parseInterval(TRANSPOSING_INSTRUMENTS[instrument as TransposingInstrumentName]);
  }
  try {
    return parseInterval(instrument);
  } catch (error) {
    if (error instanceof InvalidInputError) {
      // A mistyped instrument name is the likely mistake, so the message names
      // that possibility rather than only the interval grammar it also failed.
      throw new InvalidInputError(
        `unknown transposing instrument ${JSON.stringify(instrument)}; ` +
          "pass a name from TRANSPOSING_INSTRUMENTS or an interval such as '-M2'",
      );
    }
    throw error;
  }
}

/**
 * The same interval taken the other way, which is what makes the two
 * conversions exact inverses.
 *
 * The `descending` flag is set rather than left to the sign, because a unison
 * spans zero semitones in both directions and the sign alone cannot say which
 * way a custom `'-P1'` was meant to go.
 */
function reversedInterval(step: SpelledInterval): SpelledInterval {
  const reversed: SpelledInterval = {
    number: step.number,
    quality: step.quality,
    // Negating a zero span yields -0, which compares unequal to 0 under Object.is.
    semitones: step.semitones === 0 ? 0 : -step.semitones,
  };
  if (!(step.descending ?? step.semitones < 0)) {
    reversed.descending = true;
  }
  return reversed;
}

/**
 * The pitch an instrument sounds for a written note.
 *
 * The interval decides the letter, so the spelling of the part survives the
 * conversion: on a clarinet in A a written C sounds A, a written D sounds B,
 * and a written D# sounds B# — a semitone count alone could answer C natural
 * for that last one and lose the letter the part is written on. A note carrying
 * an octave moves register with it — a written C4 sounds A3 — while an
 * octave-less note stays octave-less, so a pure octave transposer leaves it
 * alone.
 *
 * @param note The written note, as the player reads it.
 * @param instrument A built-in instrument name, or an interval naming a
 *   transposition the table does not carry.
 * @returns The sounding note, at concert pitch.
 * @throws If the note is malformed, or the instrument is neither a known name
 *   nor a spelled interval.
 * @example
 * ```ts
 * import { formatNote, parseNote, toSoundingPitch } from '@libraz/libcantus';
 * formatNote(toSoundingPitch(parseNote('C4'), 'clarinetA')); // 'A3'
 * formatNote(toSoundingPitch(parseNote('D#4'), 'clarinetA')); // 'B#3'
 * formatNote(toSoundingPitch(parseNote('C4'), 'piccolo')); // 'C5'
 * ```
 * @category Pitch & Intervals
 */
export function toSoundingPitch(note: Note, instrument: TransposingInstrument): Note {
  return transposeByInterval(note, instrumentTransposition(instrument));
}

/**
 * The note an instrument must read to sound a given concert pitch.
 *
 * The exact inverse of {@link toSoundingPitch} for every instrument: the same
 * interval applied the other way, so the letter and the octave both come back.
 * A concert A3 is written C4 for a clarinet in A, and a concert E flat 3 is
 * written C4 for an alto saxophone but C5 for a baritone saxophone, which reads
 * the same key an octave lower.
 *
 * @param note The sounding note, at concert pitch.
 * @param instrument A built-in instrument name, or an interval naming a
 *   transposition the table does not carry.
 * @returns The written note, as the player reads it.
 * @throws If the note is malformed, or the instrument is neither a known name
 *   nor a spelled interval.
 * @example
 * ```ts
 * import { formatNote, parseNote, toWrittenPitch } from '@libraz/libcantus';
 * formatNote(toWrittenPitch(parseNote('A3'), 'clarinetA')); // 'C4'
 * formatNote(toWrittenPitch(parseNote('Eb3'), 'altoSax')); // 'C4'
 * formatNote(toWrittenPitch(parseNote('Eb3'), 'baritoneSax')); // 'C5'
 * ```
 * @category Pitch & Intervals
 */
export function toWrittenPitch(note: Note, instrument: TransposingInstrument): Note {
  return transposeByInterval(note, reversedInterval(instrumentTransposition(instrument)));
}
