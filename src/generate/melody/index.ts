/**
 * Melody generation from a {@link CompositionPlan}.
 *
 * The plan is a hard constraint: every phrase keeps its span and register, the
 * harmony is read from the plan alone, and every derived motif is its source
 * replayed through the named relation. Each root motif gets a rhythm from
 * {@link generateRhythm} and pitches from a chain search toward the phrase's
 * target curve; derived motifs are transformed and locally repaired; the spans
 * no motif covers are developed from a root motif; and each phrase's last
 * pulse note is bent onto its cadence.
 *
 * Every draw is addressed by phrase index and position, and a phrase reads
 * only its own plan entries and the motifs its derivations lead back to, so
 * changing one phrase's plan leaves every phrase that does not derive from it
 * sounding as it did.
 */

import { type ChordTimeline, chordTimelineFromChords } from '../../analyze/timeline/index.js';
import { InvalidInputError, NoSolutionError } from '../../core/errors/index.js';
import {
  BEAT_EPS,
  beatsPerBar,
  meterAt,
  metricWeight,
  type TimeSignature,
} from '../../core/meter/index.js';
import { pitchClassOf } from '../../core/pitch/index.js';
import { deriveSeed } from '../../core/random/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertOptions,
  assertPositiveInt,
  assertRecord,
} from '../../core/validation/index.js';
import { chordPitchClasses, spanFromChord } from '../../theory/chord/index.js';
import { isScaleTone, scaleOf, scaleTonesInDegreeOrder } from '../../theory/scale/index.js';
import {
  type GenerationContext,
  type GenerationContextInput,
  type ResolvedContext,
  resolveContext,
} from '../context/index.js';
import { cellSpan, developMotif, type MotifNote, motifToNoteEvents } from '../motif/index.js';
import type { CompositionPlan, PlannedChord, PlannedPhrase } from '../plan/types.js';
import { planTimeline } from '../plan/types.js';
import { assertCompositionPlan } from '../plan/validate.js';
import { generateRhythm, onsetWeightCurve } from '../rhythm/index.js';
import { deriveStatement, type PhraseFrame, repairStatement, varyStatement } from './derive.js';
import { type PitchSlot, searchPitches } from './pitch-dp.js';

/**
 * Options controlling {@link generateMelody}.
 *
 * @category Composition
 */
export type MelodyOptions = {
  /**
   * The generation context. Its `seed` and `algorithmVersion` take precedence
   * over the plan's; whatever it leaves out is read from the plan. A supplied
   * `rng` is rejected: the rhythm of each root motif is drawn from a seed
   * derived per phrase, which a caller-held source cannot provide.
   *
   * @defaultValue the plan's seed and algorithm version
   */
  ctx?: GenerationContextInput;
  /** Upper bound on the pitch search and on the developed notes. */
  budget?: number;
};

/** Grid resolution of a root motif's rhythm: sixteenth notes. */
const RHYTHM_SUBDIVISION = 4;
/** Cost of a non-chord tone on a pulse. */
const OFF_CHORD_COST = 1;
/** Cost of an out-of-scale tone off the pulses. */
const OFF_SCALE_COST = 2;
/** Cost per semitone of distance from the phrase's target curve. */
const TARGET_COST = 0.1;
/** Width of the seeded noise that breaks ties between equal-cost pitches. */
const TIE_BREAK = 1e-6;
/** Leap states a pitch-search state multiplies the register by, squared: (3R)². */
const SEARCH_STATES_SQUARED = 9;

/** Scale degrees a cadence's last pulse note may take, by cadence type. */
const CADENCE_DEGREES = {
  authentic: [1, 3],
  plagal: [1, 3],
  half: [2, 5, 7],
  phrygian: [2, 5, 7],
  modal: [1],
} as const;

/** One stretch of a phrase: a motif statement or a span no motif covers. */
type Segment = { startBeat: number; endBeat: number; motif: number | null };

/** Everything a phrase's generation reads, resolved once per call. */
type Scene = {
  plan: CompositionPlan;
  ctx: ResolvedContext;
  budget: number | undefined;
  timeline: ChordTimeline;
  scales: KeyScale[];
  members: number[][];
  frames: PhraseFrame[];
  statements: Map<number, MotifNote[]>;
  fallbacks: Map<number, MotifNote[]>;
};

