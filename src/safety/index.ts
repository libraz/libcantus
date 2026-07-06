import type { Chord } from '../chord/index.js';
import { chordPitchClasses } from '../chord/index.js';
import {
  createsHiddenParallelPerfect,
  createsParallelOctave,
  createsParallelPerfect,
  createsVerticalDissonance,
  isForbiddenMelodicLeap,
} from '../counterpoint/index.js';
import { isScaleTone } from '../scale/index.js';
import type { KeyScale } from '../types.js';

/** Severity policy: `strict` counterpoint vs. lenient `pop` voice-leading. */
export type SafetyProfile = 'strict' | 'pop';

/** Overall placeability verdict for a candidate pitch. */
export enum NoteSafety {
  Safe = 0,
  Warning = 1,
  Dissonant = 2,
}

/** Bit flags describing why a pitch received its verdict. */
export enum ReasonFlag {
  ChordTone = 1 << 0,
  Tension = 1 << 1,
  AvoidNote = 1 << 2,
  ScaleTone = 1 << 3,
  NonScale = 1 << 4,
  OutOfRange = 1 << 5,
  Tritone = 1 << 6,
  LargeLeap = 1 << 7,
  MinorSecond = 1 << 8,
  MajorSeventh = 1 << 9,
  VerticalDissonance = 1 << 10,
  ParallelPerfect = 1 << 11,
  HiddenParallel = 1 << 12,
  VoiceCrossing = 1 << 13,
  Suspension = 1 << 14,
  NeedsResolution = 1 << 15,
}

/** A neighbouring voice's current and previous pitch. */
export type VoiceSnapshot = {
  pitch: number;
  prevPitch?: number;
};

/** Everything needed to evaluate one candidate pitch. */
export type SafetyQuery = {
  profile: SafetyProfile;
  candidatePitch: number;
  prevPitch?: number;
  chord: Chord | null;
  key: KeyScale;
  otherVoices: VoiceSnapshot[];
  strongBeat: boolean;
  vocalLow?: number;
  vocalHigh?: number;
};

/** The verdict, reason flags, and optional resolution guidance. */
export type SafetyResult = {
  safety: NoteSafety;
  reasons: number;
  resolveTo?: number;
  suggestions?: number[];
  rationale?: string;
};

/** Semitone radius searched around a rejected candidate for safe alternatives. */
const SUGGESTION_WINDOW = 12;
/** Maximum number of alternative pitches returned in `SafetyResult.suggestions`. */
const MAX_SUGGESTIONS = 3;

