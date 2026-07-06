import type { Chord } from '../chord/index.js';
import { chordPitchClasses, chordToneRole } from '../chord/index.js';
import { createsVerticalDissonance, isLeadingToneResolution } from '../counterpoint/index.js';
import type { VoiceSnapshot } from '../safety/index.js';
import type { KeyScale } from '../types.js';

/** A theory annotation attached to a note. */
export type TheoryLabel =
  | { kind: 'chordTone'; role: 'root' | 'third' | 'fifth' | 'seventh' }
  | { kind: 'tension'; degree: 9 | 11 | 13 }
  | { kind: 'avoid' }
  | { kind: 'passing' }
  | { kind: 'neighbor' }
  | { kind: 'suspension'; type: 'sus4-3' | 'sus7-6' | 'sus9-8' | 'sus2-3'; resolveTo: number }
  | { kind: 'anticipation' }
  | { kind: 'escape' }
  | { kind: 'needsResolution'; resolveTo: number }
  | { kind: 'leadingTone'; resolveTo: number };

/** A note with its theory labels and a short rationale. */
export type AnalyzedNote = {
  noteId: number;
  labels: TheoryLabel[];
  rationale?: string;
};

/** A single note in a monophonic voice. */
export type VoiceNote = {
  id: number;
  pitch: number;
  startBeat: number;
  durationBeat: number;
};

