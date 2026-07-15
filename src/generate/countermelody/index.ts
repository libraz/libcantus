import type { NoteEventIndex } from '../../core/event-index/index.js';
import { createNoteEventIndex } from '../../core/event-index/index.js';
import type { TimeSignature } from '../../core/meter/index.js';
import { isStrongBeat } from '../../core/meter/index.js';
import type { Rng } from '../../core/random/index.js';
import { createRng } from '../../core/random/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertInteger,
  assertRange,
  assertTimeSignature,
} from '../../core/validation/index.js';
import type { Chord } from '../../theory/chord/index.js';
import { chordToneRole } from '../../theory/chord/index.js';
import { createsParallelPerfect, isForbiddenMelodicLeap } from '../../theory/counterpoint/index.js';
import type { VoiceSnapshot } from '../../theory/safety/index.js';
import { enumerateSafePitches, evaluateSafety, NoteSafety } from '../../theory/safety/index.js';

/**
 * Options controlling {@link generateCounterMelody}.
 *
 * @category Voicing & Counterpoint
 */
export type CounterMelodyOptions = {
  /** The lead line to write against, in ascending onset order. */
  melody: NoteEvent[];
  /** Chord sounding at an absolute beat position, or null when none applies. */
  chordAt: (beat: number) => Chord | null;
  /**
   * Exact chord-change beats exposed by the caller's timeline. The generator
   * also probes its half-beat grid, but callback discontinuities between grid
   * points are not introspectable and should be listed here.
   */
  chordChangeBeats?: number[];
  /** Key/scale context for scale-tone decisions. */
  key: KeyScale;
  /**
   * Meter used for strong-beat decisions.
   *
   * @defaultValue 4/4
   */
  ts?: TimeSignature;
  /**
   * Which side of the melody the counter line occupies.
   *
   * @defaultValue 'below'
   */
  register?: 'above' | 'below';
  /**
   * Onset strategy: `'complement'` moves where the melody holds or rests and
   * reinforces some strong beats; `'follow'` mirrors melody onsets.
   *
   * @defaultValue 'complement'
   */
  rhythm?: 'complement' | 'follow';
  /**
   * Safety profile applied to candidate pitches.
   *
   * @defaultValue 'pop'
   */
  profile?: 'strict' | 'pop';
  /** Lowest MIDI pitch the counter line may use (default derived from `register`). */
  pitchLow?: number;
  /** Highest MIDI pitch the counter line may use (default derived from `register`). */
  pitchHigh?: number;
  /**
   * PRNG seed; the same seed always yields the same line.
   *
   * @defaultValue 0
   */
  seed?: number;
};

/** Meter assumed when none is supplied. */
const DEFAULT_TS: TimeSignature = { numerator: 4, denominator: 4 };

/** Tolerance for beat-position comparisons. */
const EPS = 1e-9;

/** Grid resolution, in quarter-note beats, scanned for complement onsets. */
const GRID_STEP = 0.5;

/** Minimum spacing between counter onsets, keeping the line uncluttered. */
const MIN_ONSET_GAP = 1;

/** Semitone offset of the counter register's centre from the melody's mean pitch. */
const REGISTER_OFFSET = 12;

/** Half-width, in semitones, of the default counter register. */
const DEFAULT_HALF_RANGE = 10;

/** Probability of moving on a whole beat while the melody sustains. */
const HOLD_ON_BEAT_PROB = 0.55;

/** Probability of moving on an off-beat subdivision while the melody sustains. */
const HOLD_OFF_BEAT_PROB = 0.2;

/** Probability of reinforcing a strong beat that the melody also attacks. */
const REINFORCE_PROB = 0.35;

/** Velocity assumed for melody notes that carry none. */
const DEFAULT_MELODY_VELOCITY = 96;

/** How far below the concurrent melody velocity the counter line sits. */
const VELOCITY_DROP = 16;

/** Whether a beat position falls on a whole quarter-note beat. */
function isWholeBeat(beat: number): boolean {
  return Math.abs(beat - Math.round(beat)) < EPS;
}

/** The melody note sounding at a beat (latest onset wins on overlaps). */
function melodyNoteAt(melody: NoteEventIndex, beat: number): NoteEvent | undefined {
  return melody.at(beat)?.note;
}

/** Whether any melody note attacks exactly at a beat. */
function melodyAttacksAt(melody: NoteEventIndex, beat: number): boolean {
  return melody.attacksAt(beat);
}

