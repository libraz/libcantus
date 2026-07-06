import type { Chord, ChordQuality } from '../chord/index.js';
import { chordPitchClasses, diatonicTriad, makeChord } from '../chord/index.js';
import type { HarmonyRole } from '../harmony/index.js';
import { roleOf } from '../harmony/index.js';
import type { TimeSignature } from '../meter/index.js';
import { isStrongBeat } from '../meter/index.js';
import type { GeneratedChord } from '../progression/index.js';
import { isScaleTone, majorKey, scaleTonesInDegreeOrder } from '../scale/index.js';
import type { KeyScale } from '../types.js';

/** A melody note supplied to the harmonizer. */
export type MelodyNote = {
  pitch: number;
  startBeat: number;
  durationBeat: number;
};

/** Options controlling {@link harmonizeMelody}. */
export type HarmonizeOptions = {
  melody: MelodyNote[];
  key: KeyScale | 'infer';
  harmonicRhythm: number;
  reharmonize: 'diatonic' | 'secondaryDominant' | 'borrowed';
  placement: { transposeSearch: boolean; octaveSearch: boolean };
  seed?: number;
};

/** The chosen transpose, key, chord path, and per-note roles. */
export type HarmonizeResult = {
  transposeSemitones: number;
  key: KeyScale;
  chords: GeneratedChord[];
  melodyRoles: { noteIndex: number; role: HarmonyRole }[];
};

type Candidate = {
  rootPc: number;
  quality: ChordQuality;
  degree?: number;
  secondaryDominant: boolean;
  targetDegree?: number;
  base: number;
};

type Segment = { startBeat: number; endBeat: number; noteIndices: number[] };

const FALLBACK: Candidate = { rootPc: 0, quality: 'maj', secondaryDominant: false, base: 0 };

/** Default meter used to weight metric accents when none is supplied. */
const DEFAULT_METER: TimeSignature = { numerator: 4, denominator: 4 };

/** Comfortable melodic range (MIDI) and the per-semitone cost of leaving it. */
const COMFORT_LOW = 55;
const COMFORT_HIGH = 79;
const TESSITURA_WEIGHT = 0.001;