function pitchClass(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

function intervalAboveRoot(pitch: number, chord: Chord): number {
  return (((pitchClass(pitch) - pitchClass(chord.rootPc)) % 12) + 12) % 12;
}

function isChordMember(pitch: number, chord: Chord): boolean {
  return chordPitchClasses(chord).includes(pitchClass(pitch));
}

/** Whether the perfect fourth is an avoid note over this chord. */
function avoidsFourth(chord: Chord): boolean {
  return chord.intervals.includes(4) && !chord.intervals.includes(5);
}

/** Whether the major seventh is an avoid note over this chord (dominant). */
function avoidsMajorSeventh(chord: Chord): boolean {
  return chord.intervals.includes(4) && chord.intervals.includes(10);
}

/** Nearest chord tone at or below the candidate, within two semitones. */
function stepResolution(pitch: number, chord: Chord): number | undefined {
  for (let delta = 1; delta <= 2; delta += 1) {
    if (isChordMember(pitch - delta, chord)) {
      return pitch - delta;
    }
  }
  return undefined;
}

/**
 * Evaluate the safety of placing a candidate pitch in a voice.
 *
 * Reasons are merged from harmonic context (chord tone / tension / avoid / scale)
 * and counterpoint (vertical dissonance, parallels, voice crossing). The `strict`
 * profile treats avoid notes and parallels as dissonant; `pop` treats them as
 * warnings. The final verdict is the worst severity among the reasons.
 *
 * @param q The candidate and its harmonic/voice-leading context.
 * @returns The verdict, reason bitmask, and optional resolution guidance.
 */
export function evaluateSafety(q: SafetyQuery): SafetyResult {
  return evaluateInternal(q, true);
}

/**
 * Core safety evaluation.
 *
 * @param q The candidate and its harmonic/voice-leading context.
 * @param collectSuggestions Whether to search for safe alternatives on a
 *   non-Safe verdict. Set false during that search itself to bound recursion.
 * @returns The verdict, reason bitmask, and optional guidance.
 */
function evaluateInternal(q: SafetyQuery, collectSuggestions: boolean): SafetyResult {
  let reasons = 0;
  let level = NoteSafety.Safe;
  let resolveTo: number | undefined;
  const raise = (l: NoteSafety) => {
    if (l > level) {
      level = l;
    }
  };
  const avoidSeverity = q.profile === 'strict' ? NoteSafety.Dissonant : NoteSafety.Warning;
  const parallelSeverity = avoidSeverity;
  const pitch = q.candidatePitch;

  if (
    (q.vocalLow !== undefined && pitch < q.vocalLow) ||
    (q.vocalHigh !== undefined && pitch > q.vocalHigh)
  ) {
    reasons |= ReasonFlag.OutOfRange;
    raise(NoteSafety.Warning);
  }

  const inScale = isScaleTone(pitch, q.key);
  const chord = q.chord;

  if (chord && isChordMember(pitch, chord)) {
    reasons |= ReasonFlag.ChordTone;
  } else if (chord) {
    const ic = intervalAboveRoot(pitch, chord);
    const isTension = ic === 2 || ic === 5 || ic === 9;
    const avoid = (ic === 5 && avoidsFourth(chord)) || (ic === 11 && avoidsMajorSeventh(chord));
    if (avoid) {
      reasons |= ReasonFlag.AvoidNote;
      if (isTension) {
        reasons |= ReasonFlag.Tension;
      }
      reasons |= ReasonFlag.NeedsResolution;
      resolveTo = stepResolution(pitch, chord);
      raise(avoidSeverity);
    } else if (isTension && inScale) {
      reasons |= ReasonFlag.Tension;
      raise(NoteSafety.Warning);
    } else if (inScale) {
      reasons |= ReasonFlag.ScaleTone;
      raise(NoteSafety.Warning);
    } else {
      reasons |= ReasonFlag.NonScale;
      raise(NoteSafety.Dissonant);
    }
  } else if (inScale) {
    reasons |= ReasonFlag.ScaleTone;
    raise(NoteSafety.Warning);
  } else {
    reasons |= ReasonFlag.NonScale;
    raise(NoteSafety.Dissonant);
  }

  // Harmonic tritone against a chord tone (except in dominant chords, where the
  // tritone is a defining, stable colour).
  if (chord && !(chord.intervals.includes(4) && chord.intervals.includes(10))) {
    const ic = intervalAboveRoot(pitch, chord);
    const toneOffsets = chord.intervals.map((i) => ((i % 12) + 12) % 12);
    if (toneOffsets.some((t) => Math.abs(ic - t) === 6)) {
      reasons |= ReasonFlag.Tritone;
    }
  }

  if (q.prevPitch !== undefined) {
    // Quality flags reduce the melodic interval to its pitch-class interval so
    // compound intervals are treated uniformly with their simple form. The
    // forbidden-leap flag defers to the counterpoint rule, which preserves the
    // octave boundary (an octave leap is allowed, wider leaps are not).
    const pc = Math.abs(pitch - q.prevPitch) % 12;
    if (pc === 6) {
      reasons |= ReasonFlag.Tritone;
    }
    if (isForbiddenMelodicLeap(q.prevPitch, pitch)) {
      reasons |= ReasonFlag.LargeLeap;
    }
    if (pc === 1) {
      reasons |= ReasonFlag.MinorSecond;
    }
    if (pc === 11) {
      reasons |= ReasonFlag.MajorSeventh;
    }
  }

  if (q.strongBeat) {
    const twoVoice = q.otherVoices.length === 1;
    const prev = q.prevPitch;
    for (const ov of q.otherVoices) {
      if (!createsVerticalDissonance(pitch, ov.pitch, twoVoice)) {
        continue;
      }
      reasons |= ReasonFlag.VerticalDissonance;
      raise(NoteSafety.Dissonant);
      // A held pitch that was consonant on the previous step and is now
      // dissonant against the same voice is a prepared suspension.
      if (
        prev !== undefined &&
        pitch === prev &&
        ov.prevPitch !== undefined &&
        !createsVerticalDissonance(prev, ov.prevPitch, twoVoice)
      ) {
        reasons |= ReasonFlag.Suspension;
      }
    }
  }

  if (q.prevPitch !== undefined) {
    const prev = q.prevPitch;
    for (const ov of q.otherVoices) {
      if (ov.prevPitch === undefined) {
        continue;
      }
      if (
        createsParallelPerfect(prev, pitch, ov.prevPitch, ov.pitch) ||
        createsParallelOctave(prev, pitch, ov.prevPitch, ov.pitch)
      ) {
        reasons |= ReasonFlag.ParallelPerfect;
        raise(parallelSeverity);
      }
      if (createsHiddenParallelPerfect(prev, pitch, ov.prevPitch, ov.pitch)) {
        reasons |= ReasonFlag.HiddenParallel;
        raise(parallelSeverity);
      }
      const crossedNow = pitch - ov.pitch;
      const crossedPrev = prev - ov.prevPitch;
      if (crossedNow !== 0 && crossedPrev !== 0 && crossedNow > 0 !== crossedPrev > 0) {
        reasons |= ReasonFlag.VoiceCrossing;
        raise(parallelSeverity);
      }
    }
  }

  const result: SafetyResult = { safety: level, reasons, rationale: describe(reasons, q) };
  if (resolveTo !== undefined) {
    result.resolveTo = resolveTo;
  }
  if (collectSuggestions && level !== NoteSafety.Safe) {
    const suggestions = findSafeNearby(q, pitch);
    if (suggestions.length > 0) {
      result.suggestions = suggestions;
    }
  }
  return result;
}

/**
 * Find safe alternative pitches near a rejected candidate.
 *
 * Searches outward from the candidate within `SUGGESTION_WINDOW` semitones,
 * probing the pitch below before the one above at each distance so the result
 * is deterministic and ordered by nearness.
 *
 * @param q The safety context of the rejected candidate.
 * @param candidate The candidate pitch that was not Safe.
 * @returns Up to `MAX_SUGGESTIONS` safe pitches, nearest first.
 */
function findSafeNearby(q: SafetyQuery, candidate: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= SUGGESTION_WINDOW; d += 1) {
    for (const p of [candidate - d, candidate + d]) {
      if (evaluateInternal({ ...q, candidatePitch: p }, false).safety === NoteSafety.Safe) {
        out.push(p);
        if (out.length >= MAX_SUGGESTIONS) {
          return out;
        }
      }
    }
  }
  return out;
}