/**
 * Resolve the context a melody is drawn under: an explicit seed or algorithm
 * version wins, the plan fills in the rest.
 */
function melodyContext(
  plan: CompositionPlan,
  input: GenerationContextInput | undefined,
): ResolvedContext {
  const fromPlan = { seed: plan.seed, algorithmVersion: plan.algorithmVersion };
  if (input === undefined) {
    return resolveContext(fromPlan);
  }
  if (typeof input === 'number') {
    return resolveContext({ ...fromPlan, seed: input });
  }
  const read = assertRecord<GenerationContext>(input, 'ctx');
  if (read.rng !== undefined) {
    throw new InvalidInputError(
      'ctx.rng cannot drive a melody: each root motif draws its rhythm from a seed derived per phrase; pass a seed instead',
    );
  }
  return resolveContext({
    ...read,
    seed: read.seed ?? plan.seed,
    algorithmVersion: read.algorithmVersion ?? plan.algorithmVersion,
  });
}

/** The planned chord sounding at a beat, if any. */
function chordEntryAt(plan: CompositionPlan, beat: number): PlannedChord | undefined {
  return plan.harmony.find((chord) => beat >= chord.startBeat && beat < chord.endBeat);
}

/** The scale of the key the chord at a beat is named in; the home key where no chord sounds. */
function scaleAt(scene: Scene, beat: number): KeyScale {
  return scene.scales[chordEntryAt(scene.plan, beat)?.key ?? 0] as KeyScale;
}

/** Whether a beat falls on a main pulse of the plan's meter. */
function onPulse(scene: Scene, beat: number): boolean {
  return metricWeight(beat, scene.plan.meters) > 0;
}

/** A tent over [0, 1] rising from -1 to +1 at `apex` and falling back. */
function tent(t: number, apex: number): number {
  if (t <= apex) {
    return apex === 0 ? 1 : -1 + (2 * t) / apex;
  }
  return apex === 1 ? 1 : 1 - (2 * (t - apex)) / (1 - apex);
}

/** The target curve of a shape at relative position `t`, in [-1, 1]. */
function contourAt(shape: PlannedPhrase['shape'], peakPosition: number, t: number): number {
  switch (shape) {
    case 'arch':
      return tent(t, peakPosition);
    case 'ascending':
      return -1 + 2 * t;
    case 'descending':
      return 1 - 2 * t;
    case 'wave':
      return t < 0.5 ? tent(2 * t, 0.5) : tent(2 * t - 1, 0.5);
    case 'static':
      return 0;
  }
}

/** The pitch a phrase's target curve asks for at a beat. */
function targetPitch(phrase: PlannedPhrase, beat: number): number {
  const length = phrase.endBeat - phrase.startBeat;
  const t = length > 0 ? Math.min(Math.max((beat - phrase.startBeat) / length, 0), 1) : 0;
  const { low, high, mean } = phrase.register;
  return mean + ((high - low) / 2) * contourAt(phrase.shape, phrase.peakPosition, t);
}

/** The search and repair view of one phrase. */
function frameOf(scene: Scene, index: number): PhraseFrame {
  const phrase = scene.plan.phrases[index] as PlannedPhrase;
  const { low, high } = phrase.register;
  const candidates: number[] = [];
  for (let pitch = low; pitch <= high; pitch += 1) {
    candidates.push(pitch);
  }
  const chordTonesAt = (beat: number): number[] | null => {
    const chord = scene.timeline.at(beat);
    return chord ? chordPitchClasses(chord) : null;
  };
  const draw = scene.ctx.part('melody');
  return {
    low,
    high,
    candidates,
    at: phrase.startBeat,
    budget: scene.budget,
    costAt: (beat) => {
      const pulse = onPulse(scene, beat);
      const tones = chordTonesAt(beat);
      const scale = scaleAt(scene, beat);
      const target = targetPitch(phrase, beat);
      return (pitch) => {
        let cost = TARGET_COST * Math.abs(pitch - target);
        if (pulse) {
          if (tones !== null && !tones.includes(pitchClassOf(pitch))) {
            cost += OFF_CHORD_COST;
          }
        } else if (!isScaleTone(pitch, scale)) {
          cost += OFF_SCALE_COST;
        }
        return cost + draw.float(0, TIE_BREAK, index, 'tie', beat, pitch);
      };
    },
    needsRepair: (pitch, beat) => {
      if (pitch < low || pitch > high) {
        return true;
      }
      if (!onPulse(scene, beat)) {
        return false;
      }
      const tones = chordTonesAt(beat);
      return tones !== null && !tones.includes(pitchClassOf(pitch));
    },
  };
}

