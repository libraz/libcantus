import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import { assertNoteEvents } from '../../core/validation/index.js';
import type { Chord, ChordToneRole } from '../../theory/chord/index.js';
import { chordToneRole, intervalAboveRoot, isChordMember } from '../../theory/chord/index.js';
import {
  createsVerticalDissonance,
  isLeadingToneResolution,
} from '../../theory/counterpoint/index.js';
import type { VoiceSnapshot } from '../../theory/safety/index.js';
import type { KeyLike } from '../../theory/scale/index.js';
import { toKeyScale } from '../../theory/scale/index.js';
import { adjacent } from '../adjacency.js';

/**
 * A suspension figure, named by the interval above the bass and the interval it
 * resolves to.
 *
 * A figure is reported only when the suspended note forms the interval the
 * figure names. A dissonance that resolves by step from anywhere else — a
 * retardation rising a semitone from the seventh to the octave, say — is left
 * unfigured rather than named after an interval it does not form.
 *
 * @category Arrangement & Analysis
 */
export type SuspensionFigure = 'sus4-3' | 'sus6-5' | 'sus7-6' | 'sus9-8' | 'sus2-3';

/**
 * A theory annotation attached to a note.
 *
 * @category Arrangement & Analysis
 */
export type TheoryLabel =
  | { kind: 'chordTone'; role: ChordToneRole }
  | { kind: 'tension'; degree: 9 | 11 | 13 }
  | { kind: 'avoid' }
  | { kind: 'passing' }
  | { kind: 'neighbor' }
  | { kind: 'suspension'; type: SuspensionFigure; resolveTo: number }
  /**
   * A note leant on: reached by leap and given up by step the other way, with
   * `resolveTo` naming the pitch it gives way to. The word is the one
   * {@link MelodyToneRole} uses for the same figure, so a melody read through
   * this layer and through the harmonizer comes back under one vocabulary
   * rather than under two names for one note.
   */
  | { kind: 'appoggiatura'; resolveTo: number }
  | { kind: 'anticipation' }
  | { kind: 'escape' }
  | { kind: 'needsResolution'; resolveTo: number }
  | { kind: 'leadingTone'; resolveTo: number };

/**
 * A note with its theory labels and a short rationale.
 *
 * The labels describe the note against the chord sounding at its **onset**;
 * they are not re-derived for the later chords a long note sustains across.
 * `analyzeArrangement` does re-check every crossed chord change, and reports
 * what it finds as conflicts, so a note labelled a chord tone here can still
 * appear in `conflicts` at a later beat.
 *
 * The identity fields make an annotation mappable back to the caller's input:
 * `originalIndex` is the note's position in the array that was passed in, and
 * `trackIndex` is set by {@link analyzeArrangement}.
 *
 * @category Arrangement & Analysis
 */
export type AnalyzedNote = {
  noteId: number;
  /** The note's index in the caller's own array, when the caller supplied one. */
  originalIndex?: number;
  /** The note's track, set by `analyzeArrangement`. */
  trackIndex?: number;
  pitch: number;
  startBeat: number;
  durationBeat: number;
  labels: TheoryLabel[];
  rationale?: string;
};

/**
 * A single note in a monophonic voice: a {@link NoteEvent} with a stable id and,
 * optionally, its index in the caller's original array.
 *
 * @category Arrangement & Analysis
 */
export type VoiceNote = NoteEvent & { id?: number; originalIndex?: number };

/**
 * A voice note whose id has been assigned, as {@link toVoiceNotes} returns and
 * {@link analyzeArrangement} works in.
 *
 * @category Arrangement & Analysis
 */
export type IdentifiedVoiceNote = VoiceNote & { id: number };

/**
 * A key that applies to the whole voice, or the key in force at a given beat.
 *
 * The callback form is what a piece that modulates needs: it is asked for the
 * key at a specific beat, the same way a chord is asked for with `chordAtBeat`.
 *
 * @example
 * ```ts
 * import { majorKey } from '@libraz/libcantus';
 * const wholePiece = majorKey(0); // C major throughout
 * const modulating = (beat: number) => (beat < 8 ? majorKey(5) : majorKey(0));
 * ```
 * @category Arrangement & Analysis
 */
