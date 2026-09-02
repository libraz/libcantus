/**
 * Part writing: grade a finished exercise against the classical four-part rules.
 *
 * The counterpoint predicates each judge one pair of voices at one moment; this
 * module walks a whole progression and reports every violation it finds, so a
 * completed exercise can be marked in a single call.
 *
 * The input is spelled notes rather than MIDI pitches because two of the rules
 * cannot be decided without them: a cross relation is one letter carrying two
 * different accidentals, and an augmented second is a minor third under another
 * name. A caller holding only pitches spells them with {@link spellVoicing}.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { Note } from '../../core/pitch/index.js';
import {
  formatNote,
  noteToMidi,
  noteToPitchClass,
  pitchClassOf,
  spelledInterval,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertArray, assertOptions } from '../../core/validation/index.js';
import type { Chord } from '../chord/index.js';
import { assertChord, chordPitchClasses } from '../chord/index.js';
import {
  createsHiddenParallelPerfect,
  createsParallelPerfect,
  createsVoiceCrossing,
  createsVoiceOverlap,
  exceedsSpacing,
  isAugmentedMelodicInterval,
  isLeadingToneResolution,
} from '../counterpoint/index.js';
import { type KeyLike, resolveKey, type SpelledKeyLike, toKeyScale } from '../scale/index.js';
import { spellPitch } from '../spelling/index.js';
import {
  isDescendingStep,
  isFrustratedLeadingTone,
  isFunctioningLeadingTone,
  leadingTonePcOf,
  seventhPcOf,
} from '../tendency/index.js';
import type { VoiceRange } from '../voicing/index.js';
import { SATB_RANGES } from '../voicing/index.js';
import { resolveMaxSpacing, resolveRanges } from '../voicing/satb.js';
import { crossRelations, isOuterVoice } from './cross-relation.js';
import { intervalWord, violation } from './internal.js';

/**
 * The rule a {@link PartWritingViolation} breaks.
 *
 * - `parallelFifth`, `parallelOctave`: consecutive perfect intervals of the same
 *   kind between one pair of voices. A parallel unison is reported as a
 *   `parallelOctave`, since it is the same perfect class.
 * - `hiddenPerfect`: the outer voices reach a perfect fifth or octave by similar
 *   motion with a leap in the upper voice. The leap is what exposes it in a
 *   four-part texture; in a two-voice species exercise nothing covers the
 *   arrival, so similar motion into a perfect interval is reported however the
 *   upper voice got there.
 * - `crossRelation`: one letter carries two different accidentals in two
 *   different voices across a chord change, exposed — neither note led into by
 *   step, at least one of them in an outer voice, and neither chord one of the
 *   chromatic harmonies that are written with the contradiction.
 * - `voiceCrossing`, `overlap`, `spacing`, `range`: the texture rules.
 * - `unresolvedLeadingTone`, `unresolvedSeventh`: a tendency tone that does not
 *   go where it must.
 * - `augmentedMelodicInterval`: a single voice moves by an augmented interval.
 *
 * The rest are raised by {@link checkSpecies} alone, since they describe faults
 * only a species exercise can commit:
 *
 * - `wrongRhythmicRatio`: the counterpoint's rhythm does not read against the
 *   cantus firmus as its species requires — the wrong number of notes per
 *   cantus-firmus note, and, in the fifth species, note values the style does
 *   not write or a `durations` array that does not describe the counterpoint it
 *   was given.
 * - `unpreparedDissonance`: a dissonance falls where the species allows none, or
 *   is reached or left by leap where it must be passed through by step.
 * - `unresolvedSuspension`: a fourth-species suspension that does not fall by
 *   step onto the following consonance.
 * - `illegalLeap`: a melodic leap the style forbids — either seventh, the
 *   tritone, or anything wider than an octave.
 * - `battuta`: an octave or unison reached by contrary motion with the upper
 *   voice leaping down.
 * - `missingCadence`: the exercise does not open or close on the formula its
 *   species requires.
 * - `melodicShape`: the counterpoint is a poor line — it has no single climax,
 *   leaps too often or too far one way, leaves a wide leap unanswered, outlines
 *   a tritone, or repeats a note where the species keeps moving. The rationale
 *   says which.
 *
 * @category Voicing & Counterpoint
 */