/** The motifs placed in each phrase, listed by the phrase or naming it, in onset order. */
function membersOf(plan: CompositionPlan): number[][] {
  return plan.phrases.map((phrase, index) => {
    const found = new Set(phrase.motifs);
    plan.motifs.forEach((motif, m) => {
      if (motif.phrase === index) {
        found.add(m);
      }
    });
    return [...found].sort(
      (a, b) => (plan.motifs[a]?.startBeat ?? 0) - (plan.motifs[b]?.startBeat ?? 0) || a - b,
    );
  });
}

/** A phrase cut into its motif statements and the spans between them. */
function segmentsOf(scene: Scene, index: number): Segment[] {
  const phrase = scene.plan.phrases[index] as PlannedPhrase;
  const segments: Segment[] = [];
  let cursor = phrase.startBeat;
  for (const m of scene.members[index] as number[]) {
    const motif = scene.plan.motifs[m];
    if (motif === undefined) {
      continue;
    }
    if (motif.startBeat > cursor + BEAT_EPS) {
      segments.push({ startBeat: cursor, endBeat: motif.startBeat, motif: null });
    }
    segments.push({ startBeat: motif.startBeat, endBeat: motif.endBeat, motif: m });
    cursor = Math.max(cursor, motif.endBeat);
  }
  if (phrase.endBeat > cursor + BEAT_EPS) {
    segments.push({ startBeat: cursor, endBeat: phrase.endBeat, motif: null });
  }
  return segments;
}

/**
 * The rhythmic dial that makes {@link generateRhythm}'s expected onsets per bar,
 * `1 + d · Σ onsetWeightCurve(w)` over the non-downbeat slots, meet `density`.
 */
function rhythmicDial(density: number, ts: TimeSignature): number {
  const barBeats = beatsPerBar(ts);
  const slots = Math.ceil(barBeats * RHYTHM_SUBDIVISION);
  let weight = 0;
  for (let slot = 1; slot < slots; slot += 1) {
    const position = slot / RHYTHM_SUBDIVISION;
    if (position >= barBeats - Number.EPSILON) {
      break;
    }
    weight += onsetWeightCurve(metricWeight(position, ts));
  }
  return weight > 0 ? Math.min(Math.max((density - 1) / weight, 0), 1) : 0;
}

/** A generated rhythm laid over [startBeat, endBeat), as pitchless notes. */
function spanRhythm(
  scene: Scene,
  phraseIndex: number,
  segmentIndex: number,
  startBeat: number,
  endBeat: number,
): MotifNote[] {
  const phrase = scene.plan.phrases[phraseIndex] as PlannedPhrase;
  const ts = meterAt(startBeat, scene.plan.meters);
  const spanBeats = endBeat - startBeat;
  const events = generateRhythm(ts, {
    bars: Math.max(1, Math.ceil(spanBeats / beatsPerBar(ts) - BEAT_EPS)),
    subdivision: RHYTHM_SUBDIVISION,
    ctx: {
      seed: deriveSeed(scene.ctx.seed, 'melody', phraseIndex, 'rhythm', segmentIndex),
      algorithmVersion: scene.ctx.algorithmVersion,
      complexity: { rhythmic: rhythmicDial(phrase.onsetDensity, ts) },
    },
  });
  return events
    .filter((event) => event.position < spanBeats - BEAT_EPS)
    .map((event) => ({
      pitch: 0,
      startBeat: startBeat + event.position,
      durationBeat: Math.min(event.duration, spanBeats - event.position),
    }));
}

/**
 * Bring a rhythm to exactly `count` notes: drop the surplus and stretch the
 * last kept note to the span's end, or split the longest note (earliest on a
 * tie) in half until there are enough.
 */
