/**
 * The bass lick dictionary: the figures a bass player reaches for, held as
 * chord-relative degrees and beat positions and deformed to fit the progression
 * actually in front of them.
 *
 * Provenance: no entry reproduces a bass line from a particular song. Each is a
 * figure that belongs to nobody — the descending soul walk-down, the octave
 * slap, the boogie shuffle — of the kind every player of that music already
 * plays, and each records the ground it qualifies under.
 */

import type { Articulation } from '../../core/instrument/index.js';
import type { TimeSignature } from '../../core/meter/index.js';
import { deepFreeze } from '../vocabulary/freeze.js';
import { BEAT_STEPS, type GridEvent, type Vocabulary } from '../vocabulary/index.js';

/**
 * One note of a lick, relative to the chord it is played over.
 *
 * A degree is 1-based and counts up from the chord's root: 1 is the root, 3 the
 * third, 8 the octave. Degrees the chord itself names — the third, fifth and
 * seventh — are taken from the chord, so the same figure comes out major over a
 * major chord and minor over a minor one. A degree the chord's quality settles
 * without stating it follows the quality: the third of a suspended chord is the
 * tone the suspension put there, and a seventh chord's remaining degrees are
 * its own chord scale's. Only what the harmony leaves open is taken from the
 * key. That is what lets a figure be written once and fit a whole progression.
 *
 * @category Composition
 */
export type LickNote = GridEvent & {
  /** Chord degree, 1-based; 8 is the octave above the root. */
  degree: number;
  /** Chromatic alteration in semitones, for a flattened or raised degree. */
  alter?: number;
  /** Sounding length in sixteenths; one step when absent. */
  lengthSteps?: number;
  /** How the note is played, when it is more than a plain note. */
  articulation?: Articulation;
};
/**
 * A lick: its notes and how long the whole figure lasts.
 *
 * @category Composition
 */
export type LickMaterial = {
  /** Length of the figure in sixteenths. */
  lengthSteps: number;
  notes: LickNote[];
};
/**
 * A lick with the conditions it fits.
 *
 * @category Composition
 */
export type BassLick = Vocabulary<LickMaterial>;
/**
 * Whether a caller's material is a bass lick.
 *
 * @category Composition
 */
export function isLickMaterial(material: unknown): material is LickMaterial {
  const candidate = material as LickMaterial | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.lengthSteps === 'number' &&
    Array.isArray(candidate.notes)
  );
}
/** One note of a lick. */
function note(
  degree: number,
  step: number,
  velocity: number,
  extra?: { alter?: number; lengthSteps?: number; articulation?: LickNote['articulation'] },
): LickNote {
  return { degree, step, velocity, ...extra };
}
/** A one-bar figure on the sixteenth grid. */
export const BAR: number = 4 * BEAT_STEPS;
/**
 * The meter every built-in figure is written in.
 *
 * It is declared rather than left out because an absent condition means "any",
 * and these are not any: their accents fall where a four-beat bar puts them, so
 * a waltz or a jig would be handed a figure written against a bar it does not
 * have.
 */
export const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };
/**
 * The built-in bass licks, in declaration order.
 *
 * @category Composition
 */