export type PartWritingViolationKind =
  | 'parallelFifth'
  | 'parallelOctave'
  | 'hiddenPerfect'
  | 'crossRelation'
  | 'voiceCrossing'
  | 'overlap'
  | 'spacing'
  | 'range'
  | 'unresolvedLeadingTone'
  | 'unresolvedSeventh'
  | 'augmentedMelodicInterval'
  | 'wrongRhythmicRatio'
  | 'unpreparedDissonance'
  | 'unresolvedSuspension'
  | 'illegalLeap'
  | 'battuta'
  | 'missingCadence'
  | 'melodicShape';

/**
 * One broken rule, located in the progression and in the texture.
 *
 * @category Voicing & Counterpoint
 */
export type PartWritingViolation = {
  /** The rule that was broken. */
  kind: PartWritingViolationKind;
  /**
   * The voices involved, by index into a voicing (0 = lowest). A rule about a
   * pair names both, ascending; a rule about a single line names one. A
   * `crossRelation` is the exception: it names the voice holding the earlier
   * note first, whichever is higher. In a species exercise there are only two
   * voices and they are named by role instead: 0 is the cantus firmus and 1 the
   * counterpoint, whichever lies above.
   */
  voices: number[];
  /**
   * Index of the chord the motion starts on; in a species exercise, the index
   * into the counterpoint.
   */
  fromIndex: number;
  /** Index of the chord it ends on; equal to `fromIndex` for a vertical rule. */
  toIndex: number;
  /** A short sentence naming the musical reason. */
  rationale: string;
};

/**
 * A chord realized as one spelled note per voice, ascending (index 0 = lowest),
 * matching the voice order {@link voiceChord} and {@link SATB_RANGES} use.
 *
 * Every note must carry an octave: the rules measure real distances between
 * sounding pitches, which a bare pitch class does not have.
 *
 * @category Voicing & Counterpoint
 */
export type SpelledVoicing = Note[];

/**
 * Options controlling {@link checkPartWriting}.
 *
 * @category Voicing & Counterpoint
 */
export type PartWritingOptions = {
  /**
   * Per-voice ranges, ascending (index 0 = lowest), against which the `range`
   * rule is judged. Defaults to {@link SATB_RANGES} for a four-voice exercise;
   * for any other voice count there is no conventional compass to assume, so
   * the rule is skipped unless ranges are given. Given ranges must cover every
   * voice of the widest chord, and each must be finite with `min` no greater
   * than `max`.
   */
  ranges?: VoiceRange[];
  /**
   * Maximum spacing in semitones between adjacent upper voices. The bass-tenor
   * pair is exempt, as convention has it. Must be finite and non-negative.
   *
   * @defaultValue 12
   */
  maxSpacing?: number;
};

/** A note without its octave, for naming it in a rationale. */
function bare(note: Note): Note {
  return { letter: note.letter, alter: note.alter };
}

/** The sounding pitch of a spelled note, located for the error message. */
function midiOf(note: Note, index: number, voice: number): number {
  if (note.octave === undefined) {
    throw new InvalidInputError(`voicings[${index}][${voice}] must carry an octave`);
  }
  return noteToMidi(note);
}

/** One chord of the exercise, and everything the rules read off it. */
type Moment = {
  notes: SpelledVoicing;
  pitches: number[];
  chord: Chord;
  index: number;
};

/** The rules judged inside one chord: crossing, spacing, and range. */
function verticalViolations(
  moment: Moment,
  ranges: readonly Readonly<VoiceRange>[] | undefined,
  maxSpacing: number,
): PartWritingViolation[] {
  const found: PartWritingViolation[] = [];
  const { pitches, index } = moment;
  for (let voice = 1; voice < pitches.length; voice += 1) {
    const upper = pitches[voice];
    const lower = pitches[voice - 1];
    if (upper === undefined || lower === undefined) {
      continue;
    }
    if (createsVoiceCrossing(upper, lower)) {
      found.push(
        violation(
          'voiceCrossing',
          [voice - 1, voice],
          index,
          index,
          'The upper voice lies below the voice beneath it',
        ),
      );
    }
    // The bass-tenor pair is conventionally allowed to open up further than the
    // upper voices, so the spacing rule starts one pair above it.
    if (voice >= 2 && exceedsSpacing(upper, lower, maxSpacing)) {
      found.push(
        violation(
          'spacing',
          [voice - 1, voice],
          index,
          index,
          `Adjacent upper voices lie more than ${maxSpacing} semitones apart`,
        ),
      );
    }
  }
  if (ranges === undefined) {
    return found;
  }
  for (let voice = 0; voice < pitches.length; voice += 1) {
    const pitch = pitches[voice];
    const range = ranges[voice];
    if (pitch === undefined || range === undefined) {
      continue;
    }
    if (pitch < range.min || pitch > range.max) {
      found.push(violation('range', [voice], index, index, 'The voice sings outside its range'));
    }
  }
  return found;
}