export type KeyContext = KeyLike | ((beat: number) => KeyScale);

/**
 * The scale in force at a beat, whichever form the context was given in.
 *
 * One key is read once, here, so an entry point may take a key in any form a
 * caller holds one without the reading being repeated per note. The per-beat
 * form is handed back as it stands: it is called once per note, and resolving
 * inside that loop would put a key parse under every note of the piece.
 */
export function keyScaleAt(key: KeyContext): (beat: number) => KeyScale {
  if (typeof key === 'function') {
    return key;
  }
  const scale = toKeyScale(key);
  return () => scale;
}

/**
 * Give plain note events the ids {@link analyzeVoice} reports back.
 *
 * The id is only an identity handle, so the array position serves; this exists
 * so the mapping is a named call rather than a `map` every caller writes.
 *
 * @param events The note events, in time order.
 * @returns The same notes as voice notes, each carrying its index as its id.
 * @category Arrangement & Analysis
 */
export function toVoiceNotes(events: readonly NoteEvent[]): IdentifiedVoiceNote[] {
  assertNoteEvents(events, 'voice notes', { allowNonPositiveDuration: true });
  return events.map((event, index) => ({ ...event, id: index, originalIndex: index }));
}

/**
 * Interval class of a pitch above the actual sounding bass.
 *
 * Suspension figures (4-3, 7-6, 9-8) are named for the interval above the bass,
 * not the chord root, so this prefers the lowest pitch among the other sounding
 * voices when one lies below the note. Without a lower sounding voice it falls
 * back to the chord's bass pitch class (or root in root position).
 */
function intervalAboveBass(pitch: number, others: VoiceSnapshot[], chord: Chord): number {
  let bass = Number.POSITIVE_INFINITY;
  for (const ov of others) {
    bass = Math.min(bass, ov.pitch);
  }
  if (Number.isFinite(bass) && bass < pitch) {
    return (((pitch - bass) % 12) + 12) % 12;
  }
  const ref = chord.bassPc ?? chord.rootPc;
  return (((pitchClass(pitch) - pitchClass(ref)) % 12) + 12) % 12;
}

/**
 * The extension each interval class above the root forms: a flat, natural or
 * raised ninth (1, 2 or 3) to 9, an eleventh (5 or 6) to 11, and a flat or
 * natural thirteenth (8 or 9) to 13.
 *
 * The interval classes left out are the ones a chord states as its own root,
 * third, fifth and seventh, which {@link chordToneRole} names instead.
 */
const TENSION_DEGREE_BY_INTERVAL: Readonly<Record<number, 9 | 11 | 13>> = {
  1: 9,
  2: 9,
  3: 9,
  5: 11,
  6: 11,
  8: 13,
  9: 13,
};

/**
 * The interval classes forming an extension every chord takes: the natural
 * ninth, eleventh and thirteenth.
 *
 * The rest of the table is the altered extensions, which are alterations of a
 * seventh chord's upper structure and are heard as such only where the chord
 * states a seventh.
 */
const NATURAL_TENSION_INTERVALS: ReadonlySet<number> = new Set([2, 5, 9]);

/**
 * The extension an interval class above the root names, or undefined when it
 * names none.
 *
 * Answering undefined rather than a default is what keeps a raised ninth — the
 * interval class three semitones above the root — from being reported as the
 * thirteenth that a catch-all would name it.
 */
function tensionDegree(ic: number): 9 | 11 | 13 | undefined {
  return TENSION_DEGREE_BY_INTERVAL[ic];
}

/**
 * A chord with the bass it is written over among its own tones.
 *
 * Only for reading a tone the template leaves out: a slash chord states a bass
 * its stack of thirds does not reach, and the sonority the two make together is
 * what a listener hears. Everything else reads the template, which is what the
 * chord is rather than what it happens to sound under.
 */
function asSounded(chord: Chord): Chord {
  if (chord.bassPc === undefined) {
    return chord;
  }
  return { ...chord, intervals: [...chord.intervals, intervalAboveRoot(chord.bassPc, chord)] };
}

