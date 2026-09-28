/**
 * The one reading of whether a melody note fits a plan's harmony, shared by
 * the generator's local repair and by {@link evaluateComposition}, so the notes
 * generation repairs are exactly the notes evaluation would reject.
 *
 * A note on a main pulse fits when {@link analyzeVoice}, reading the plan's own
 * chords and keys, labels it a chord tone, suspension, appoggiatura or
 * anticipation; a note off the pulses always fits. The labels depend on the
 * neighbouring notes, so the reading is taken over a whole line.
 */

import { keyLookup } from '../../analyze/keys/index.js';
import type { ChordTimeline } from '../../analyze/timeline/index.js';
import { analyzeVoice } from '../../analyze/voice/index.js';
import { metricWeight } from '../../core/meter/index.js';
import { type ResolvedKey, scaleOf } from '../../theory/scale/index.js';
import { type CompositionPlan, planTimeline } from './types.js';

/** Labels {@link analyzeVoice} gives a note that counts as fitting the planned harmony. */
const HARMONY_OK_KINDS = new Set(['chordTone', 'suspension', 'appoggiatura', 'anticipation']);

/** A note as the harmony reading sees it. */
type LineNote = { pitch: number; startBeat: number; durationBeat: number };

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
 * A reader of which notes of a line do not fit the plan's harmony.
 *
 * @param plan The plan whose harmony judges the line.
 * @param timeline The plan's chord timeline, when the caller already holds it.
 * @returns A function taking a time-ordered line and answering, per note,
 *   null where the note fits, or the labels it was given where it does not.
 */
export function planHarmonyMisfits(
  plan: CompositionPlan,
  timeline: ChordTimeline = planTimeline(plan),
): (line: readonly LineNote[]) => (string[] | null)[] {
  const keyAt = planKeyAt(plan);
  const scaleAt = (beat: number) => scaleOf(keyAt(beat));
  return (line) => {
    const analyzed = analyzeVoice(line, timeline.at, scaleAt);
    return line.map((note, index) => {
      if (metricWeight(note.startBeat, plan.meters) <= 0) {
        return null;
      }
      const kinds = (analyzed[index]?.labels ?? []).map((label) => label.kind as string);
      return kinds.some((kind) => HARMONY_OK_KINDS.has(kind)) ? null : kinds;
    });
  };
}