/**
 * Two consecutive chords of the exercise, the key they sound in, and the chords
 * on either side of the pair. The neighbours are what tells a chromatic tone
 * that was led into by step from one that was leapt at, and an applied dominant
 * from the diatonic triad that sounds the same.
 */
type Transition = {
  from: Moment;
  to: Moment;
  key: KeyScale;
  before?: Moment;
  after?: Moment;
};

/** The rules judged between two voices moving together: parallels and overlap. */
function pairViolations(transition: Transition): PartWritingViolation[] {
  const found: PartWritingViolation[] = [];
  const { from, to } = transition;
  const voices = Math.min(from.pitches.length, to.pitches.length);
  for (let lower = 0; lower < voices; lower += 1) {
    for (let upper = lower + 1; upper < voices; upper += 1) {
      const upperPrev = from.pitches[upper];
      const upperCur = to.pitches[upper];
      const lowerPrev = from.pitches[lower];
      const lowerCur = to.pitches[lower];
      if (
        upperPrev === undefined ||
        upperCur === undefined ||
        lowerPrev === undefined ||
        lowerCur === undefined
      ) {
        continue;
      }
      if (createsParallelPerfect(upperPrev, upperCur, lowerPrev, lowerCur)) {
        const fifth = pitchClassOf(upperCur - lowerCur) === 7;
        found.push(
          violation(
            fifth ? 'parallelFifth' : 'parallelOctave',
            [lower, upper],
            from.index,
            to.index,
            fifth
              ? 'The two voices move into consecutive perfect fifths'
              : 'The two voices move into consecutive perfect octaves',
          ),
        );
      }
      if (upper === lower + 1 && createsVoiceOverlap(upperPrev, upperCur, lowerPrev, lowerCur)) {
        found.push(
          violation(
            'overlap',
            [lower, upper],
            from.index,
            to.index,
            'The voice moves past where its neighbour just was',
          ),
        );
      }
    }
  }
  // The hidden perfect is judged on the outer voices alone, where the bare fifth
  // or octave is exposed; between inner voices it is covered by the others.
  const bassPrev = from.pitches[0];
  const bassCur = to.pitches[0];
  const topPrev = from.pitches[voices - 1];
  const topCur = to.pitches[voices - 1];
  if (
    voices >= 2 &&
    bassPrev !== undefined &&
    bassCur !== undefined &&
    topPrev !== undefined &&
    topCur !== undefined &&
    createsHiddenParallelPerfect(topPrev, topCur, bassPrev, bassCur)
  ) {
    found.push(
      violation(
        'hiddenPerfect',
        [0, voices - 1],
        from.index,
        to.index,
        'The outer voices reach a perfect interval by similar motion, the upper one by leap',
      ),
    );
  }
  return found;
}

/**
 * Cross relations: the same letter carrying different accidentals in two
 * different voices across the chord change, reported as broken rules.
 *
 * The rule itself lives beside the voicing search that has to obey it, so what
 * is left here is naming the clash the search refused to write.
 */
function crossRelationViolations(transition: Transition): PartWritingViolation[] {
  const { from, to, key, before, after } = transition;
  return crossRelations(from, to, key, { before: before?.notes, after: after?.chord }).map(
    (clash) =>
      violation(
        'crossRelation',
        [clash.earlierVoice, clash.laterVoice],
        from.index,
        to.index,
        `${formatNote(bare(clash.earlier))} is contradicted by ${formatNote(bare(clash.later))} in another voice`,
      ),
  );
}

/**
 * The rules judged along one line: augmented melodic intervals, and the tendency
 * tones that must go somewhere in particular.
 *
 * A chordal seventh is a dissonance, so the voice carrying it falls by step
 * unless the next chord holds it as a common tone. A leading tone rises to the
 * tonic when it is functioning as one — the third of a dominant chord or the
 * root of a leading-tone chord — and the next chord contains the tonic and has
 * dropped the leading tone itself. Elsewhere the same pitch class is an
 * ordinary chord tone, so `iii` moving to `IV` is not asked to resolve its
 * fifth.
 *
 * The leading-tone rule is judged in every voice, but not by the same measure in
 * all of them: an inner voice may frustrate its leading tone, falling a third
 * onto the fifth of the arriving chord to complete a triad the rising resolution
 * would leave without one. That is the other standard answer to a complete
 * dominant seventh, so it is not reported. In the bass or the top voice the
 * leading tone is exposed and is still required to rise; any other way of
 * leaving it, in an inner voice or an outer one, is reported as before.
 */
