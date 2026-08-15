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
import type { Note, SpelledInterval } from '../../core/pitch/index.js';
import {
  diatonicLetterOf,
  formatNote,
  noteToMidi,
  noteToPitchClass,
  pitchClassOf,
  spelledInterval,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordQuality } from '../chord/index.js';
import { chordPitchClasses, chordToneRole } from '../chord/index.js';
import {
  createsHiddenParallelPerfect,
  createsParallelPerfect,
  createsVoiceCrossing,
  createsVoiceOverlap,
  exceedsSpacing,
  isAugmentedMelodicInterval,
  isLeadingToneResolution,
} from '../counterpoint/index.js';
import { spelledKeyOf } from '../scale/index.js';
import { spellPitch } from '../spelling/index.js';
import type { VoiceRange } from '../voicing/index.js';
import { SATB_RANGES } from '../voicing/index.js';
import { DEFAULT_MAX_SPACING } from '../voicing/internal.js';
import { intervalWord, violation } from './internal.js';

/**
 * The rule a {@link PartWritingViolation} breaks.
 *
 * - `parallelFifth`, `parallelOctave`: consecutive perfect intervals of the same
 *   kind between one pair of voices. A parallel unison is reported as a
 *   `parallelOctave`, since it is the same perfect class.
 * - `hiddenPerfect`: the outer voices reach a perfect fifth or octave by similar
 *   motion with a leap in the upper voice.
 * - `crossRelation`: one letter carries two different accidentals in two
 *   different voices across a chord change.
 * - `voiceCrossing`, `overlap`, `spacing`, `range`: the texture rules.
 * - `unresolvedLeadingTone`, `unresolvedSeventh`: a tendency tone that does not
 *   go where it must.
 * - `augmentedMelodicInterval`: a single voice moves by an augmented interval.
 *
 * The rest are raised by {@link checkSpecies} alone, since they describe faults
 * only a species exercise can commit:
 *
 * - `wrongRhythmicRatio`: the counterpoint does not present the number of notes
 *   per cantus-firmus note its species requires.
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
  | 'missingCadence';

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
   * the rule is skipped unless ranges are given.
   */
  ranges?: VoiceRange[];
  /**
   * Maximum spacing in semitones between adjacent upper voices. The bass-tenor
   * pair is exempt, as convention has it.
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

/** Whether a melodic interval descends by a diatonic step. */
function isDescendingStep(interval: SpelledInterval): boolean {
  return interval.number === 2 && (interval.semitones === -1 || interval.semitones === -2);
}

/** The qualities a leading-tone chord takes: the diminished triad and sevenths. */
const LEADING_TONE_QUALITIES: ReadonlySet<ChordQuality> = new Set(['dim', 'dim7', 'm7b5']);

/**
 * Whether the key's leading tone is functioning as one in a chord.
 *
 * The tendency is the dominant's, not the pitch class's: the leading tone must
 * rise where it is the third of a chord built on the dominant degree, or the
 * root of a leading-tone chord, which are the two places it carries dominant
 * function. The same pitch class is an ordinary chord tone elsewhere — the
 * fifth of iii, say — and is free to move as the line asks.
 */
function isFunctioningLeadingTone(chord: Chord, leadingTonePc: number, key: KeyScale): boolean {
  const role = chordToneRole(leadingTonePc, chord);
  if (role === 'third') {
    return pitchClassOf(chord.rootPc) === pitchClassOf(key.rootPc + 7);
  }
  if (role === 'root') {
    return LEADING_TONE_QUALITIES.has(chord.quality);
  }
  return false;
}

/** The chord's own seventh as a pitch class, or undefined when it has none. */
function seventhPcOf(chord: Chord): number | undefined {
  for (const interval of chord.intervals) {
    const pc = pitchClassOf(chord.rootPc + interval);
    if (chordToneRole(pc, chord) === 'seventh') {
      return pc;
    }
  }
  return undefined;
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

/** Two consecutive chords of the exercise, and the key they sound in. */
type Transition = {
  from: Moment;
  to: Moment;
  key: KeyScale;
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
        'The outer voices leap into a perfect interval by similar motion',
      ),
    );
  }
  return found;
}