function fitCount(notes: MotifNote[], count: number, endBeat: number): MotifNote[] {
  if (notes.length > count) {
    const kept = notes.slice(0, count);
    const last = kept[count - 1] as MotifNote;
    kept[count - 1] = { ...last, durationBeat: endBeat - last.startBeat };
    return kept;
  }
  const fitted = [...notes];
  while (fitted.length < count) {
    let longest = 0;
    for (let i = 1; i < fitted.length; i += 1) {
      if ((fitted[i] as MotifNote).durationBeat > (fitted[longest] as MotifNote).durationBeat) {
        longest = i;
      }
    }
    const note = fitted[longest] as MotifNote;
    const half = note.durationBeat / 2;
    fitted.splice(
      longest,
      1,
      { ...note, durationBeat: half },
      { ...note, startBeat: note.startBeat + half, durationBeat: half },
    );
  }
  return fitted;
}

/** Choose pitches for a rhythm by the chain search, or fail at the phrase. */
function searchedLine(rhythm: readonly MotifNote[], frame: PhraseFrame): MotifNote[] {
  const slots: PitchSlot[] = rhythm.map((note) => ({
    candidates: frame.candidates,
    cost: frame.costAt(note.startBeat),
    fixed: false,
  }));
  const pitches = searchPitches(slots, frame.budget);
  if (pitches === null) {
    throw new NoSolutionError(`no pitch line fits the register ${frame.low}..${frame.high}`, {
      at: frame.at,
    });
  }
  return rhythm.map((note, i) => ({ ...note, pitch: pitches[i] as number }));
}

/** The root a motif's derivation chain leads back to. */
function rootOf(plan: CompositionPlan, motif: number): number {
  let current = motif;
  for (let from = plan.motifs[current]?.from; from !== null && from !== undefined; ) {
    current = from;
    from = plan.motifs[current]?.from;
  }
  return current;
}

/** The rhythm the whole of a motif-less phrase is written on. */
function fallbackRhythm(scene: Scene, index: number): MotifNote[] {
  let rhythm = scene.fallbacks.get(index);
  if (rhythm === undefined) {
    const phrase = scene.plan.phrases[index] as PlannedPhrase;
    rhythm = spanRhythm(scene, index, 0, phrase.startBeat, phrase.endBeat);
    scene.fallbacks.set(index, rhythm);
  }
  return rhythm;
}

/** A motif statement's notes: generated for a root, derived and repaired otherwise. */
function statementOf(scene: Scene, m: number): MotifNote[] {
  const known = scene.statements.get(m);
  if (known !== undefined) {
    return known;
  }
  const { plan } = scene;
  const motif = plan.motifs[m] as CompositionPlan['motifs'][number];
  const frame = scene.frames[motif.phrase] as PhraseFrame;
  let notes: MotifNote[];
  if (motif.from === null) {
    if (motif.endBeat - motif.startBeat <= BEAT_EPS) {
      throw new NoSolutionError(`root motif ${m} spans no time to place its notes in`, {
        at: frame.at,
      });
    }
    const segmentIndex = segmentsOf(scene, motif.phrase).findIndex((s) => s.motif === m);
    const rhythm = spanRhythm(scene, motif.phrase, segmentIndex, motif.startBeat, motif.endBeat);
    notes = searchedLine(fitCount(rhythm, motif.notes, motif.endBeat), frame);
  } else {
    const source = statementOf(scene, motif.from);
    const derived =
      motif.relation === null
        ? varyStatement(source, motif.startBeat, frame)
        : deriveStatement(source, motif.relation, motif.startBeat, scaleAt(scene, motif.startBeat));
    notes = repairStatement(derived, frame);
  }
  scene.statements.set(m, notes);
  return notes;
}

/** The plan's chord timeline cut to [startBeat, endBeat) and moved to start at 0. */
function clippedTimeline(
  timeline: ChordTimeline,
  startBeat: number,
  endBeat: number,
): ChordTimeline {
  const spans = timeline.segments
    .filter((segment) => segment.endBeat > startBeat && segment.startBeat < endBeat)
    .map((segment) =>
      spanFromChord(segment.chord, Math.max(segment.startBeat, startBeat) - startBeat),
    );
  return chordTimelineFromChords(spans, endBeat - startBeat);
}

