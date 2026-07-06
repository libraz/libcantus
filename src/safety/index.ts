import type { Chord } from '../chord/index.js';
import { chordPitchClasses } from '../chord/index.js';
import {
  createsHiddenParallelPerfect,
  createsParallelOctave,
  createsParallelPerfect,
  createsVerticalDissonance,
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
  beat: number;
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
    const d = Math.abs(pitch - q.prevPitch);
    if (d % 12 === 6) {
      reasons |= ReasonFlag.Tritone;
    }
    if (d >= 6) {
      reasons |= ReasonFlag.LargeLeap;
    }
    if (d === 1) {
      reasons |= ReasonFlag.MinorSecond;
    }
    if (d === 11) {
      reasons |= ReasonFlag.MajorSeventh;
    }
  }

  if (q.strongBeat) {
    const twoVoice = q.otherVoices.length === 1;
    for (const ov of q.otherVoices) {
      if (createsVerticalDissonance(pitch, ov.pitch, twoVoice)) {
        reasons |= ReasonFlag.VerticalDissonance;
        raise(NoteSafety.Dissonant);
        break;
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
  return result;
}

/** Build a short human explanation from the reason flags. */
function describe(reasons: number, q: SafetyQuery): string {
  if (reasons & ReasonFlag.OutOfRange) {
    return 'Outside the target vocal range';
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
  for (let pitch = pitchHigh; pitch >= pitchLow; pitch -= 1) {
    const result = evaluateSafety({ ...q, candidatePitch: pitch });
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