function pitchClass(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

function intervalAboveRoot(pitch: number, chord: Chord): number {
  return (((pitchClass(pitch) - pitchClass(chord.rootPc)) % 12) + 12) % 12;
}

function isChordMember(pitch: number, chord: Chord | null): boolean {
  return chord ? chordPitchClasses(chord).includes(pitchClass(pitch)) : false;
}

function isStep(a: number, b: number): boolean {
  const d = Math.abs(a - b);
  return d === 1 || d === 2;
}

function suspensionType(ic: number, delta: number): TheoryLabel & { kind: 'suspension' } {
  let type: 'sus4-3' | 'sus7-6' | 'sus9-8' | 'sus2-3';
  if (delta > 0) {
    type = 'sus2-3';
  } else if (ic === 2) {
    type = 'sus9-8';
  } else if (ic === 10 || ic === 11) {
    type = 'sus7-6';
  } else {
    type = 'sus4-3';
  }
  return { kind: 'suspension', type, resolveTo: 0 };
}

function stepResolution(pitch: number, chord: Chord): number | undefined {
  for (let delta = 1; delta <= 2; delta += 1) {
    if (isChordMember(pitch - delta, chord)) {
      return pitch - delta;
    }
  }
  return undefined;
}

/**
 * Label every note of a voice with its theory roles.
 *
 * Each note is classified against the chord sounding at its beat. Chord tones
 * get a role label; non-chord tones are matched, in order, as suspensions
 * (prepared by an identical consonant pitch and resolving by step), passing
 * tones, neighbors, anticipations, and escape tones, then fall back to tension,
 * avoid, or an unresolved-dissonance label. Leading-tone resolutions are noted
 * additionally.
 *
 * @param voice The monophonic voice, in time order.
 * @param chordAtBeat Chord sounding at a given beat, or null.
 * @param key Key context for leading-tone detection.
 * @param otherVoicesAtBeat Other sounding voices at a given beat.
 * @returns One annotation per input note.
 */
export function analyzeVoice(
  voice: VoiceNote[],
  chordAtBeat: (beat: number) => Chord | null,
  key: KeyScale,
  otherVoicesAtBeat: (beat: number) => VoiceSnapshot[],
): AnalyzedNote[] {
  const result: AnalyzedNote[] = [];

  for (let i = 0; i < voice.length; i += 1) {
    const note = voice[i];
    if (!note) {
      continue;
    }
    const prev = i > 0 ? voice[i - 1] : undefined;
    const next = i + 1 < voice.length ? voice[i + 1] : undefined;
    const chord = chordAtBeat(note.startBeat);
    const labels: TheoryLabel[] = [];
    const member = isChordMember(note.pitch, chord);
    let handled = false;

    const verticallyDissonant =
      !member ||
      otherVoicesAtBeat(note.startBeat).some((ov) =>
        createsVerticalDissonance(note.pitch, ov.pitch, true),
      );

    if (chord && member) {
      const role = chordToneRole(note.pitch, chord);
      if (role) {
        labels.push({ kind: 'chordTone', role });
      } else {
        const ic = intervalAboveRoot(note.pitch, chord);
        labels.push({ kind: 'tension', degree: ic === 2 ? 9 : ic === 5 ? 11 : 13 });
      }
      handled = true;
    }

    if (!handled && chord && prev && next) {
      const prevChord = chordAtBeat(prev.startBeat);
      const prepared = prev.pitch === note.pitch && isChordMember(prev.pitch, prevChord);
      const resolves = isStep(next.pitch, note.pitch);
      if (prepared && verticallyDissonant && resolves) {
        const ic = intervalAboveRoot(note.pitch, chord);
        const sus = suspensionType(ic, next.pitch - note.pitch);
        sus.resolveTo = next.pitch;
        labels.push(sus);
        handled = true;
      }
    }

    if (!handled && chord && prev && next) {
      const prevMember = isChordMember(prev.pitch, chordAtBeat(prev.startBeat));
      const nextMember = isChordMember(next.pitch, chordAtBeat(next.startBeat));
      const up = note.pitch - prev.pitch > 0;
      const contInto = next.pitch - note.pitch > 0;
      const sameDir = note.pitch !== prev.pitch && next.pitch !== note.pitch && up === contInto;
      if (
        prevMember &&
        nextMember &&
        !member &&
        isStep(note.pitch, prev.pitch) &&
        isStep(next.pitch, note.pitch) &&
        sameDir
      ) {
        labels.push({ kind: 'passing' });
        handled = true;
      }
    }

    if (
      !handled &&
      prev &&
      next &&
      !member &&
      prev.pitch === next.pitch &&
      isStep(note.pitch, prev.pitch)
    ) {
      labels.push({ kind: 'neighbor' });
      handled = true;
    }

    if (!handled && chord && next && !member && note.pitch === next.pitch) {
      const nextChord = chordAtBeat(next.startBeat);
      if (isChordMember(next.pitch, nextChord)) {
        labels.push({ kind: 'anticipation' });
        handled = true;
      }
    }

    if (!handled && chord && prev && next && !member) {
      const prevMember = isChordMember(prev.pitch, chordAtBeat(prev.startBeat));
      const nextMember = isChordMember(next.pitch, chordAtBeat(next.startBeat));
      const stepFromPrev = isStep(note.pitch, prev.pitch);
      const leapToNext = Math.abs(next.pitch - note.pitch) >= 3;
      const opposite = note.pitch - prev.pitch > 0 !== next.pitch - note.pitch > 0;
      if (prevMember && nextMember && stepFromPrev && leapToNext && opposite) {
        labels.push({ kind: 'escape' });
        handled = true;
      }
    }

    if (!handled && chord && !member) {
      const ic = intervalAboveRoot(note.pitch, chord);
      const isTension = ic === 2 || ic === 5 || ic === 9;
      const avoid =
        (ic === 5 && chord.intervals.includes(4) && !chord.intervals.includes(5)) ||
        (ic === 11 && chord.intervals.includes(4) && chord.intervals.includes(10));
      if (avoid) {
        labels.push({ kind: 'avoid' });
        const resolveTo = stepResolution(note.pitch, chord);
        if (resolveTo !== undefined) {
          labels.push({ kind: 'needsResolution', resolveTo });
        }
      } else if (isTension) {
        labels.push({ kind: 'tension', degree: ic === 2 ? 9 : ic === 5 ? 11 : 13 });
      } else {
        const resolveTo = stepResolution(note.pitch, chord);
        if (resolveTo !== undefined) {
          labels.push({ kind: 'needsResolution', resolveTo });
        }
      }
    }

    if (next && isLeadingToneResolution(note.pitch, next.pitch, key)) {
      labels.push({ kind: 'leadingTone', resolveTo: next.pitch });
    }

    result.push({ noteId: note.id, labels, rationale: describe(labels) });
  }

  return result;
}

/** Build a short rationale from a note's primary label. */
function describe(labels: TheoryLabel[]): string {
  const primary = labels[0];
  if (!primary) {
    return 'Unclassified note';
  }
  switch (primary.kind) {
    case 'chordTone':
      return `Chord ${primary.role}`;
    case 'tension':
      return `${primary.degree}th tension`;
    case 'avoid':
      return 'Avoid note';
    case 'passing':
      return 'Passing tone between chord tones';
    case 'neighbor':
      return 'Neighbor tone';
    case 'suspension':
      return `Suspension (${primary.type})`;
    case 'anticipation':
      return 'Anticipation of the next chord';
    case 'escape':
      return 'Escape tone';
    case 'needsResolution':
      return 'Unresolved dissonance';
    case 'leadingTone':
      return 'Leading tone resolving to the tonic';
  }
}