function pitchClass(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Estimate the best-fit major key from a melody's pitch-class weighting. */
function inferKey(melody: MelodyNote[]): KeyScale {
  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const key = majorKey(tonic);
    let score = 0;
    for (const n of melody) {
      const w = Math.max(0.25, n.durationBeat);
      if (isScaleTone(n.pitch, key)) {
        score += w;
      }
      if (pitchClass(n.pitch) === tonic) {
        score += 0.5 * w;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = tonic;
    }
  }
  return majorKey(best);
}

/** Enumerate candidate chords for the key, gated by reharmonization strength. */
function buildCandidates(key: KeyScale, reharmonize: HarmonizeOptions['reharmonize']): Candidate[] {
  const tones = scaleTonesInDegreeOrder(key);
  const candidates: Candidate[] = tones.map((rootPc, degree) => ({
    rootPc,
    quality: diatonicTriad(degree, key).quality,
    degree,
    secondaryDominant: false,
    base: 0,
  }));

  const tonic = tones[0] ?? 0;
  if (reharmonize !== 'diatonic') {
    for (const target of [1, 3, 4, 5]) {
      const targetRoot = tones[target] ?? 0;
      candidates.push({
        rootPc: (targetRoot + 7) % 12,
        quality: 'dom7',
        secondaryDominant: true,
        targetDegree: target,
        base: 1.5,
      });
    }
  }

  if (reharmonize === 'borrowed') {
    candidates.push({
      rootPc: (tonic + 10) % 12,
      quality: 'maj',
      secondaryDominant: false,
      base: 2,
    }); // bVII
    candidates.push({
      rootPc: (tonic + 8) % 12,
      quality: 'maj',
      secondaryDominant: false,
      base: 2,
    }); // bVI
    candidates.push({
      rootPc: (tonic + 5) % 12,
      quality: 'min',
      secondaryDominant: false,
      base: 2,
    }); // iv
  }

  return candidates;
}

/**
 * Melody-fit cost of a candidate over a segment's notes.
 *
 * Each note is weighted by the portion of its duration that overlaps the
 * segment, so a note sustained across a boundary contributes to every segment
 * it sounds in rather than only the one it starts in.
 */
function emissionCost(seg: Segment, cand: Candidate, melody: MelodyNote[], key: KeyScale): number {
  const pcs = chordPitchClasses(makeChord(cand.rootPc, cand.quality));
  let cost = cand.base;
  for (const idx of seg.noteIndices) {
    const note = melody[idx];
    if (!note) {
      continue;
    }
    const overlapStart = Math.max(note.startBeat, seg.startBeat);
    const overlap = Math.min(note.startBeat + note.durationBeat, seg.endBeat) - overlapStart;
    if (overlap <= 0) {
      continue;
    }
    const w = Math.max(0.25, overlap);
    if (pcs.includes(pitchClass(note.pitch))) {
      continue;
    }
    const strong = isStrongBeat(overlapStart, DEFAULT_METER);
    cost += (strong ? 10 : 2) * w;
    if (!isScaleTone(note.pitch, key)) {
      cost += w;
    }
  }
  return cost;
}

/**
 * Register cost of a placed melody: a small penalty for notes pushed outside a
 * comfortable range. Kept far below emission/transition costs so it only breaks
 * ties between otherwise-equal octave placements.
 */
function tessituraCost(melody: MelodyNote[]): number {
  let cost = 0;
  for (const n of melody) {
    if (n.pitch < COMFORT_LOW) {
      cost += (COMFORT_LOW - n.pitch) * TESSITURA_WEIGHT;
    } else if (n.pitch > COMFORT_HIGH) {
      cost += (n.pitch - COMFORT_HIGH) * TESSITURA_WEIGHT;
    }
  }
  return cost;
}

/** Functional-flow cost of moving from one candidate chord to the next. */
function transitionCost(prev: Candidate, cur: Candidate, tonicPc: number): number {
  let cost = 0;
  if ((prev.rootPc - cur.rootPc + 12) % 12 === 7) {
    cost -= 2; // descending-fifth root motion
  }
  if (
    prev.rootPc === (tonicPc + 7) % 12 &&
    (prev.quality === 'maj' || prev.quality === 'dom7') &&
    cur.rootPc === tonicPc
  ) {
    cost -= 3; // V -> I
  }
  if (prev.secondaryDominant) {
    cost += cur.degree === prev.targetDegree ? -3 : 2;
  }
  const dist = Math.min((prev.rootPc - cur.rootPc + 12) % 12, (cur.rootPc - prev.rootPc + 12) % 12);
  cost += dist * 0.3;
  return cost;
}

/** Run one Viterbi harmonization pass over a fixed melody and key. */
function harmonizeOnce(
  melody: MelodyNote[],
  key: KeyScale,
  candidates: Candidate[],
  segments: Segment[],
  jitter: number[],
): { cost: number; path: number[] } {
  const tonicPc = pitchClass(key.rootPc);
  const n = candidates.length;
  const candAt = (i: number): Candidate => candidates[i] ?? FALLBACK;
  const seg0 = segments[0];

  let dp = candidates.map(
    (c, ci) => (seg0 ? emissionCost(seg0, c, melody, key) : 0) + (jitter[ci] ?? 0),
  );
  const back: number[][] = [];

  for (let s = 1; s < segments.length; s += 1) {
    const seg = segments[s];
    if (!seg) {
      continue;
    }
    const next: number[] = [];
    const ptr: number[] = [];
    for (let c = 0; c < n; c += 1) {
      let best = Number.POSITIVE_INFINITY;
      let bestPrev = 0;
      for (let p = 0; p < n; p += 1) {
        const cost =
          (dp[p] ?? Number.POSITIVE_INFINITY) + transitionCost(candAt(p), candAt(c), tonicPc);
        if (cost < best) {
          best = cost;
          bestPrev = p;
        }
      }
      next[c] = best + emissionCost(seg, candAt(c), melody, key) + (jitter[c] ?? 0);
      ptr[c] = bestPrev;
    }
    dp = next;
    back.push(ptr);
  }

  let bestCost = Number.POSITIVE_INFINITY;
  let bestEnd = 0;
  for (let c = 0; c < n; c += 1) {
    const cadence = candAt(c).rootPc === tonicPc ? -2 : 0;
    const total = (dp[c] ?? Number.POSITIVE_INFINITY) + cadence;
    if (total < bestCost) {
      bestCost = total;
      bestEnd = c;
    }
  }

  const path: number[] = new Array<number>(segments.length).fill(bestEnd);
  for (let s = segments.length - 2; s >= 0; s -= 1) {
    const ptr = back[s];
    const nextIdx = path[s + 1] ?? bestEnd;
    path[s] = ptr ? (ptr[nextIdx] ?? bestEnd) : bestEnd;
  }
  return { cost: bestCost, path };
}

/**
 * Harmonize a melody with a min-cost chord progression.
 *
 * The melody is segmented by `harmonicRhythm`; each segment is scored against
 * diatonic (and, per `reharmonize`, secondary-dominant and borrowed) candidate
 * chords by melody fit, and a Viterbi search picks the lowest-cost path using a
 * functional-flow transition cost. When `placement.transposeSearch`/`octaveSearch`
 * is set, the whole melody is transposed across a range and the best
 * `(transpose, progression)` pair is returned; a small tessitura cost breaks
 * ties toward placements that keep the melody in a comfortable register.
 *
 * @param opts Melody, key (or `'infer'`), harmonic rhythm, reharmonization
 *   strength, height-search flags, and seed.
 * @returns The chosen transpose, key, chord path, and per-note roles.
 */
export function harmonizeMelody(opts: HarmonizeOptions): HarmonizeResult {
  const key = opts.key === 'infer' ? inferKey(opts.melody) : opts.key;
  const candidates = buildCandidates(key, opts.reharmonize);
  const candAt = (i: number): Candidate => candidates[i] ?? FALLBACK;
  const rng = mulberry32(opts.seed ?? 0);
  const jitter = candidates.map(() => rng() * 1e-6);

  const melodyEnd = opts.melody.reduce((m, n) => Math.max(m, n.startBeat + n.durationBeat), 0);
  const hr = Math.max(0.25, opts.harmonicRhythm);
  const segCount = Math.max(1, Math.ceil(melodyEnd / hr));
  const segments: Segment[] = [];
  for (let s = 0; s < segCount; s += 1) {
    const startBeat = s * hr;
    const endBeat = startBeat + hr;
    const noteIndices = opts.melody
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.startBeat < endBeat && n.startBeat + n.durationBeat > startBeat)
      .map(({ i }) => i);
    segments.push({ startBeat, endBeat, noteIndices });
  }

  const transposes: number[] = [0];
  if (opts.placement.transposeSearch) {
    for (let s = -6; s <= 6; s += 1) {
      if (s !== 0) {
        transposes.push(s);
      }
    }
  }
  if (opts.placement.octaveSearch) {
    for (const o of [-12, 12]) {
      if (!transposes.includes(o)) {
        transposes.push(o);
      }
    }
  }

  let bestCost = Number.POSITIVE_INFINITY;
  let bestTs = 0;
  let bestPath: number[] = [];
  let bestMelody = opts.melody;
  for (const ts of transposes) {
    const shifted = opts.melody.map((n) => ({ ...n, pitch: n.pitch + ts }));
    const { cost, path } = harmonizeOnce(shifted, key, candidates, segments, jitter);
    const total = cost + tessituraCost(shifted);
    if (total < bestCost) {
      bestCost = total;
      bestTs = ts;
      bestPath = path;
      bestMelody = shifted;
    }
  }

  const chords: GeneratedChord[] = bestPath.map((ci, s) => {
    const cand = candAt(ci);
    const chord: GeneratedChord = {
      rootPc: cand.rootPc,
      quality: cand.quality,
      startBeat: segments[s]?.startBeat ?? s * hr,
    };
    if (cand.degree !== undefined) {
      chord.degree = cand.degree;
    }
    if (cand.secondaryDominant) {
      chord.secondaryDominant = true;
    }
    return chord;
  });

  const melodyRoles = bestMelody.map((note, noteIndex) => {
    const segIdx = Math.min(segments.length - 1, Math.max(0, Math.floor(note.startBeat / hr)));
    const cand = candAt(bestPath[segIdx] ?? 0);
    const chord: Chord = makeChord(cand.rootPc, cand.quality);
    return { noteIndex, role: roleOf(note.pitch, chord).role };
  });

  return { transposeSemitones: bestTs, key, chords, melodyRoles };
}
