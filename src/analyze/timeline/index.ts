import type { TimeSignature } from '../../core/meter/index.js';
import { beatsPerBar, metricWeight, parseTimeSignature } from '../../core/meter/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import type { Chord, ChordSpan } from '../../theory/chord/index.js';
import { chordPitchClasses, makeChord } from '../../theory/chord/index.js';
import { isScaleTone, majorKey } from '../../theory/scale/index.js';
import type { ChordMatch } from '../detect/index.js';
import { detectChord, detectChordBest, detectKey } from '../detect/index.js';
import type { Cadence } from '../functional/index.js';
import { detectCadence } from '../functional/index.js';

/**
 * A chord occupying a half-open beat span.
 *
 * @category Arrangement & Analysis
 */
export type ChordSegment = {
  startBeat: number;
  endBeat: number;
  chord: Chord;
};

/**
 * A beat-indexed sequence of chord segments.
 *
 * @category Arrangement & Analysis
 */
export type ChordTimeline = {
  /** The chord sounding at a beat, or null when no segment covers it. */
  at: (beat: number) => Chord | null;
  segments: ChordSegment[];
};

/**
 * Build a chord timeline from placed chords.
 *
 * Each chord spans from its `startBeat` to the next chord's `startBeat`; the last
 * chord runs to `totalBeats`. Segments with no positive length (from duplicate
 * onsets or a last chord at or past `totalBeats`) are dropped. `at(beat)` returns
 * the covering segment's chord, or null when the beat lies outside every segment.
 *
 * @param chords Placed chords in time order.
 * @param totalBeats End of the timeline in beats.
 * @returns A queryable chord timeline.
 * @category Arrangement & Analysis
 */
export function chordTimelineFromChords(chords: ChordSpan[], totalBeats: number): ChordTimeline {
  const sorted = [...chords].sort((a, b) => a.startBeat - b.startBeat);
  const segments: ChordSegment[] = sorted
    .map((gc, i) => {
      const next = sorted[i + 1];
      const endBeat = Math.max(gc.startBeat, next ? next.startBeat : totalBeats);
      return {
        startBeat: gc.startBeat,
        endBeat,
        chord: makeChord(gc.rootPc, gc.quality, gc.bassPc),
      };
    })
    .filter((seg) => seg.endBeat > seg.startBeat);

  return { at: segmentLookup(segments), segments };
}

/** Build the `at(beat)` lookup over a segment list. */
function segmentLookup(segments: ChordSegment[]): (beat: number) => Chord | null {
  return (beat) => {
    for (const seg of segments) {
      if (beat >= seg.startBeat && beat < seg.endBeat) {
        return seg.chord;
      }
    }
    return null;
  };
}

const EPS = 1e-9;

/** Fraction of the strongest pitch-class weight below which a pc is noise. */
const NOISE_THRESHOLD_RATIO = 0.2;

/** Maximum number of pitch classes fed to chord detection per window. */
const MAX_DETECTION_PCS = 6;

/** Number of top-weighted pitch classes tried in the detection fallback. */
const FALLBACK_PCS = 3;

/** Confidence multiplier applied when the chosen chord match is inexact. */
const INEXACT_CONFIDENCE_FACTOR = 0.85;

/** Score bonus for a match whose tones are all in the key. */
const DIATONIC_BONUS = 0.5;

/** Score bonus for an exact match (no extra and no missing tones). */
const EXACT_BONUS = 0.5;

/** Score penalty per extra or missing tone in a match. */
const MISMATCH_PENALTY = 0.3;

/** Reduce a value to a pitch class in [0, 11]. */
function pitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
}

/**
 * Options controlling {@link chordTimelineFromNotes}.
 *
 * @category Arrangement & Analysis
 */
export type ChordTimelineOptions = {
  /** Key context; inferred from the notes with {@link detectKey} when omitted. */
  key?: KeyScale;
  /**
   * Time signature used for metric accents; defaults to 4/4.
   *
   * @defaultValue `4/4`
   */
  ts?: TimeSignature;
  /**
   * Window length in beats per chord slot; defaults to one bar of `ts`.
   *
   * @defaultValue one bar of `ts`
   */
  harmonicRhythm?: number;
  /**
   * End of the analyzed span in beats; defaults to the end of the last note.
   *
   * @defaultValue the end of the last note
   */
  totalBeats?: number;
};

/**
 * The result of {@link chordTimelineFromNotes}.
 *
 * @category Arrangement & Analysis
 */
export type ChordTimelineResult = {
  /** The inferred timeline, with adjacent identical chords merged. */
  timeline: ChordTimeline;
  /** The key used for the analysis (given or inferred). */
  key: KeyScale;
  /** One confidence value in [0, 1] per segment, in segment order. */
  segmentConfidence: number[];
};

/** A window's inferred chord and its confidence, or null for an empty window. */
type WindowChord = {
  chord: Chord;
  confidence: number;
};

/**
 * Score a chord match against a window's pitch-class weights: a heavily
 * weighted root, in-key tones, and exactness all raise the score; extra or
 * missing tones lower it.
 */
