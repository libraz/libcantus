/**
 * The one reading of how a melody note stands against a plan's harmony, shared
 * by the melody generator and by {@link evaluateComposition}, so the pitches
 * generation offers at a position are exactly the ones evaluation accepts there.
 *
 * A position is strong (the downbeat or a bar's secondary accent), weak (any
 * other main pulse) or off the pulses. A strong note fits when
 * {@link analyzeVoice}, reading the plan's own chords and keys, gives it a
 * chord-tone or ornamental label; a weak note fits on such a label or by being
 * a scale tone; a note off the pulses always fits. The labels depend on the
 * neighbouring notes, so the reading is taken over a whole phrase line.
 */

import type { CadenceType } from '../../analyze/functional/cadence.js';
import { keyLookup } from '../../analyze/keys/index.js';
import type { ChordTimeline } from '../../analyze/timeline/index.js';
import { analyzeVoice } from '../../analyze/voice/index.js';
import { type MeterMap, metricWeight } from '../../core/meter/index.js';
import { chordPitchClasses } from '../../theory/chord/index.js';
import {
  isScaleTone,
  type ResolvedKey,
  scaleOf,
  scaleTonesInDegreeOrder,
} from '../../theory/scale/index.js';
import { planChordTimeline } from './timeline.js';
import type { CompositionPlan } from './types.js';

/** Labels {@link analyzeVoice} gives a pulse note that count as fitting the planned harmony. */
const HARMONY_OK_KINDS = new Set([
  'chordTone',
  'tension',
  'suspension',
  'appoggiatura',
  'anticipation',
  'passing',
  'neighbor',
]);

/** Metric weight from which a pulse counts as strong. */
const STRONG_WEIGHT = 2;

/** Scale degrees a phrase's closing note may take, by cadence type. */
const CADENCE_DEGREES = {
  authentic: [1, 3],
  plagal: [1, 3],
  half: [2, 5, 7],
  phrygian: [2, 5, 7],
  modal: [1],
} as const;

/** A note as the harmony reading sees it. */
type LineNote = { pitch: number; startBeat: number; durationBeat: number };

/** How a position stands in the bar: a strong pulse, a weak pulse, or off the pulses. */
export type PositionClass = 'strong' | 'weak' | 'off';

/**
 * The class of a position under a meter map.
 *
 * @param beat The position, in quarter-note beats.
 * @param meters The meter map.
 * @returns `'strong'` from metric weight 2, `'weak'` at weight 1, `'off'` at 0.
 */
export function positionClass(beat: number, meters: MeterMap): PositionClass {
  const weight = metricWeight(beat, meters);
  return weight >= STRONG_WEIGHT ? 'strong' : weight > 0 ? 'weak' : 'off';
}

/**
 * The key in force at a beat, read from the plan's own harmony rather than a
 * single home key.
 *
 * @param plan The plan whose chords name their keys.
 * @returns A lookup from beat to key; the home key where no chord sounds.
 */
export function planKeyAt(plan: CompositionPlan): (beat: number) => ResolvedKey {
  const regions = [...plan.harmony]
    .sort((a, b) => a.startBeat - b.startBeat)
    .map((chord) => ({
      startBeat: chord.startBeat,
      endBeat: chord.endBeat,
      key: plan.keys[chord.key] as ResolvedKey,
      confidence: 1,
    }));
  return keyLookup(regions, plan.keys[0] as ResolvedKey);
}

/**
 * The pitch classes a phrase may close on under a cadence: the cadence's scale
 * degrees in the key of the chord sounding at the closing beat, or for a
 * deceptive cadence the tones of that chord.
 *
 * @param plan The plan whose harmony names the chord and its key.
 * @param timeline The plan's chord timeline.
 * @param cadence The cadence the phrase closes on.
 * @param beat Where the closing note sounds.
 * @returns The allowed pitch classes, or null when a deceptive cadence has no
 *   chord to read.
 */
export function cadencePitchClasses(
  plan: CompositionPlan,
  timeline: ChordTimeline,
  cadence: CadenceType,
  beat: number,
): number[] | null {
  if (cadence === 'deceptive') {
    const chord = timeline.at(beat);
    return chord === null ? null : chordPitchClasses(chord);
  }
  const entry = plan.harmony.find((chord) => beat >= chord.startBeat && beat < chord.endBeat);
  const tones = scaleTonesInDegreeOrder(scaleOf(plan.keys[entry?.key ?? 0] as ResolvedKey));
  return CADENCE_DEGREES[cadence]
    .map((degree) => tones[degree - 1])
    .filter((pc): pc is number => pc !== undefined);
}

/**
 * A reader of which notes of a phrase line do not fit the plan's harmony.
 *
 * @param plan The plan whose harmony judges the line.
 * @param timeline The plan's chord timeline, when the caller already holds it.
 * @returns A function taking one phrase's time-ordered line and answering, per
 *   note, null where the note fits, or the labels it was given where it does not.
 */
export function planHarmonyMisfits(
  plan: CompositionPlan,
  timeline: ChordTimeline = planChordTimeline(plan),
): (line: readonly LineNote[]) => (string[] | null)[] {
  const keyAt = planKeyAt(plan);
  const scaleAt = (beat: number) => scaleOf(keyAt(beat));
  return (line) => {
    const analyzed = analyzeVoice(line, timeline.at, scaleAt);
    return line.map((note, index) => {
      const position = positionClass(note.startBeat, plan.meters);
      if (position === 'off') {
        return null;
      }
      const kinds = (analyzed[index]?.labels ?? []).map((label) => label.kind as string);
      if (kinds.some((kind) => HARMONY_OK_KINDS.has(kind))) {
        return null;
      }
      return position === 'weak' && isScaleTone(note.pitch, scaleAt(note.startBeat)) ? null : kinds;
    });
  };
}