/** Build a short human explanation from the reason flags. */
function describe(reasons: number, q: SafetyQuery): string {
  if (reasons & ReasonFlag.OutOfRange) {
    return 'Outside the target vocal range';
  }
  if (reasons & ReasonFlag.Suspension) {
    return 'Prepared suspension — a held consonance now dissonant, awaiting resolution';
  }
  if (reasons & ReasonFlag.VerticalDissonance) {
    return 'Dissonant against a sounding voice on a strong beat';
  }
  if (reasons & ReasonFlag.AvoidNote) {
    return 'Avoid note — clashes with a chord tone a semitone away';
  }
  if (reasons & ReasonFlag.ParallelPerfect) {
    return 'Parallel perfect interval with another voice';
  }
  if (reasons & ReasonFlag.HiddenParallel) {
    return 'Hidden perfect interval by similar motion';
  }
  if (reasons & ReasonFlag.VoiceCrossing) {
    return 'Crosses another voice';
  }
  if (reasons & ReasonFlag.ChordTone) {
    return 'Chord tone';
  }
  if (reasons & ReasonFlag.Tension) {
    return 'Chord tension';
  }
  if (reasons & ReasonFlag.NonScale) {
    return 'Outside the key';
  }
  if (reasons & ReasonFlag.ScaleTone) {
    return 'Scale tone, not in the chord';
  }
  return q.chord ? 'Placeable' : 'No chord context';
}

/**
 * Enumerate placeable pitches in a range, chord tones first, descending.
 *
 * @param q The safety context minus the candidate pitch.
 * @param pitchLow Lowest MIDI pitch to consider (inclusive).
 * @param pitchHigh Highest MIDI pitch to consider (inclusive).
 * @returns Placeable pitches (non-dissonant), chord tones before others, each group descending.
 */
export function enumerateSafePitches(
  q: Omit<SafetyQuery, 'candidatePitch'>,
  pitchLow: number,
  pitchHigh: number,
): number[] {
  const chordTones: number[] = [];
  const others: number[] = [];
  if (!Number.isFinite(pitchLow) || !Number.isFinite(pitchHigh)) {
    return [];
  }
  for (let pitch = pitchHigh; pitch >= pitchLow; pitch -= 1) {
    const result = evaluateInternal({ ...q, candidatePitch: pitch }, false);
    if (result.safety === NoteSafety.Dissonant) {
      continue;
    }
    if (result.reasons & ReasonFlag.ChordTone) {
      chordTones.push(pitch);
    } else {
      others.push(pitch);
    }
  }
  return [...chordTones, ...others];
}