function scoreMatch(
  match: ChordMatch,
  weights: number[],
  maxWeight: number,
  key: KeyScale,
): number {
  const rootWeight = maxWeight > 0 ? (weights[match.rootPc] ?? 0) / maxWeight : 0;
  const tones = chordPitchClasses(makeChord(match.rootPc, match.quality));
  let score = rootWeight;
  if (tones.every((pc) => isScaleTone(pc, key))) {
    score += DIATONIC_BONUS;
  }
  if (match.exact) {
    score += EXACT_BONUS;
  }
  score -= MISMATCH_PENALTY * (match.extraPcs.length + match.missingPcs.length);
  return score;
}

/** Confidence of a chord for a window: chord-tone weight over total weight. */
function chordConfidence(
  chord: Chord,
  weights: number[],
  totalWeight: number,
  exact: boolean,
): number {
  const tones = new Set(chordPitchClasses(chord));
  let chordWeight = 0;
  for (let pc = 0; pc < 12; pc += 1) {
    if (tones.has(pc)) {
      chordWeight += weights[pc] ?? 0;
    }
  }
  const raw = totalWeight > 0 ? chordWeight / totalWeight : 0;
  const confidence = Math.min(1, Math.max(0, raw));
  return exact ? confidence : confidence * INEXACT_CONFIDENCE_FACTOR;
}

/**
 * Infer the chord sounding in one window from the notes overlapping it.
 *
 * Builds a pitch-class weight histogram (overlap duration x velocity x
 * metric-accent bonus for onsets inside the window), keeps the significantly
 * weighted pitch classes, and picks the best {@link detectChord} match by
 * root weight, key membership, and exactness.
 */
function analyzeWindow(
  notes: NoteEvent[],
  windowStart: number,
  windowEnd: number,
  ts: TimeSignature,
  key: KeyScale,
): WindowChord | null {
  const weights = new Array<number>(12).fill(0);
  let lowestPitch = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    const noteEnd = note.startBeat + note.durationBeat;
    const overlap = Math.min(noteEnd, windowEnd) - Math.max(note.startBeat, windowStart);
    if (overlap <= EPS) {
      continue;
    }
    const velocityFactor = note.velocity !== undefined ? note.velocity / 127 : 1;
    const onsetInWindow = note.startBeat >= windowStart - EPS && note.startBeat < windowEnd - EPS;
    const accent = onsetInWindow ? 1 + metricWeight(note.startBeat, ts) / 3 : 1;
    const pc = pitchClass(note.pitch);
    weights[pc] = (weights[pc] ?? 0) + overlap * velocityFactor * accent;
    if (note.pitch < lowestPitch) {
      lowestPitch = note.pitch;
    }
  }
  let totalWeight = 0;
  let maxWeight = 0;
  for (const w of weights) {
    totalWeight += w;
    maxWeight = Math.max(maxWeight, w);
  }
  if (totalWeight <= EPS) {
    return null;
  }

  // Keep pitch classes with meaningful weight, strongest first.
  const ranked = weights
    .map((weight, pc) => ({ pc, weight }))
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight || a.pc - b.pc);
  const selected = ranked
    .filter(({ weight }) => weight >= maxWeight * NOISE_THRESHOLD_RATIO)
    .slice(0, MAX_DETECTION_PCS)
    .map(({ pc }) => pc);

  // Feed detection with the window's true bass as the lowest pitch so inversion
  // detection works; when the bass pc was filtered out as noise, anchor on the
  // heaviest pc instead so no spurious inversion is reported.
  const bassPc = pitchClass(lowestPitch);
  const anchorPc = selected.includes(bassPc) ? bassPc : (selected[0] ?? bassPc);
  const detectionPitches = selected.map((pc) => (pc === anchorPc ? pc : pc + 12));

  const matches = detectChord(detectionPitches);
  let bestMatch: ChordMatch | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const match of matches) {
    const score = scoreMatch(match, weights, maxWeight, key);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = match;
    }
  }
  if (bestMatch) {
    const chord = makeChord(bestMatch.rootPc, bestMatch.quality, bestMatch.bassPc);
    return { chord, confidence: chordConfidence(chord, weights, totalWeight, bestMatch.exact) };
  }

  // Fallback: retry on only the top-weighted pitch classes.
  const fallback = detectChordBest(selected.slice(0, FALLBACK_PCS));
  if (fallback) {
    return { chord: fallback, confidence: chordConfidence(fallback, weights, totalWeight, false) };
  }
  return null;
}

/** Whether two chords are the same root, quality, and bass. */
function sameChord(a: Chord, b: Chord): boolean {
  return a.rootPc === b.rootPc && a.quality === b.quality && a.bassPc === b.bassPc;
}