/** Melody voice at a transition, including the pitch immediately before it. */
function melodySnapshotAt(melody: NoteEventIndex, beat: number): VoiceSnapshot | undefined {
  const current = melodyNoteAt(melody, beat);
  if (current === undefined) {
    return undefined;
  }
  const attacked = Math.abs(current.startBeat - beat) < EPS;
  const previous = attacked ? melodyNoteAt(melody, beat - EPS * 2) : current;
  const snapshot: VoiceSnapshot = { pitch: current.pitch };
  if (previous !== undefined) {
    snapshot.prevPitch = previous.pitch;
  }
  return snapshot;
}

/** Counter onsets mirroring the melody's own onsets, deduplicated and sorted. */
function followOnsets(melody: NoteEventIndex): number[] {
  return [...new Set(melody.notes.map(({ note }) => note.startBeat))];
}

/**
 * Counter onsets complementing the melody: whole beats inside rests are always
 * taken, positions where the melody sustains are taken probabilistically, and
 * strong beats the melody also attacks are occasionally reinforced. A minimum
 * gap between accepted onsets keeps the line sparse.
 */
function complementOnsets(
  melody: NoteEventIndex,
  ts: TimeSignature,
  spanStart: number,
  spanEnd: number,
  rng: Rng,
): number[] {
  const onsets: number[] = [];
  const gridStart = Math.floor(spanStart / GRID_STEP) * GRID_STEP;
  let last = Number.NEGATIVE_INFINITY;
  for (let beat = gridStart; beat < spanEnd - EPS; beat += GRID_STEP) {
    const attacked = melodyAttacksAt(melody, beat);
    const sounding = melodyNoteAt(melody, beat) !== undefined;
    let place = false;
    if (!attacked && !sounding) {
      place = isWholeBeat(beat);
    } else if (!attacked) {
      place = rng.prob(isWholeBeat(beat) ? HOLD_ON_BEAT_PROB : HOLD_OFF_BEAT_PROB);
    } else if (isStrongBeat(beat, ts)) {
      place = rng.prob(REINFORCE_PROB);
    }
    if (place && beat - last >= MIN_ONSET_GAP - EPS) {
      onsets.push(beat);
      last = beat;
    }
  }
  return onsets;
}

/**
 * Preference score for one candidate counter pitch. Rewards imperfect
 * consonance with the melody, chord-tone membership, contrary or oblique
 * motion, and stepwise movement; penalizes wide or forbidden leaps, weak-beat
 * clashes, and drifting from the register centre.
 */
function scoreCandidate(
  pitch: number,
  melPitch: number | undefined,
  melPrev: number | undefined,
  prevPitch: number | undefined,
  chord: Chord | null,
  center: number,
): number {
  let score = 0;
  if (melPitch !== undefined) {
    const ic = Math.abs(pitch - melPitch) % 12;
    if (ic === 3 || ic === 4 || ic === 8 || ic === 9) {
      score += 2; // imperfect consonance: thirds and sixths
    } else if (ic === 0 || ic === 7) {
      score += 0.5; // perfect consonance: allowed but less colourful
    } else if (ic === 1 || ic === 2 || ic === 6 || ic === 10 || ic === 11) {
      score -= 2; // dissonant even on weak beats
    }
  }
  if (chord && chordToneRole(pitch, chord) !== null) {
    score += 1;
  }
  if (prevPitch !== undefined) {
    const move = pitch - prevPitch;
    const dist = Math.abs(move);
    score -= dist * 0.3;
    if (dist > 0 && dist <= 2) {
      score += 1; // stepwise motion
    }
    if (isForbiddenMelodicLeap(prevPitch, pitch)) {
      score -= 6;
    }
    if (melPitch !== undefined && melPrev !== undefined) {
      const melMove = melPitch - melPrev;
      if ((move > 0 && melMove < 0) || (move < 0 && melMove > 0)) {
        score += 2; // contrary motion
      } else if (move === 0 || melMove === 0) {
        score += 1; // oblique motion
      } else {
        score -= 1; // similar motion
      }
    }
  }
  score -= Math.abs(pitch - center) * 0.02;
  return score;
}