/** Fill a span no motif covers by developing a root motif across it. */
function developedSpan(scene: Scene, index: number, segment: Segment): MotifNote[] {
  const { plan } = scene;
  const members = scene.members[index] as number[];
  const before = members.filter(
    (m) => (plan.motifs[m]?.endBeat ?? 0) <= segment.startBeat + BEAT_EPS,
  );
  const isRoot = (m: number) => plan.motifs[m]?.from === null;
  const source =
    before.filter(isRoot).at(-1) ??
    members.find(isRoot) ??
    rootOf(plan, before.at(-1) ?? (members[0] as number));
  const cell = statementOf(scene, source);
  const spanBeats = segment.endBeat - segment.startBeat;
  const ts = meterAt(segment.startBeat, plan.meters);
  const barBeats = beatsPerBar(ts);
  const bars = Math.max(1, Math.ceil(spanBeats / barBeats - BEAT_EPS));
  const span = cellSpan({ notes: cell });
  const tiles = span > 0 ? Math.ceil((bars * barBeats) / span) : 1;
  assertGenerationBudget(tiles * cell.length, 'melody development notes', scene.budget);
  const developed = developMotif(
    { notes: cell.map((note) => ({ ...note })) },
    clippedTimeline(scene.timeline, segment.startBeat, segment.endBeat),
    scaleAt(scene, segment.startBeat),
    bars,
    ts,
  );
  const placed = developed.notes
    .filter((note) => note.startBeat < spanBeats - BEAT_EPS)
    .map((note) => ({
      ...note,
      startBeat: segment.startBeat + note.startBeat,
      durationBeat: Math.min(note.durationBeat, spanBeats - note.startBeat),
    }));
  return repairStatement(placed, scene.frames[index] as PhraseFrame);
}

/**
 * Bend a phrase's last pulse note onto its cadence, holding every other note.
 * Mutates the note in place, so a statement shared with a later derivation
 * carries the repaired pitch into it.
 */
function repairCadence(scene: Scene, index: number, line: MotifNote[]): void {
  const phrase = scene.plan.phrases[index] as PlannedPhrase;
  if (phrase.cadence === null) {
    return;
  }
  let target = -1;
  for (let i = line.length - 1; i >= 0; i -= 1) {
    if (onPulse(scene, (line[i] as MotifNote).startBeat)) {
      target = i;
      break;
    }
  }
  if (target < 0) {
    return;
  }
  const note = line[target] as MotifNote;
  let allowed: number[];
  if (phrase.cadence === 'deceptive') {
    const chord = scene.timeline.at(note.startBeat);
    if (chord === null) {
      return;
    }
    allowed = chordPitchClasses(chord);
  } else {
    const key = scene.plan.keys[chordEntryAt(scene.plan, note.startBeat)?.key ?? 0];
    const tones = scaleTonesInDegreeOrder(scaleOf(key as CompositionPlan['keys'][number]));
    allowed = CADENCE_DEGREES[phrase.cadence]
      .map((degree) => tones[degree - 1])
      .filter((pc): pc is number => pc !== undefined);
  }
  const frame = scene.frames[index] as PhraseFrame;
  const candidates = frame.candidates.filter((pitch) => allowed.includes(pitchClassOf(pitch)));
  if (candidates.length === 0) {
    throw new NoSolutionError(
      `no pitch in the register ${frame.low}..${frame.high} can end the ${phrase.cadence} cadence`,
      { at: frame.at },
    );
  }
  if (allowed.includes(pitchClassOf(note.pitch))) {
    return;
  }
  const slots: PitchSlot[] = line.map((n, i) =>
    i === target
      ? { candidates, cost: frame.costAt(n.startBeat), fixed: false }
      : { candidates: [n.pitch], cost: () => 0, fixed: true },
  );
  const pitches = searchPitches(slots, frame.budget);
  if (pitches === null) {
    throw new NoSolutionError(`no cadence pitch joins its neighbours without an augmented step`, {
      at: frame.at,
    });
  }
  note.pitch = pitches[target] as number;
}

/** A phrase's notes before cadence repair, in time order. */
function phraseLine(scene: Scene, index: number): MotifNote[] {
  const members = scene.members[index] as number[];
  const frame = scene.frames[index] as PhraseFrame;
  if (members.length === 0) {
    const rhythm = fallbackRhythm(scene, index);
    return rhythm.length === 0 ? [] : searchedLine(rhythm, frame);
  }
  const line: MotifNote[] = [];
  for (const segment of segmentsOf(scene, index)) {
    line.push(
      ...(segment.motif === null
        ? developedSpan(scene, index, segment)
        : statementOf(scene, segment.motif)),
    );
  }
  return line.sort((a, b) => a.startBeat - b.startBeat);
}