export const BASS_LICKS: readonly BassLick[] = deepFreeze([
  {
    id: 'motownWalkDown',
    genre: 'motown',
    difficulty: 3,
    articulations: [],
    ts: FOUR_FOUR,
    fitsOver: ['maj', 'maj7', '6', 'dom7'],
    tempoRange: [88, 136],
    material: {
      lengthSteps: BAR,
      notes: [
        note(1, 0, 1),
        note(8, 4, 0.85),
        note(7, 8, 0.85),
        note(6, 10, 0.8),
        note(5, 12, 0.9),
        note(3, 14, 0.8),
      ],
    },
    provenance: {
      basis: 'idiom',
      note: 'the stepwise walk down from the octave that every player of the style plays',
    },
  },
  {
    id: 'soulOctavePush',
    genre: 'soul',
    difficulty: 2,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [72, 120],
    material: {
      lengthSteps: BAR,
      notes: [note(1, 0, 1), note(8, 6, 0.8), note(1, 8, 0.9), note(5, 14, 0.8)],
    },
    provenance: {
      basis: 'idiom',
      note: 'root and octave answering each other across the bar, with a push into the next chord',
    },
  },
  {
    id: 'funkSixteenthPop',
    genre: 'funk',
    difficulty: 4,
    articulations: ['mute'],
    ts: FOUR_FOUR,
    tempoRange: [84, 124],
    material: {
      lengthSteps: BAR,
      notes: [
        note(1, 0, 1),
        note(1, 2, 0.4, { articulation: 'mute' }),
        note(8, 3, 0.9),
        note(1, 6, 0.5, { articulation: 'mute' }),
        note(5, 8, 0.85),
        note(1, 11, 0.4, { articulation: 'mute' }),
        note(8, 12, 0.9),
        note(7, 15, 0.7, { alter: -1 }),
      ],
    },
    provenance: {
      basis: 'idiom',
      note: 'the octave-and-ghost sixteenth figure that defines the style, with a flat seventh on the way out',
    },
  },
  {
    id: 'bluesBoogie',
    genre: 'blues',
    difficulty: 2,
    articulations: [],
    ts: FOUR_FOUR,
    fitsOver: ['maj', 'dom7'],
    tempoRange: [76, 168],
    material: {
      lengthSteps: BAR,
      notes: [
        note(1, 0, 1),
        note(5, 2, 0.85),
        note(6, 4, 0.85),
        note(7, 6, 0.85, { alter: -1 }),
        note(6, 8, 0.85),
        note(5, 10, 0.85),
        note(1, 12, 0.9),
        note(5, 14, 0.8),
      ],
    },
    provenance: {
      basis: 'traditional',
      note: 'the boogie figure of the twelve-bar tradition: root, fifth, sixth, flat seventh and back',
    },
  },
  {
    id: 'jazzWalkingApproach',
    genre: 'jazz',
    difficulty: 3,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [100, 240],
    material: {
      lengthSteps: BAR,
      notes: [note(1, 0, 1), note(3, 4, 0.85), note(5, 8, 0.85), note(6, 12, 0.85)],
    },
    provenance: {
      basis: 'idiom',
      note: 'the quarter-note walk through the chord that ends a step from wherever it is going',
    },
  },
  {
    id: 'bossaTwoFeel',
    genre: 'bossa',
    difficulty: 2,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [104, 168],
    material: {
      lengthSteps: BAR,
      notes: [note(1, 0, 1), note(5, 6, 0.85), note(1, 8, 0.95), note(5, 14, 0.8)],
    },
    provenance: {
      basis: 'traditional',
      note: 'the two-beat root-and-fifth of the Brazilian dance form, anticipated across the bar line',
    },
  },
  {
    id: 'gospelPassing',
    genre: 'gospel',
    difficulty: 4,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [60, 108],
    material: {
      lengthSteps: BAR,
      notes: [
        note(1, 0, 1),
        note(2, 3, 0.7),
        note(3, 4, 0.9),
        note(5, 7, 0.8),
        note(6, 8, 0.85),
        note(5, 11, 0.75),
        note(3, 12, 0.85),
        note(2, 15, 0.7),
      ],
    },
    provenance: {
      basis: 'idiom',
      note: 'the busy stepwise motion between chord tones that the church style fills its bars with',
    },
  },
  {
    id: 'countryAlternating',
    genre: 'country',
    difficulty: 1,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [80, 180],
    material: {
      lengthSteps: BAR,
      notes: [note(1, 0, 1), note(5, 4, 0.85), note(1, 8, 0.95), note(5, 12, 0.85)],
    },
    provenance: {
      basis: 'traditional',
      note: 'the alternating root and fifth of the dance-band bass, older than any recording of it',
    },
  },
  {
    id: 'reggaeOffbeatDrop',
    genre: 'reggae',
    difficulty: 3,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [64, 104],
    material: {
      lengthSteps: BAR,
      notes: [
        note(1, 2, 0.9),
        note(3, 4, 0.85),
        note(5, 6, 0.85),
        note(1, 10, 0.95),
        note(7, 14, 0.8, { alter: -1 }),
      ],
    },
    provenance: {
      basis: 'idiom',
      note: 'the figure that leaves the downbeat empty and lands after it',
    },
  },
]);