function isStep(a: number, b: number): boolean {
  const d = Math.abs(a - b);
  return d === 1 || d === 2;
}

/** Narrowest interval heard as a leap: anything wider than a step. */
const LEAP_SEMITONES = 3;

/**
 * Classify a suspension figure from the interval class above the sounding bass
 * (`ic`) and the resolution direction (`delta`, positive when resolving upward).
 */
function suspensionType(ic: number, delta: number): SuspensionFigure | null {
  if (delta > 0) {
    // Resolving upward is the 2-3 only from a second above the bass. A seventh
    // above it rising to the octave is a retardation, and the figure 2-3 would
    // name it after an interval it does not form.
    return ic === 1 || ic === 2 ? 'sus2-3' : null;
  }
  if (ic === 2) {
    return 'sus9-8';
  }
  if (ic === 10 || ic === 11) {
    return 'sus7-6';
  }
  if (ic === 5 || ic === 6) {
    return 'sus4-3';
  }
  if (ic === 8 || ic === 9) {
    return 'sus6-5';
  }
  // Any other interval above the bass is a downward-resolving dissonance with
  // no standard figure; a catch-all `sus4-3` would name it after an interval it
  // does not form.
  return null;
}

/** Widest interval, in semitones, a resolution by step may cover. */
const STEP_RESOLUTION = 2;

/**
 * How far the fallback search for a resolution target reaches, in semitones.
 * A chord sounds its root, so a member is always found inside an octave.
 */
const NEAREST_CHORD_TONE_REACH = 12;

/**
 * The nearest chord member to a pitch, searched outward from it and downward
 * first at equal distance, within `maxDistance` semitones.
 *
 * A dissonance resolves by step wherever a chord tone lies a step away, which
 * is what a `maxDistance` of {@link STEP_RESOLUTION} asks for. The wider search
 * names the closest chord tone there is, so a dissonance with no stepwise exit
 * — a minor third or a major seventh over a bare triad — still reports where it
 * wants to go instead of going unlabelled.
 */