/**
 * Cross relations: the same letter carrying different accidentals in two
 * different voices across the chord change. Within one voice the same motion is
 * an ordinary chromatic inflection, so a voice is never compared with itself.
 */
function crossRelationViolations(transition: Transition): PartWritingViolation[] {
  const found: PartWritingViolation[] = [];
  const { from, to } = transition;
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
      if (
        diatonicLetterOf(earlier.letter) !== diatonicLetterOf(later.letter) ||
        earlier.alter === later.alter
      ) {
        continue;
      }
      found.push(
        violation(
          'crossRelation',
          [first, second],
          from.index,
          to.index,
          `${formatNote(bare(earlier))} is contradicted by ${formatNote(bare(later))} in another voice`,
        ),
      );
    }
  }
  return found;
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
 * fifth. The rule is judged in every voice rather than the outer ones alone.
 */
function melodicViolations(transition: Transition): PartWritingViolation[] {
  const found: PartWritingViolation[] = [];
  const { from, to, key } = transition;
  const seventhPc = seventhPcOf(from.chord);
  const nextPcs = new Set(chordPitchClasses(to.chord));
  const leadingTonePc = pitchClassOf(key.rootPc - 1);
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
    if (
      earlierPc === leadingTonePc &&
      isFunctioningLeadingTone(from.chord, leadingTonePc, key) &&
      nextPcs.has(tonicPc) &&
      !nextPcs.has(earlierPc) &&
      !isLeadingToneResolution(earlierPitch, laterPitch, key)
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
 * chord tone takes the letter its interval above the root implies: the third of
 * a D major chord in C major spells F#, not Gb. The octave is kept, since the
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
  key: KeyScale,
): SpelledVoicing {
  const { tonic } = spelledKeyOf(key);
  return voicing.map((pitch) => spellPitch(pitch, tonic, key, { chordRoot: chord.rootPc }));
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
 * @param opts Ranges and the upper-voice spacing limit.
 * @returns Every violation found, in musical order; an empty array for a clean
 *   exercise.
 * @throws If the two arrays differ in length, or a note carries no octave.
 * @example
 * ```ts
 * import { checkPartWriting, majorKey, makeChord, spellVoicing } from '@libraz/libcantus';
 * const key = majorKey(0);
 * const chords = [makeChord(0, 'maj'), makeChord(2, 'min')];
 * const voicings = [[48, 55, 64, 72], [50, 57, 65, 69]].map((pitches, i) =>
 *   spellVoicing(pitches, chords[i] ?? chords[0], key),
 * );
 * checkPartWriting(voicings, chords, key);
 * // [{ kind: 'parallelFifth', voices: [0, 1], fromIndex: 0, toIndex: 1, rationale: '...' }]
 * ```
 * @category Voicing & Counterpoint
 */
export function checkPartWriting(
  voicings: readonly SpelledVoicing[],
  chords: readonly Chord[],
  key: KeyScale,
  opts?: PartWritingOptions,
): PartWritingViolation[] {
  if (voicings.length !== chords.length) {
    throw new InvalidInputError(
      `checkPartWriting needs one chord per voicing; received ${voicings.length} voicings and ${chords.length} chords`,
    );
  }
  const maxSpacing = opts?.maxSpacing ?? DEFAULT_MAX_SPACING;
  const voiceCount = voicings[0]?.length ?? 0;
  // Four voices are the SATB exercise these ranges were written for; any other
  // count has no conventional compass, so an unasked-for range check would
  // invent one.
  const ranges: readonly Readonly<VoiceRange>[] | undefined =
    opts?.ranges ?? (voiceCount === 4 ? SATB_RANGES : undefined);

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
      const transition: Transition = { from: previous, to: moment, key };
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