function melodicViolations(transition: Transition): PartWritingViolation[] {
  const found: PartWritingViolation[] = [];
  const { from, to, key } = transition;
  const seventhPc = seventhPcOf(from.chord);
  const nextPcs = new Set(chordPitchClasses(to.chord));
  const leadingTonePc = leadingTonePcOf(key);
  const tonicPc = pitchClassOf(key.rootPc);
  const voices = Math.min(from.notes.length, to.notes.length);
  for (let voice = 0; voice < voices; voice += 1) {
    const earlier = from.notes[voice];
    const later = to.notes[voice];
    const earlierPitch = from.pitches[voice];
    const laterPitch = to.pitches[voice];
    if (
      earlier === undefined ||
      later === undefined ||
      earlierPitch === undefined ||
      laterPitch === undefined
    ) {
      continue;
    }
    const interval = spelledInterval(earlier, later);
    if (isAugmentedMelodicInterval(earlier, later)) {
      found.push(
        violation(
          'augmentedMelodicInterval',
          [voice],
          from.index,
          to.index,
          `The voice moves by an augmented ${intervalWord(interval.number)}`,
        ),
      );
    }
    const earlierPc = noteToPitchClass(earlier);
    if (earlierPc === seventhPc && !nextPcs.has(earlierPc) && !isDescendingStep(interval)) {
      found.push(
        violation(
          'unresolvedSeventh',
          [voice],
          from.index,
          to.index,
          'The chordal seventh does not fall by step',
        ),
      );
    }
    const inner = !isOuterVoice(voice, from.notes) && !isOuterVoice(voice, to.notes);
    if (
      earlierPc === leadingTonePc &&
      isFunctioningLeadingTone(from.chord, key) &&
      nextPcs.has(tonicPc) &&
      !nextPcs.has(earlierPc) &&
      !isLeadingToneResolution(earlierPitch, laterPitch, key) &&
      !(inner && isFrustratedLeadingTone(earlierPitch, laterPitch, to.chord))
    ) {
      found.push(
        violation(
          'unresolvedLeadingTone',
          [voice],
          from.index,
          to.index,
          'The leading tone does not rise to the tonic',
        ),
      );
    }
  }
  return found;
}

/**
 * Spell a voicing given as MIDI pitches, so it can be checked by
 * {@link checkPartWriting}.
 *
 * Each pitch is named against the chord sounding under it and then the key, so a
 * chord tone takes the letter the degree it plays in that chord implies: the
 * third of a D major chord in C major spells F#, not Gb. The chord is passed
 * whole rather than by its root, so a chord carrying its own spelling names its
 * tones here exactly as {@link spellChord} names them — the German sixth keeps
 * the F# that resolves outward to the dominant. The octave is kept, since the
 * rules measure real distances.
 *
 * @param voicing MIDI pitches, ascending (index 0 = lowest).
 * @param chord The chord sounding, supplying the enharmonic evidence.
 * @param key The key the exercise is written in.
 * @returns One spelled note per pitch, in the same order.
 * @example
 * ```ts
 * import { majorKey, makeChord, noteNames, spellVoicing } from '@libraz/libcantus';
 * noteNames(spellVoicing([50, 57, 66, 69], makeChord(2, 'maj'), majorKey(0)));
 * // ['D3', 'A3', 'F#4', 'A4'] — the third of D spells F# in C major
 * ```
 * @category Voicing & Counterpoint
 */
export function spellVoicing(
  voicing: readonly number[],
  chord: Chord,
  key: SpelledKeyLike,
): SpelledVoicing {
  assertArray<number>(voicing, 'voicing');
  assertChord(chord);
  // Read whole rather than reduced: a voicing in Ab minor is written on flats,
  // and a key handed in spelled that way was losing its spelling right here.
  const { tonic, scale } = resolveKey(key);
  return voicing.map((pitch) => spellPitch(pitch, tonic, scale, { chord }));
}