/** Event boundaries at which a held counter pitch can acquire a new context. */
function heldNoteBoundaries(
  melody: NoteEventIndex,
  startBeat: number,
  endBeat: number,
  chordChangeBeats: number[],
): number[] {
  const boundaries = new Set<number>([startBeat]);
  for (const onset of melody.onsetsBetween(startBeat, endBeat)) {
    boundaries.add(onset);
  }
  for (const beat of chordChangeBeats) {
    if (beat > startBeat + EPS && beat < endBeat - EPS) {
      boundaries.add(beat);
    }
  }
  // `chordAt` is an opaque callback. Probe the same half-beat grid used by the
  // complement rhythm so ordinary beat/bar chord changes are still found even
  // when the caller does not provide `chordChangeBeats`.
  const firstGrid = Math.floor(startBeat / GRID_STEP + 1) * GRID_STEP;
  for (let beat = firstGrid; beat < endBeat - EPS; beat += GRID_STEP) {
    boundaries.add(beat);
  }
  return [...boundaries].sort((a, b) => a - b);
}

/**
 * Worst safety reached while `pitch` is held through its complete interval.
 * A wrong-side crossing is treated as unavailable. Safe candidates are later
 * preferred over Warning candidates; Dissonant candidates are never emitted.
 */
function heldPitchSafety(
  pitch: number,
  startBeat: number,
  endBeat: number,
  prevPitch: number | undefined,
  melody: NoteEventIndex,
  opts: CounterMelodyOptions,
  profile: 'strict' | 'pop',
  register: 'above' | 'below',
  low: number,
  high: number,
  ts: TimeSignature,
): NoteSafety | null {
  let worst = NoteSafety.Safe;
  const boundaries = heldNoteBoundaries(melody, startBeat, endBeat, opts.chordChangeBeats ?? []);
  for (const boundary of boundaries) {
    const melodyVoice = melodySnapshotAt(melody, boundary);
    if (
      melodyVoice !== undefined &&
      ((register === 'below' && pitch >= melodyVoice.pitch) ||
        (register === 'above' && pitch <= melodyVoice.pitch))
    ) {
      return null;
    }
    const atCounterOnset = Math.abs(boundary - startBeat) < EPS;
    const result = evaluateSafety({
      profile,
      candidatePitch: pitch,
      prevPitch: atCounterOnset ? prevPitch : pitch,
      chord: opts.chordAt(boundary),
      key: opts.key,
      otherVoices: melodyVoice ? [melodyVoice] : [],
      strongBeat: isStrongBeat(boundary, ts),
      vocalLow: low,
      vocalHigh: high,
    });
    worst = Math.max(worst, result.safety) as NoteSafety;
    if (worst === NoteSafety.Dissonant) {
      return worst;
    }
  }
  return worst;
}

/**
 * Generate a counter melody against a lead line.
 *
 * Onsets are chosen per `rhythm`: `'follow'` places one counter note on each
 * melody onset; `'complement'` fills melody rests and sustains and reinforces
 * an occasional strong beat, spaced at least a beat apart. Each onset's pitch
 * is picked from the safe pitches in the counter register (chord tones and
 * consonant tensions against the sounding melody note), rejecting candidates
 * that would form a parallel perfect interval with the melody or sit on the
 * wrong side of it, then scored to favour contrary or oblique motion, imperfect
 * consonance, and stepwise movement. Ties break toward the lower pitch, so a
 * given seed always yields the same line. Notes extend to the next counter
 * onset (the last to the melody's end) at a velocity slightly under the melody.
 *
 * @param opts The lead line, chord context callback, key, and generation knobs.
 * @returns The counter line as note events sorted by onset; `[]` for an empty melody.
 * @example
 * ```ts
 * import { generateCounterMelody, majorKey, parseChordSymbol } from '@libraz/libcantus';
 * const melody = [{ pitch: 72, startBeat: 0, durationBeat: 2 }];
 * const counter = generateCounterMelody({
 *   melody,
 *   chordAt: () => parseChordSymbol('C'),
 *   key: majorKey(0),
 * }); // note events below the melody, in onset order
 * ```
 * @category Voicing & Counterpoint
 */
