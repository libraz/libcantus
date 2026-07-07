import type { Chord } from '../chord/index.js';
import { chordToneRole } from '../chord/index.js';
import { createsParallelPerfect, isForbiddenMelodicLeap } from '../counterpoint/index.js';
import type { TimeSignature } from '../meter/index.js';
import { isStrongBeat } from '../meter/index.js';
import type { Rng } from '../random/index.js';
import { createRng } from '../random/index.js';
import type { VoiceSnapshot } from '../safety/index.js';
import { enumerateSafePitches } from '../safety/index.js';
import { nearestScaleTone } from '../scale/index.js';
import type { KeyScale, NoteEvent } from '../types.js';

/** Options controlling {@link generateCounterMelody}. */
export type CounterMelodyOptions = {
  /** The lead line to write against, in ascending onset order. */
  melody: NoteEvent[];
  /** Chord sounding at an absolute beat position, or null when none applies. */
  chordAt: (beat: number) => Chord | null;
  /** Key/scale context for scale-tone decisions. */
  key: KeyScale;
  /** Meter used for strong-beat decisions (default 4/4). */
  ts?: TimeSignature;
  /** Which side of the melody the counter line occupies (default `'below'`). */
  register?: 'above' | 'below';
  /**
   * Onset strategy: `'complement'` (default) moves where the melody holds or
   * rests and reinforces some strong beats; `'follow'` mirrors melody onsets.
   */
  rhythm?: 'complement' | 'follow';
  /** Safety profile applied to candidate pitches (default `'pop'`). */
  profile?: 'strict' | 'pop';
  /** Lowest MIDI pitch the counter line may use (default derived from `register`). */
  pitchLow?: number;
  /** Highest MIDI pitch the counter line may use (default derived from `register`). */
  pitchHigh?: number;
  /** PRNG seed; the same seed always yields the same line (default 0). */
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
function melodyNoteAt(melody: NoteEvent[], beat: number): NoteEvent | undefined {
  let found: NoteEvent | undefined;
  for (const note of melody) {
    if (note.startBeat - EPS <= beat && beat < note.startBeat + note.durationBeat - EPS) {
      if (!found || note.startBeat > found.startBeat) {
        found = note;
      }
    }
  }
  return found;
}

/** Whether any melody note attacks exactly at a beat. */
function melodyAttacksAt(melody: NoteEvent[], beat: number): boolean {
  return melody.some((note) => Math.abs(note.startBeat - beat) < EPS);
}

/** Counter onsets mirroring the melody's own onsets, deduplicated and sorted. */
function followOnsets(melody: NoteEvent[]): number[] {
  return [...new Set(melody.map((note) => note.startBeat))].sort((a, b) => a - b);
}

/**
 * Counter onsets complementing the melody: whole beats inside rests are always
 * taken, positions where the melody sustains are taken probabilistically, and
 * strong beats the melody also attacks are occasionally reinforced. A minimum
 * gap between accepted onsets keeps the line sparse.
 */
function complementOnsets(
  melody: NoteEvent[],
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

/**
 * Last-resort pitch when no safe candidate survives filtering: the scale tone
 * nearest the previous pitch (or the register centre), pushed onto the correct
 * side of the sounding melody note.
 */
function fallbackPitch(
  melPitch: number | undefined,
  prevPitch: number | undefined,
  center: number,
  register: 'above' | 'below',
  low: number,
  high: number,
  key: KeyScale,
): number {
  let target = prevPitch ?? Math.round(center);
  if (melPitch !== undefined) {
    if (register === 'below' && target >= melPitch) {
      target = melPitch - 5;
    } else if (register === 'above' && target <= melPitch) {
      target = melPitch + 5;
    }
  }
  target = Math.min(Math.max(target, low), high);
  let pitch = nearestScaleTone(target, key);
  // Push onto the requested side of the melody, but only by whole octaves that
  // keep the pitch inside [low, high]; the declared range is a hard bound while
  // the register side is a soft preference. A final clamp guarantees the range.
  if (melPitch !== undefined) {
    while (register === 'below' && pitch >= melPitch && pitch - 12 >= low) {
      pitch -= 12;
    }
    while (register === 'above' && pitch <= melPitch && pitch + 12 <= high) {
      pitch += 12;
    }
  }
  return Math.min(Math.max(pitch, low), high);
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
 */
export function generateCounterMelody(opts: CounterMelodyOptions): NoteEvent[] {
  const melody = [...opts.melody].sort((a, b) => a.startBeat - b.startBeat);
  if (melody.length === 0) {
    return [];
  }
  const ts = opts.ts ?? DEFAULT_TS;
  const register = opts.register ?? 'below';
  const rhythm = opts.rhythm ?? 'complement';
  const profile = opts.profile ?? 'pop';
  const rng = createRng(opts.seed ?? 0);

  const spanStart = melody[0]?.startBeat ?? 0;
  const spanEnd = melody.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), spanStart);
  const meanPitch = melody.reduce((sum, n) => sum + n.pitch, 0) / melody.length;
  const defaultCenter =
    register === 'below' ? meanPitch - REGISTER_OFFSET : meanPitch + REGISTER_OFFSET;
  const low = opts.pitchLow ?? Math.round(defaultCenter) - DEFAULT_HALF_RANGE;
  const high = opts.pitchHigh ?? Math.round(defaultCenter) + DEFAULT_HALF_RANGE;
  const center = (low + high) / 2;

  const onsets =
    rhythm === 'follow'
      ? followOnsets(melody)
      : complementOnsets(melody, ts, spanStart, spanEnd, rng);

  const out: NoteEvent[] = [];
  let prevPitch: number | undefined;
  let prevOnset: number | undefined;
  for (const beat of onsets) {
    const melNote = melodyNoteAt(melody, beat);
    const melPitch = melNote?.pitch;
    const melPrev = prevOnset !== undefined ? melodyNoteAt(melody, prevOnset)?.pitch : undefined;
    const chord = opts.chordAt(beat);
    const otherVoices: VoiceSnapshot[] =
      melPitch !== undefined ? [{ pitch: melPitch, prevPitch: melPrev }] : [];

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
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      if (melPitch !== undefined) {
        if (register === 'below' && candidate >= melPitch) {
          continue;
        }
        if (register === 'above' && candidate <= melPitch) {
          continue;
        }
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
      if (score > bestScore + EPS || tie) {
        bestScore = score;
        bestPitch = candidate;
      }
    }

    const pitch =
      bestPitch ?? fallbackPitch(melPitch, prevPitch, center, register, low, high, opts.key);
    const velocity = Math.max(
      1,
      Math.min(127, Math.round((melNote?.velocity ?? DEFAULT_MELODY_VELOCITY) - VELOCITY_DROP)),
    );
    out.push({ pitch, startBeat: beat, durationBeat: GRID_STEP, velocity });
    prevPitch = pitch;
    prevOnset = beat;
  }

  // Extend each note to the next counter onset; the last to the melody's end.
  for (let i = 0; i < out.length; i += 1) {
    const note = out[i];
    if (!note) {
      continue;
    }
    const next = out[i + 1];
    const end = next ? next.startBeat : Math.max(spanEnd, note.startBeat + GRID_STEP);
    note.durationBeat = end - note.startBeat;
  }
  return out;
}