/**
 * Check a finished part-writing exercise and report every rule it breaks.
 *
 * The voicings are given one per chord, each ascending with one spelled note per
 * voice (index 0 = lowest, the bass), the voice order {@link voiceChord} and
 * {@link SATB_RANGES} already use. Notes must carry octaves.
 *
 * Each chord is checked for voice crossing, over-wide spacing between adjacent
 * upper voices, and voices outside their range; each pair of consecutive chords
 * for parallel and hidden perfects, voice overlap, cross relations, augmented
 * melodic intervals, and unresolved tendency tones. Violations come back in
 * musical order: the rules inside a chord, then the rules taking it to the next.
 *
 * @param voicings One voicing per chord, ascending, in spelled notes.
 * @param chords The chords those voicings realize, in the same order.
 * @param key The key the exercise is written in; it names the leading tone.
 * @param opts Ranges and the upper-voice spacing limit. Both are validated
 *   before any rule runs: an empty result has to mean that nothing was broken,
 *   never that a rule could not be evaluated.
 * @returns Every violation found, in musical order; an empty array for a clean
 *   exercise.
 * @throws If the two arrays differ in length, a note carries no octave, the
 *   spacing limit is not a non-negative finite number, or the ranges are empty,
 *   malformed, or too few for the voices being checked.
 * @example
 * ```ts
 * import { checkPartWriting, majorKey, makeChord, spellVoicing } from '@libraz/libcantus';
 * const key = majorKey(0);
 * const chords = [makeChord(0, 'maj'), makeChord(2, 'min')];
 * const voicings = [[48, 55, 64, 72], [50, 57, 65, 69]].map((pitches, i) =>
 *   spellVoicing(pitches, chords[i] ?? chords[0], key),
 * );
 * const violations = checkPartWriting(voicings, chords, key);
 * violations.map((violation) => violation.kind); // ['parallelFifth']
 * violations[0]?.voices; // [0, 1]
 * ```
 * @category Voicing & Counterpoint
 */
export function checkPartWriting(
  voicings: readonly SpelledVoicing[],
  chords: readonly Chord[],
  keyLike: KeyLike,
  opts?: PartWritingOptions,
): PartWritingViolation[] {
  assertArray<SpelledVoicing>(voicings, 'voicings');
  assertArray<Chord>(chords, 'chords');
  const asked = assertOptions(opts, 'opts');
  const key = toKeyScale(keyLike);
  if (voicings.length !== chords.length) {
    throw new InvalidInputError(
      `checkPartWriting needs one chord per voicing; received ${voicings.length} voicings and ${chords.length} chords`,
    );
  }
  // The limits are resolved through the same validators the voicing search
  // uses, and before any rule runs: a NaN limit would silently switch the
  // spacing rule off, and ranges too short for the texture would leave the top
  // voices unjudged, both of which report as a clean exercise.
  const maxSpacing = resolveMaxSpacing(asked);
  const voiceCount = voicings.reduce((widest, voicing) => Math.max(widest, voicing.length), 0);
  let ranges: readonly Readonly<VoiceRange>[] | undefined;
  if (asked.ranges === undefined) {
    // Four voices are the SATB exercise these ranges were written for; any other
    // count has no conventional compass, so an unasked-for range check would
    // invent one.
    ranges = voiceCount === 4 ? SATB_RANGES : undefined;
  } else {
    ranges = resolveRanges(asked);
    if (ranges.length < voiceCount) {
      throw new InvalidInputError(
        `checkPartWriting needs one range per voice; received ${ranges.length} ranges for ${voiceCount} voices`,
      );
    }
  }

  const moments: Moment[] = [];
  for (let index = 0; index < voicings.length; index += 1) {
    const notes = voicings[index];
    const chord = chords[index];
    if (notes === undefined || chord === undefined) {
      continue;
    }
    moments.push({
      notes,
      pitches: notes.map((note, voice) => midiOf(note, index, voice)),
      chord,
      index,
    });
  }

  const violations: PartWritingViolation[] = [];
  for (let position = 0; position < moments.length; position += 1) {
    const moment = moments[position];
    const previous = position > 0 ? moments[position - 1] : undefined;
    if (moment === undefined) {
      continue;
    }
    if (previous !== undefined) {
      const transition: Transition = {
        from: previous,
        to: moment,
        key,
        before: position > 1 ? moments[position - 2] : undefined,
        after: moments[position + 1],
      };
      violations.push(...pairViolations(transition));
      violations.push(...crossRelationViolations(transition));
      violations.push(...melodicViolations(transition));
    }
    violations.push(...verticalViolations(moment, ranges, maxSpacing));
  }
  return violations;
}

export type { Species, SpeciesOptions } from './species.js';
export { checkSpecies } from './species.js';