export function generateCounterMelody(opts: CounterMelodyOptions): NoteEvent[] {
  const melody = createNoteEventIndex(opts.melody);
  if (melody.notes.length === 0) {
    return [];
  }
  const ts = opts.ts ?? DEFAULT_TS;
  assertTimeSignature(ts);
  const register = opts.register ?? 'below';
  const rhythm = opts.rhythm ?? 'complement';
  const profile = opts.profile ?? 'pop';
  const rng = createRng(opts.seed ?? 0);

  const spanStart = melody.notes[0]?.note.startBeat ?? 0;
  const spanEnd = melody.notes.reduce((end, n) => Math.max(end, n.endBeat), spanStart);
  assertGenerationBudget(Math.ceil((spanEnd - spanStart) / GRID_STEP), 'countermelody grid');
  const meanPitch = melody.notes.reduce((sum, n) => sum + n.note.pitch, 0) / melody.notes.length;
  const defaultCenter =
    register === 'below' ? meanPitch - REGISTER_OFFSET : meanPitch + REGISTER_OFFSET;
  const low = opts.pitchLow ?? Math.round(defaultCenter) - DEFAULT_HALF_RANGE;
  const high = opts.pitchHigh ?? Math.round(defaultCenter) + DEFAULT_HALF_RANGE;
  assertInteger(low, 'countermelody pitchLow');
  assertInteger(high, 'countermelody pitchHigh');
  if (low > high) {
    throw new RangeError(
      `countermelody pitchLow must not exceed pitchHigh; received ${low} > ${high}`,
    );
  }
  assertGenerationBudget(high - low + 1, 'countermelody pitch candidates');
  assertGenerationBudget(opts.chordChangeBeats?.length ?? 0, 'chord change beats');
  for (let index = 0; index < (opts.chordChangeBeats?.length ?? 0); index += 1) {
    assertRange(
      opts.chordChangeBeats?.[index] ?? Number.NaN,
      0,
      Number.MAX_SAFE_INTEGER,
      `chordChangeBeats[${index}]`,
    );
  }
  const center = (low + high) / 2;

  const onsets =
    rhythm === 'follow'
      ? followOnsets(melody)
      : complementOnsets(melody, ts, spanStart, spanEnd, rng);
  assertGenerationBudget(onsets.length * (high - low + 1), 'countermelody search');

  const out: NoteEvent[] = [];
  let prevPitch: number | undefined;
  for (let onsetIndex = 0; onsetIndex < onsets.length; onsetIndex += 1) {
    const beat = onsets[onsetIndex];
    if (beat === undefined) {
      continue;
    }
    const nextOnset = onsets[onsetIndex + 1];
    const endBeat = nextOnset ?? Math.max(spanEnd, beat + GRID_STEP);
    const melNote = melodyNoteAt(melody, beat);
    const melPitch = melNote?.pitch;
    const melodyVoice = melodySnapshotAt(melody, beat);
    const melPrev = melodyVoice?.prevPitch;
    const chord = opts.chordAt(beat);
    const otherVoices: VoiceSnapshot[] = melodyVoice !== undefined ? [melodyVoice] : [];

    const candidates = enumerateSafePitches(
      {
        profile,
        prevPitch,
        chord,
        key: opts.key,
        otherVoices,
        strongBeat: isStrongBeat(beat, ts),
        vocalLow: low,
        vocalHigh: high,
      },
      low,
      high,
    );

    let bestPitch: number | undefined;
    let bestWorstSafety = NoteSafety.Dissonant;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      const worstSafety = heldPitchSafety(
        candidate,
        beat,
        endBeat,
        prevPitch,
        melody,
        opts,
        profile,
        register,
        low,
        high,
        ts,
      );
      if (worstSafety === null || worstSafety === NoteSafety.Dissonant) {
        continue;
      }
      if (melPitch !== undefined) {
        if (
          prevPitch !== undefined &&
          melPrev !== undefined &&
          // Parallel octaves are the perfect-class-zero case of this predicate,
          // so a single check covers both parallel fifths and octaves.
          createsParallelPerfect(prevPitch, candidate, melPrev, melPitch)
        ) {
          continue;
        }
      }
      const score = scoreCandidate(candidate, melPitch, melPrev, prevPitch, chord, center);
      const tie =
        Math.abs(score - bestScore) <= EPS && candidate < (bestPitch ?? Number.POSITIVE_INFINITY);
      if (
        worstSafety < bestWorstSafety ||
        (worstSafety === bestWorstSafety && (score > bestScore + EPS || tie))
      ) {
        bestWorstSafety = worstSafety;
        bestScore = score;
        bestPitch = candidate;
      }
    }

    if (bestPitch === undefined) {
      // Do not emit an unchecked fallback. Ending the previous note at this
      // planned onset leaves an explicit rest when the constraints are
      // unsatisfiable instead of returning a plausibly named unsafe line.
      prevPitch = undefined;
      continue;
    }
    const pitch = bestPitch;
    const velocity = Math.max(
      1,
      Math.min(127, Math.round((melNote?.velocity ?? DEFAULT_MELODY_VELOCITY) - VELOCITY_DROP)),
    );
    out.push({ pitch, startBeat: beat, durationBeat: endBeat - beat, velocity });
    prevPitch = pitch;
  }
  return out;
}