/**
 * Infer a chord timeline from raw multi-track notes.
 *
 * The span `[0, totalBeats)` is sliced into `harmonicRhythm`-beat windows; each
 * window's chord is inferred from a pitch-class weight histogram of the notes
 * overlapping it (weight = overlap duration x velocity x metric-accent bonus
 * for onsets in the window). Adjacent windows carrying the identical chord are
 * merged into one segment; windows with no notes produce no segment, so
 * `at(beat)` returns null there. Each segment carries a confidence in [0, 1]:
 * the fraction of the window weight explained by chord tones, reduced when the
 * match is inexact, and duration-weighted across merged windows.
 *
 * Notes with a zero or negative duration never sound, so they are dropped at
 * ingest: they contribute to neither the key inference, the span, nor any
 * window's histogram.
 *
 * @param notes The notes to analyze (any number of tracks, flattened).
 * @param opts Analysis options; see {@link ChordTimelineOptions}.
 * @returns The inferred timeline, the key used, and per-segment confidences.
 * @throws If `harmonicRhythm` is not positive.
 * @example
 * ```ts
 * import { chordTimelineFromNotes } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 60, startBeat: 0, durationBeat: 2 }, // C
 *   { pitch: 64, startBeat: 0, durationBeat: 2 }, // E
 *   { pitch: 67, startBeat: 0, durationBeat: 2 }, // G
 * ];
 * const { timeline, key } = chordTimelineFromNotes(notes);
 * timeline.at(0); // the chord inferred over beat 0, or null
 * ```
 * @category Arrangement & Analysis
 */
export function chordTimelineFromNotes(
  notes: NoteEvent[],
  opts: ChordTimelineOptions = {},
): ChordTimelineResult {
  const ts = opts.ts ?? parseTimeSignature('4/4');
  const harmonicRhythm = opts.harmonicRhythm ?? beatsPerBar(ts);
  if (!(harmonicRhythm > 0)) {
    throw new Error(`Invalid harmonic rhythm: ${harmonicRhythm}`);
  }
  // Zero/negative-length notes never sound; drop them before any inference.
  const sounding = notes.filter((note) => note.durationBeat > 0);
  const lastNoteEnd = sounding.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
  const totalBeats = opts.totalBeats ?? lastNoteEnd;
  const key = opts.key ?? detectKey(sounding.map((n) => n.pitch))[0]?.key ?? majorKey(0);

  const segments: ChordSegment[] = [];
  const segmentConfidence: number[] = [];
  const windowCount = Math.max(0, Math.ceil(totalBeats / harmonicRhythm - EPS));
  for (let i = 0; i < windowCount; i += 1) {
    const start = i * harmonicRhythm;
    const end = Math.min(start + harmonicRhythm, totalBeats);
    const inferred = analyzeWindow(sounding, start, end, ts, key);
    if (!inferred) {
      continue;
    }
    const last = segments[segments.length - 1];
    if (last && sameChord(last.chord, inferred.chord) && Math.abs(last.endBeat - start) < EPS) {
      // Merge into the previous segment, blending confidence by duration.
      const lastLength = last.endBeat - last.startBeat;
      const length = end - start;
      const lastConfidence = segmentConfidence[segmentConfidence.length - 1] ?? 0;
      segmentConfidence[segmentConfidence.length - 1] =
        (lastConfidence * lastLength + inferred.confidence * length) / (lastLength + length);
      last.endBeat = end;
    } else {
      segments.push({ startBeat: start, endBeat: end, chord: inferred.chord });
      segmentConfidence.push(inferred.confidence);
    }
  }

  return {
    timeline: { at: segmentLookup(segments), segments },
    key,
    segmentConfidence,
  };
}

/**
 * A cadence found between two consecutive timeline segments.
 *
 * @category Arrangement & Analysis
 */
export type CadenceHit = {
  /** The beat where the cadence arrives (the second chord's onset). */
  atBeat: number;
  type: Exclude<Cadence, null>;
  from: Chord;
  to: Chord;
};

/**
 * Find cadences between consecutive segments of a chord timeline.
 *
 * Each temporally adjacent segment pair is classified with
 * {@link detectCadence}; pairs forming no cadence are skipped. Segments
 * separated by a gap (a rest in the timeline) are not a chord-to-chord
 * progression, so they are never paired.
 *
 * @param timeline The chord timeline to scan.
 * @param key The prevailing key.
 * @returns The cadences found, in time order.
 * @example
 * ```ts
 * import { chordTimelineFromNotes, detectCadences } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 67, startBeat: 0, durationBeat: 4 }, // G, a dominant
 *   { pitch: 60, startBeat: 4, durationBeat: 4 }, // C, the tonic
 * ];
 * const { timeline, key } = chordTimelineFromNotes(notes);
 * const cadences = detectCadences(timeline, key);
 * ```
 * @category Arrangement & Analysis
 */
export function detectCadences(timeline: ChordTimeline, key: KeyScale): CadenceHit[] {
  const hits: CadenceHit[] = [];
  for (let i = 1; i < timeline.segments.length; i += 1) {
    const prev = timeline.segments[i - 1];
    const cur = timeline.segments[i];
    if (!prev || !cur) {
      continue;
    }
    if (Math.abs(cur.startBeat - prev.endBeat) > EPS) {
      continue; // A rest separates the chords; no cadential motion across it.
    }
    const type = detectCadence(prev.chord, cur.chord, key);
    if (type !== null) {
      hits.push({ atBeat: cur.startBeat, type, from: prev.chord, to: cur.chord });
    }
  }
  return hits;
}
