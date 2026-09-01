/**
 * The cross relation, written once.
 *
 * One letter carrying two different accidentals in two different voices across
 * a chord change is a rule the library states twice: the voicing search has to
 * refuse the contradiction, and the checker has to report it. Both read it from
 * here, so a voicing the search calls clean is one the checker calls clean.
 */

import type { Note } from '../../core/pitch/index.js';
import {
  diatonicLetterOf,
  noteToPitchClass,
  pitchClassOf,
  spelledInterval,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../chord/index.js';
import {
  appliedDominantTarget,
  hasDominantSonority,
  isNeapolitanChordOf,
} from '../tendency/index.js';

/** One chord of an exercise as this rule reads it: what sounds, and what it is. */
export type ChromaticMoment = {
  /** The written notes, ascending (index 0 = lowest). */
  notes: readonly Note[];
  /** The chord they realize. */
  chord: Chord;
};

/**
 * What stands on either side of the pair being judged. Each is what tells a
 * chromatic tone that was led into by step from one that was sprung, and an
 * applied dominant from the diatonic triad that sounds the same; a caller that
 * cannot see that far leaves it out, and the rule reads the pair as exposed.
 */
export type ChromaticContext = {
  /** The voicing before the pair, naming how the earlier notes were reached. */
  before?: readonly Note[];
  /** The chord after the pair, naming what the later chord resolves to. */
  after?: Chord;
};

/** One exposed contradiction, by the voices holding the two notes. */
export type CrossRelation = {
  /** The voice holding the earlier note. */
  earlierVoice: number;
  /** The voice holding the later one. */
  laterVoice: number;
  /** The earlier note itself. */
  earlier: Note;
  /** The later note itself. */
  later: Note;
};

/**
 * Whether a chord resolves as an applied dominant: the dominant's sonority,
 * taken down a fifth onto a degree the key can make a local tonic, with the
 * chord it names actually following.
 *
 * Named for the resolution because the resolution is the only thing this adds:
 * which degrees may be tonicized is asked of the theory layer, so a chord
 * exempted here is one the analysis layer can write an applied numeral for.
 * What the two do differ in is what they are for — there a chord is an applied
 * dominant by what it is, here only by what comes next. The same major triad on
 * the third degree of a major key is V/vi where vi follows and a plain III
 * where nothing does, and only the first of the two licenses the chromatic tone
 * it introduces.
 */
function resolvesAsAppliedDominant(chord: Chord, next: Chord | undefined, key: KeyScale): boolean {
  if (next === undefined || !hasDominantSonority(chord)) {
    return false;
  }
  const target = appliedDominantTarget(chord.rootPc + 5, key);
  return target !== null && pitchClassOf(next.rootPc) === target.rootPc;
}

/**
 * Whether a voicing sounds an augmented sixth above the lowered submediant.
 *
 * That interval is what the Italian, French and German chords are all named
 * for, and it is the only thing separating them from the bVI7 they sound like,
 * so it is read off the written letters rather than the pitch classes.
 */
function soundsAugmentedSixth(moment: ChromaticMoment, key: KeyScale): boolean {
  const bass = moment.notes[0];
  if (bass === undefined || noteToPitchClass(bass) !== pitchClassOf(key.rootPc + 8)) {
    return false;
  }
  return moment.notes.some((note, voice) => {
    if (voice === 0) {
      return false;
    }
    const interval = spelledInterval(bass, note);
    return ((interval.number - 1) % 7) + 1 === 6 && pitchClassOf(interval.semitones) === 10;
  });
}

/**
 * Whether a chord is one of the chromatic harmonies whose own definition
 * contains the contradiction: an applied dominant, the Neapolitan, or an
 * augmented sixth. Approaching or leaving one of these is where the textbooks
 * license the cross relation, since the chord cannot be written without it.
 *
 * The exemption is for chromatic harmony, so a chord the key already contains
 * cannot claim it: a mode with a lowered second of its own — phrygian, locrian —
 * sounds the major triad on that degree as its native II, and reading it as the
 * Neapolitan would exempt the key's own chord from the rule every other diatonic
 * chord answers to.
 */
function isChromaticHarmony(
  moment: ChromaticMoment,
  next: Chord | undefined,
  key: KeyScale,
): boolean {
  return (
    resolvesAsAppliedDominant(moment.chord, next, key) ||
    isNeapolitanChordOf(moment.chord, key) ||
    soundsAugmentedSixth(moment, key)
  );
}

/** Whether a voice reaches its note by a diatonic step from the voicing before. */
function approachedByStep(
  before: readonly Note[] | undefined,
  moment: readonly Note[],
  voice: number,
): boolean {
  const earlier = before?.[voice];
  const later = moment[voice];
  if (earlier === undefined || later === undefined) {
    return false;
  }
  return spelledInterval(earlier, later).number === 2;
}

/** Whether a voice is the bass or the top voice of its chord. */
export function isOuterVoice(voice: number, notes: readonly Note[]): boolean {
  return voice === 0 || voice === notes.length - 1;
}

/**
 * Every cross relation between two consecutive chords: the same letter carrying
 * different accidentals in two different voices. Within one voice the same
 * motion is an ordinary chromatic inflection, so a voice is never compared with
 * itself.
 *
 * What the rule forbids is a semitone exposed across the texture, and three
 * things take that exposure away, each of which is reason enough on its own:
 *
 * - either of the two notes is led into by step, which is how a chromatic tone
 *   is introduced rather than sprung;
 * - both notes lie in inner voices, where the classical norm is markedly
 *   milder than it is between the outer ones;
 * - the chord being left or reached is an applied dominant, the Neapolitan, or
 *   an augmented sixth, whose definition contains the altered degree.
 *
 * Each pair of voices is reported once. The two voices are walked in both
 * directions, so the same clash is met twice and the second reading is dropped.
 *
 * @param from The chord being left.
 * @param to The chord being reached.
 * @param key The key the exercise is written in.
 * @param context What stands on either side of the pair, where the caller knows
 *   it. A missing neighbour is read as no exemption rather than as one.
 * @returns One entry per contradicting pair of voices, in voice order.
 */
export function crossRelations(
  from: ChromaticMoment,
  to: ChromaticMoment,
  key: KeyScale,
  context: ChromaticContext = {},
): CrossRelation[] {
  const found: CrossRelation[] = [];
  const chromatic =
    isChromaticHarmony(from, to.chord, key) || isChromaticHarmony(to, context.after, key);
  if (chromatic) {
    return found;
  }
  const reported = new Set<string>();
  for (let first = 0; first < from.notes.length; first += 1) {
    for (let second = 0; second < to.notes.length; second += 1) {
      if (first === second) {
        continue;
      }
      const earlier = from.notes[first];
      const later = to.notes[second];
      if (earlier === undefined || later === undefined) {
        continue;
      }
      const letter = diatonicLetterOf(earlier.letter);
      if (letter !== diatonicLetterOf(later.letter) || earlier.alter === later.alter) {
        continue;
      }
      if (
        approachedByStep(context.before, from.notes, first) ||
        approachedByStep(from.notes, to.notes, second) ||
        (!isOuterVoice(first, from.notes) && !isOuterVoice(second, to.notes))
      ) {
        continue;
      }
      const pair = `${letter}:${Math.min(first, second)}:${Math.max(first, second)}`;
      if (reported.has(pair)) {
        continue;
      }
      reported.add(pair);
      found.push({ earlierVoice: first, laterVoice: second, earlier, later });
    }
  }
  return found;
}