/** Charge every searched note against the budget before any search runs. */
function chargePitchSearch(scene: Scene): void {
  const { plan } = scene;
  let estimate = 0;
  plan.phrases.forEach((phrase, index) => {
    const members = scene.members[index] as number[];
    const notes =
      members.length === 0
        ? fallbackRhythm(scene, index).length
        : members.reduce((sum, m) => sum + (plan.motifs[rootOf(plan, m)]?.notes ?? 0), 0);
    const register = Math.max(0, phrase.register.high - phrase.register.low + 1);
    estimate += notes * SEARCH_STATES_SQUARED * register * register;
  });
  assertGenerationBudget(estimate, 'melody pitch search', scene.budget);
}

/**
 * Write a melody that follows a composition plan.
 *
 * Each phrase is written inside its planned register. Root motifs take a
 * rhythm drawn toward the phrase's onset density and pitches chosen by a chain
 * search that favours chord tones on the pulses, stays in the key between
 * them, moves by step, recovers from leaps and follows the phrase's target
 * shape. Derived motifs replay their planned relation on the statement they
 * derive from, starting on their planned beat; a variation keeps its source's
 * rhythm and outer pitches. Notes a derivation carries off the register, or
 * onto a non-chord tone on a pulse, are replaced with the rest held. The spans
 * no motif covers are developed from a root motif, and each phrase's last
 * pulse note is bent onto the tones its cadence asks for.
 *
 * Harmony is read from the plan alone, through {@link planTimeline}.
 *
 * @param plan The plan to follow; validated first.
 * @param opts Context and budget.
 * @returns The melody, in time order.
 * @throws {InvalidInputError} If the plan, the options or the context are
 *   malformed, or the context supplies an `rng`.
 * @throws {NoSolutionError} If a phrase's register admits no line, or no
 *   pitch that ends its cadence; `at` is the phrase's start beat.
 * @throws {BudgetExceededError} If the pitch search or a development would
 *   exceed the budget.
 * @example
 * ```ts
 * import { generateMelody, resolveKey } from '@libraz/libcantus';
 * const plan = {
 *   planVersion: 1, seed: 7, algorithmVersion: 1,
 *   keys: [resolveKey('C major')], meters: [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }],
 *   span: { startBeat: 0, endBeat: 8, bars: 2 },
 *   sections: [{ label: 'A', startBeat: 0, endBeat: 8 }],
 *   phrases: [{
 *     startBeat: 0, endBeat: 8, section: 0, cadence: 'authentic', shape: 'arch', peakPosition: 0.6,
 *     register: { low: 60, high: 72, mean: 66 }, onsetDensity: 4, motifs: [0],
 *   }],
 *   harmony: [{ startBeat: 0, endBeat: 4, key: 0, roman: 'V' }, { startBeat: 4, endBeat: 8, key: 0, roman: 'I' }],
 *   motifs: [{ phrase: 0, startBeat: 0, endBeat: 4, notes: 4, from: null, relation: null }],
 *   rhythm: { onsetLevels: [0, 0, 0, 0, 0, 1], interOnsetShares: new Array(17).fill(0).fill(1, 8, 9), syncopation: 0 },
 * };
 * generateMelody(plan); // the same notes on every call
 * ```
 * @category Composition
 */
export function generateMelody(plan: CompositionPlan, opts?: MelodyOptions): NoteEvent[] {
  assertCompositionPlan(plan);
  const asked = assertOptions(opts, 'opts');
  if (asked.budget !== undefined) {
    assertPositiveInt(asked.budget, 'budget', Number.MAX_SAFE_INTEGER);
  }
  const scene: Scene = {
    plan,
    ctx: melodyContext(plan, asked.ctx),
    budget: asked.budget,
    timeline: planTimeline(plan),
    scales: plan.keys.map((key) => scaleOf(key)),
    members: membersOf(plan),
    frames: [],
    statements: new Map(),
    fallbacks: new Map(),
  };
  scene.frames = plan.phrases.map((_, index) => frameOf(scene, index));
  chargePitchSearch(scene);
  const melody: MotifNote[] = [];
  plan.phrases.forEach((_, index) => {
    const line = phraseLine(scene, index);
    repairCadence(scene, index, line);
    melody.push(...line);
  });
  melody.sort((a, b) => a.startBeat - b.startBeat);
  return motifToNoteEvents({ notes: melody });
}