function nearestChordTone(pitch: number, chord: Chord, maxDistance: number): number | undefined {
  for (let delta = 1; delta <= maxDistance; delta += 1) {
    if (isChordMember(pitch - delta, chord)) {
      return pitch - delta;
    }
    if (isChordMember(pitch + delta, chord)) {
      return pitch + delta;
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
 * tones, neighbors, anticipations, appoggiaturas (approached by leap and
 * resolving by step the other way), and escape tones, then fall back to
 * tension, avoid, or an unresolved-dissonance label. The figures are named as
 * {@link classifyMelodyTones} names them, so a caller reading a melody through
 * both layers gets one vocabulary. The two answer different questions and
 * neither refines the other: that classifier weighs the metre, which this one is
 * not given, so it can call ornamental a note this one reads as a chord tone,
 * and the reverse. Leading-tone resolutions are noted
 * additionally, judged against the key in force at the beat the resolution
 * lands on, so a modulation is heard from its new tonic.
 *
 * The voice is expected to be monophonic (one note at a time). Notes sharing an
 * onset are treated as simultaneous cluster members, not melodic neighbors, so
 * they receive no melodic labels (suspension, passing, neighbor, anticipation,
 * escape) — only harmonic ones. Callers with truly polyphonic material should
 * split it into monophonic sub-voices first, as `analyzeArrangement` does.
 *
 * @param voice The monophonic voice, in time order. A note without an `id` is
 *   identified by its position, so plain note events can be passed straight in.
 * @param chordAtBeat Chord sounding at a given beat, or null.
 * @param key Key context for leading-tone detection: a single {@link KeyScale}
 *   covering the whole voice, or a callback giving the key in force at a given
 *   beat, for music that modulates.
 * @param otherVoicesAtBeat Other sounding voices at a given beat; defaults to
 *   none, which is the whole story for a solo line.
 * @returns One annotation per input note.
 * @example
 * ```ts
 * import { analyzeVoice, makeChord, majorKey } from '@libraz/libcantus';
 * const voice = [
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 62, startBeat: 1, durationBeat: 1 },
 *   { pitch: 64, startBeat: 2, durationBeat: 1 },
 * ];
 * const cMajor = makeChord(0, 'maj');
 * const labels = analyzeVoice(voice, () => cMajor, majorKey(0));
 * labels; // one AnalyzedNote per input note, in the same order
 * // A voice that modulates to C major at beat 2:
 * analyzeVoice(voice, () => cMajor, (beat) => (beat < 2 ? majorKey(5) : majorKey(0)));
 * ```
 * @category Arrangement & Analysis
 */
export function analyzeVoice(
  voice: readonly VoiceNote[],
  chordAtBeat: (beat: number) => Chord | null,
  key: KeyContext,
  otherVoicesAtBeat: (beat: number) => VoiceSnapshot[] = () => [],
): AnalyzedNote[] {
  assertNoteEvents(voice, 'voice notes', { allowNonPositiveDuration: true });
  const keyAt = keyScaleAt(key);
  const result: AnalyzedNote[] = [];

  for (let i = 0; i < voice.length; i += 1) {
    const note = voice[i];
    if (!note) {
      continue;
    }
    const prevNote = i > 0 ? voice[i - 1] : undefined;
    const nextNote = i + 1 < voice.length ? voice[i + 1] : undefined;
    // A neighboring note sharing this note's onset is a simultaneous cluster
    // member, not a melodic predecessor/successor; treating it as one would
    // fabricate passing/suspension figures, so it is dropped here.
    const prevEnd =
      prevNote === undefined
        ? Number.NEGATIVE_INFINITY
        : prevNote.startBeat + prevNote.durationBeat;
    const noteEnd = note.startBeat + note.durationBeat;
    const prev = prevNote !== undefined && adjacent(prevEnd, note.startBeat) ? prevNote : undefined;
    const next =
      nextNote !== undefined && adjacent(noteEnd, nextNote.startBeat) ? nextNote : undefined;
    const chord = chordAtBeat(note.startBeat);
    const labels: TheoryLabel[] = [];
    const member = isChordMember(note.pitch, chord);
    let handled = false;

    if (chord && member) {
      const role = chordToneRole(note.pitch, chord);
      const degree =
        role === null ? tensionDegree(intervalAboveRoot(note.pitch, chord)) : undefined;
      if (role) {
        labels.push({ kind: 'chordTone', role });
        handled = true;
      } else if (degree !== undefined) {
        labels.push({ kind: 'tension', degree });
        handled = true;
      } else {
        // A slash bass the chord's own template does not contain falls between
        // two readings: the membership test counts the bass, the role test
        // reads the template, and every branch below is closed by `!member`.
        // It is the one tone a chord names without stacking it, so it is read
        // against the chord as it sounds — the B flat under a C triad is the
        // seventh that sonority has, and carries that tone's obligation.
        const bassRole = chordToneRole(note.pitch, asSounded(chord));
        if (bassRole !== null) {
          labels.push({ kind: 'chordTone', role: bassRole });
          handled = true;
        }
      }
    }

    if (!handled && chord && prev && next) {
      const prevChord = chordAtBeat(prev.startBeat);
      const prepared = prev.pitch === note.pitch && isChordMember(prev.pitch, prevChord);
      const resolves = isStep(next.pitch, note.pitch);
      const others = otherVoicesAtBeat(note.startBeat);
      const verticallyDissonant = others.some((ov) =>
        createsVerticalDissonance(note.pitch, ov.pitch, true),
      );
      if (prepared && verticallyDissonant && resolves) {
        const ic = intervalAboveBass(note.pitch, others, chord);
        const type = suspensionType(ic, next.pitch - note.pitch);
        if (type !== null) {
          labels.push({ kind: 'suspension', type, resolveTo: next.pitch });
          handled = true;
        }
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
      chord &&
      prev &&
      next &&
      !member &&
      prev.pitch === next.pitch &&
      isChordMember(prev.pitch, chordAtBeat(prev.startBeat)) &&
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

    // The appoggiatura and the escape tone are each other's mirror: one leans in
    // by leap and gives way by step, the other steps out of the harmony and
    // leaves by leap. Both turn back on themselves, which is what separates them
    // from a passing tone travelling the same way throughout.
    if (!handled && chord && prev && next && !member) {
      const prevMember = isChordMember(prev.pitch, chordAtBeat(prev.startBeat));
      const nextMember = isChordMember(next.pitch, chordAtBeat(next.startBeat));
      const leapFromPrev = Math.abs(note.pitch - prev.pitch) >= LEAP_SEMITONES;
      const stepToNext = isStep(next.pitch, note.pitch);
      const opposite = note.pitch - prev.pitch > 0 !== next.pitch - note.pitch > 0;
      if (prevMember && nextMember && leapFromPrev && stepToNext && opposite) {
        labels.push({ kind: 'appoggiatura', resolveTo: next.pitch });
        handled = true;
      }
    }

    if (!handled && chord && prev && next && !member) {
      const prevMember = isChordMember(prev.pitch, chordAtBeat(prev.startBeat));
      const nextMember = isChordMember(next.pitch, chordAtBeat(next.startBeat));
      const stepFromPrev = isStep(note.pitch, prev.pitch);
      const leapToNext = Math.abs(next.pitch - note.pitch) >= LEAP_SEMITONES;
      const opposite = note.pitch - prev.pitch > 0 !== next.pitch - note.pitch > 0;
      if (prevMember && nextMember && stepFromPrev && leapToNext && opposite) {
        labels.push({ kind: 'escape' });
        handled = true;
      }
    }

    if (!handled && chord && !member) {
      const ic = intervalAboveRoot(note.pitch, chord);
      // Which extension a note forms is a matter of its interval above the
      // root, so an altered ninth is heard as one whether or not the chord
      // symbol writes it: the same A flat must not read as a tension over G7b9
      // and as a dissonance needing resolution over G7. An alteration is an
      // alteration of a seventh chord's upper structure, though, so where the
      // chord states no seventh a chromatic note is the dissonance it sounds
      // like rather than a colour the harmony implies.
      const degree = tensionDegree(ic);
      const colours =
        NATURAL_TENSION_INTERVALS.has(ic) || chord.intervals.some((i) => i === 10 || i === 11);
      const avoid =
        (ic === 5 && chord.intervals.includes(4) && !chord.intervals.includes(5)) ||
        (ic === 11 && chord.intervals.includes(4) && chord.intervals.includes(10));
      if (avoid) {
        labels.push({ kind: 'avoid' });
        const resolveTo = nearestChordTone(note.pitch, chord, STEP_RESOLUTION);
        if (resolveTo !== undefined) {
          labels.push({ kind: 'needsResolution', resolveTo });
        }
      } else if (degree !== undefined && colours) {
        labels.push({ kind: 'tension', degree });
      } else {
        // Every note sounding against a chord is classified, so this branch
        // labels the dissonance whether or not it has a stepwise exit: an empty
        // label list would be indistinguishable from a consonance.
        const resolveTo = nearestChordTone(note.pitch, chord, NEAREST_CHORD_TONE_REACH);
        labels.push(
          resolveTo === undefined ? { kind: 'avoid' } : { kind: 'needsResolution', resolveTo },
        );
      }
    }

    // A leading tone is only one because of the tonic it arrives on, so the
    // key is read at the beat of that arrival rather than at this note's own
    // beat: a modulation places its key change on the new tonic, and the
    // leading tone that carries the voice into it still sits in the old key.
    if (next && isLeadingToneResolution(note.pitch, next.pitch, keyAt(next.startBeat))) {
      labels.push({ kind: 'leadingTone', resolveTo: next.pitch });
    }

    const analyzed: AnalyzedNote = {
      noteId: note.id ?? i,
      pitch: note.pitch,
      startBeat: note.startBeat,
      durationBeat: note.durationBeat,
      labels,
      rationale: describe(labels),
    };
    if (note.originalIndex !== undefined) {
      analyzed.originalIndex = note.originalIndex;
    }
    result.push(analyzed);
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
    case 'appoggiatura':
      return 'Appoggiatura leaning on the harmony, resolving by step';
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
