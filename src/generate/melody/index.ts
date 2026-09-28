/**
 * Melody generation from a {@link CompositionPlan}.
 *
 * The plan is a hard constraint where the generator is free: every root, every
 * span no motif covers and every closing note keeps its phrase's register and
 * offers only the pitches its position class admits — a chord tone on a strong
 * pulse, a scale tone on a weak one, anything in the register off the pulses.
 * A derived statement is its source replayed through the named relation at the
 * pitch level that suits its phrase best; there the transformation outranks
 * the harmony, and the register outranks both. A root takes its plan's onset
 * gaps, or onsets drawn toward the plan's onset levels and gap shares, and pitches from a
 * chain search toward the phrase's target curve; each phrase closes on a note
 * held from its final bar to its end, bent onto its cadence.
 *
 * Every draw is addressed by phrase index and absolute beat, and a phrase
 * reads only its own plan entries and the statements its derivations lead
 * back to, so changing one phrase's plan leaves every phrase that does not
 * derive from it sounding as it did.
 */

import { barSpanOf } from '../../analyze/form/internal.js';
import { ioiBinIndex, rhythmLevel } from '../../analyze/rhythm/index.js';
import type { ChordTimeline } from '../../analyze/timeline/index.js';
import { InvalidInputError, NoSolutionError } from '../../core/errors/index.js';
import { BEAT_EPS, barStartBeat, beatsPerBarAt } from '../../core/meter/index.js';
import { pitchClassOf } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertOptions,
  assertPositiveInt,
  assertRecord,
} from '../../core/validation/index.js';
import { chordPitchClasses } from '../../theory/chord/index.js';
import { isScaleTone, scaleOf } from '../../theory/scale/index.js';
import {
  type GenerationContext,
  type GenerationContextInput,
  type ResolvedContext,
  resolveContext,
} from '../context/index.js';
import { type MotifNote, motifToNoteEvents } from '../motif/index.js';
import { cadencePitchClasses, planHarmonyMisfits, positionClass } from '../plan/harmony.js';
import type { CompositionPlan, PlannedChord, PlannedMotif, PlannedPhrase } from '../plan/types.js';
import { plannedContourAt, planTimeline } from '../plan/types.js';
import { assertCompositionPlan } from '../plan/validate.js';
import { type PhraseFrame, placeDerived, relationLevels, varyStatement } from './derive.js';
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
   * `rng` is rejected: every onset and tie-break is drawn at an address of
   * phrase and beat under a seed, which a caller-held source cannot provide.
   *
   * @defaultValue the plan's seed and algorithm version
   */
  ctx?: GenerationContextInput;
  /** Upper bound on the onset grid and on the pitch search. */
  budget?: number;
};

/** Grid resolution onsets are drawn on: sixteenth notes. */
const RHYTHM_SUBDIVISION = 4;
/** Cost of an out-of-scale tone off the pulses. */
const OFF_SCALE_COST = 1;
/** Cost per semitone of distance from the phrase's target curve. */
const TARGET_COST = 0.1;
/** Width of the seeded noise that breaks ties between equal-cost pitches. */
const TIE_BREAK = 1e-6;
/** Leap states a pitch-search state multiplies the register by, squared: (3R)². */
const SEARCH_STATES_SQUARED = 9;

/** One stretch of a phrase: a motif statement or a span no motif covers. */
type Segment = { startBeat: number; endBeat: number; motif: number | null };

/** Everything a phrase's generation reads, resolved once per call. */
type Scene = {
  plan: CompositionPlan;
  ctx: ResolvedContext;
  budget: number | undefined;
  timeline: ChordTimeline;
  harmonyMisfits: (line: readonly MotifNote[]) => (string[] | null)[];
  scales: KeyScale[];
  members: number[][];
  frames: PhraseFrame[];
  statements: Map<number, MotifNote[]>;
  free: Map<string, MotifNote[]>;
  inProgress: Set<number>;
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
      'ctx.rng cannot drive a melody: every onset and tie-break is drawn at an address of phrase and beat under a seed; pass a seed instead',
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

/** The pitch a phrase's target curve asks for at a beat. */
function targetPitch(phrase: PlannedPhrase, beat: number): number {
  const length = phrase.endBeat - phrase.startBeat;
  const t = length > 0 ? Math.min(Math.max((beat - phrase.startBeat) / length, 0), 1) : 0;
  const { low, high, mean } = phrase.register;
  return mean + ((high - low) / 2) * plannedContourAt(phrase.shape, phrase.peakPosition, t);
}

/** Every pitch of a phrase's register, ascending. */
function registerPitches(phrase: PlannedPhrase): number[] {
  const pitches: number[] = [];
  for (let pitch = phrase.register.low; pitch <= phrase.register.high; pitch += 1) {
    pitches.push(pitch);
  }
  return pitches;
}

/** The search and placement view of one phrase. */
function frameOf(scene: Scene, index: number): PhraseFrame {
  const phrase = scene.plan.phrases[index] as PlannedPhrase;
  const { low, high } = phrase.register;
  const register = registerPitches(phrase);
  const draw = scene.ctx.part('melody');
  return {
    low,
    high,
    at: phrase.startBeat,
    budget: scene.budget,
    candidatesAt: (beat) => {
      const position = positionClass(beat, scene.plan.meters);
      const chord = scene.timeline.at(beat);
      const tones = position === 'strong' && chord !== null ? chordPitchClasses(chord) : null;
      const scale = scaleAt(scene, beat);
      const candidates =
        position === 'off'
          ? register
          : tones !== null
            ? register.filter((pitch) => tones.includes(pitchClassOf(pitch)))
            : register.filter((pitch) => isScaleTone(pitch, scale));
      if (candidates.length === 0) {
        throw new NoSolutionError(
          `no ${position} pitch at beat ${beat} fits the register ${low}..${high}`,
          { at: phrase.startBeat },
        );
      }
      return candidates;
    },
    costAt: (beat) => {
      const off = positionClass(beat, scene.plan.meters) === 'off';
      const scale = scaleAt(scene, beat);
      const target = targetPitch(phrase, beat);
      return (pitch) => {
        let cost = TARGET_COST * Math.abs(pitch - target);
        if (off && !isScaleTone(pitch, scale)) {
          cost += OFF_SCALE_COST;
        }
        return cost + draw.float(0, TIE_BREAK, index, 'tie', beat, pitch);
      };
    },
    targetAt: (beat) => targetPitch(phrase, beat),
    misfits: (notes, before) =>
      scene
        .harmonyMisfits([...before, ...notes])
        .slice(before.length)
        .filter((kinds) => kinds !== null).length,
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

/** Pitchless notes at the given onsets, each lasting to the next and the last to `endBeat`. */
function notesAt(onsets: readonly number[], endBeat: number): MotifNote[] {
  return onsets.map((startBeat, i) => ({
    pitch: 0,
    startBeat,
    durationBeat: (onsets[i + 1] ?? endBeat) - startBeat,
  }));
}

/**
 * The sixteenth-note grid, counted from each bar line, inside
 * `[startBeat, endBeat)`; `startBeat` itself leads when it falls off the grid.
 */
function onsetSlots(scene: Scene, startBeat: number, endBeat: number): number[] {
  const { meters } = scene.plan;
  const slots = [startBeat];
  let bar = barStartBeat(startBeat, meters);
  while (bar < endBeat - BEAT_EPS) {
    const barEnd = bar + beatsPerBarAt(bar, meters);
    for (let k = 0; bar + k / RHYTHM_SUBDIVISION < barEnd - BEAT_EPS; k += 1) {
      const beat = bar + k / RHYTHM_SUBDIVISION;
      if (beat > startBeat + BEAT_EPS && beat < endBeat - BEAT_EPS) {
        slots.push(beat);
      }
    }
    bar = barEnd;
  }
  return slots;
}

/**
 * Draw `count` onsets over `[startBeat, endBeat)`: the first on `startBeat`,
 * each next one from the sixteenth-grid slots after the current onset that
 * still leave room for the notes to come. A slot's weight is the plan's onset
 * share of its rhythmic level, split among that level's slots in the span,
 * times the plan's share of the gap from the current onset; where every
 * candidate weighs nothing the level alone decides, and failing that all
 * candidates are equal. The gap from the last onset to `endBeat` is free.
 */
function drawOnsets(
  scene: Scene,
  phraseIndex: number,
  startBeat: number,
  endBeat: number,
  count: number,
): MotifNote[] {
  const slots = onsetSlots(scene, startBeat, endBeat);
  assertGenerationBudget(slots.length * Math.max(1, count - 1), 'melody onset slots', scene.budget);
  if (count - 1 > slots.length - 1) {
    throw new NoSolutionError(
      `${count} onsets do not fit the sixteenth grid of beats ${startBeat}..${endBeat}`,
      { at: (scene.plan.phrases[phraseIndex] as PlannedPhrase).startBeat },
    );
  }
  const levels = slots.map((beat) => rhythmLevel(beat, scene.plan.meters));
  const perLevel = new Map<number, number>();
  for (const level of levels) {
    perLevel.set(level, (perLevel.get(level) ?? 0) + 1);
  }
  const levelWeight = levels.map(
    (level) => (scene.plan.rhythm.onsetLevels[level] ?? 0) / (perLevel.get(level) as number),
  );
  const draw = scene.ctx.part('melody');
  const onsets = [startBeat];
  let current = 0;
  for (let k = 1; k < count; k += 1) {
    // The last slot this onset may take and still leave one for each note after it.
    const last = slots.length - 1 - (count - 1 - k);
    const candidates: number[] = [];
    for (let j = current + 1; j <= last; j += 1) candidates.push(j);
    const gapShare = (j: number) =>
      scene.plan.rhythm.interOnsetShares[
        ioiBinIndex((slots[j] as number) - (slots[current] as number))
      ] ?? 0;
    let weights = candidates.map((j) => (levelWeight[j] as number) * gapShare(j));
    if (!weights.some((w) => w > 0)) weights = candidates.map((j) => levelWeight[j] as number);
    if (!weights.some((w) => w > 0)) weights = candidates.map(() => 1);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let target = draw.float(0, 1, phraseIndex, 'onset', startBeat, k) * total;
    let pick = candidates.length - 1;
    for (let c = 0; c < candidates.length; c += 1) {
      target -= weights[c] as number;
      if (target < 0) {
        pick = c;
        break;
      }
    }
    current = candidates[pick] as number;
    onsets.push(slots[current] as number);
  }
  return notesAt(onsets, endBeat);
}

/**
 * A root's rhythm: its plan's onset gaps laid from the statement's start, the
 * last note lasting to its end, or onsets drawn when the plan carries none.
 */
function placeRhythm(scene: Scene, motif: PlannedMotif): MotifNote[] {
  const { rhythm, startBeat, endBeat, notes } = motif;
  if (rhythm === null) {
    return drawOnsets(scene, motif.phrase, startBeat, endBeat, notes);
  }
  const onsets = [startBeat];
  for (const gap of rhythm) {
    onsets.push((onsets.at(-1) as number) + gap);
  }
  return notesAt(onsets, endBeat);
}

/** Choose pitches for a rhythm by the chain search over each note's candidates, or fail at the phrase. */
function searchedLine(rhythm: readonly MotifNote[], frame: PhraseFrame): MotifNote[] {
  const slots: PitchSlot[] = rhythm.map((note) => ({
    candidates: frame.candidatesAt(note.startBeat),
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

/** A motif statement's notes: written for a root, placed from its source otherwise. */
function statementOf(scene: Scene, m: number): MotifNote[] {
  const known = scene.statements.get(m);
  if (known !== undefined) {
    return known;
  }
  scene.inProgress.add(m);
  const motif = scene.plan.motifs[m] as PlannedMotif;
  const frame = scene.frames[motif.phrase] as PhraseFrame;
  let notes: MotifNote[];
  if (motif.from === null) {
    if (motif.endBeat - motif.startBeat <= BEAT_EPS) {
      throw new NoSolutionError(`root motif ${m} spans no time to place its notes in`, {
        at: frame.at,
      });
    }
    notes = searchedLine(placeRhythm(scene, motif), frame);
  } else {
    const source = statementOf(scene, motif.from);
    notes =
      motif.relation === null
        ? varyStatement(source, motif.startBeat, frame)
        : placeDerived(
            source,
            motif.relation,
            motif.startBeat,
            motif.endBeat,
            scaleAt(scene, motif.startBeat),
            frame,
            lineBefore(scene, motif.phrase, motif.startBeat),
          );
  }
  scene.inProgress.delete(m);
  scene.statements.set(m, notes);
  return notes;
}

/** How many notes a span no motif covers carries: the phrase's density over its bars, at least one. */
function freeNoteCount(scene: Scene, index: number, segment: Segment): number {
  const phrase = scene.plan.phrases[index] as PlannedPhrase;
  const bars = barSpanOf(segment.startBeat, segment.endBeat, scene.plan.meters);
  return Math.max(1, Math.round(phrase.onsetDensity * bars));
}

/** Fill a span no motif covers with drawn onsets and searched pitches. */
function freeSpan(scene: Scene, index: number, segment: Segment): MotifNote[] {
  const key = `${index}:${segment.startBeat}`;
  const known = scene.free.get(key);
  if (known !== undefined) {
    return known;
  }
  const rhythm = drawOnsets(
    scene,
    index,
    segment.startBeat,
    segment.endBeat,
    freeNoteCount(scene, index, segment),
  );
  const notes = searchedLine(rhythm, scene.frames[index] as PhraseFrame);
  scene.free.set(key, notes);
  return notes;
}

/**
 * A phrase's notes in the segments that end by `beat`: the line a statement
 * starting there is read after. A statement still being placed is left out,
 * as it cannot be the context of its own source.
 */
function lineBefore(scene: Scene, index: number, beat: number): MotifNote[] {
  const line: MotifNote[] = [];
  for (const segment of segmentsOf(scene, index)) {
    if (segment.endBeat > beat + BEAT_EPS) {
      break;
    }
    if (segment.motif === null) {
      line.push(...freeSpan(scene, index, segment));
    } else if (!scene.inProgress.has(segment.motif)) {
      line.push(...statementOf(scene, segment.motif));
    }
  }
  return line.sort((a, b) => a.startBeat - b.startBeat);
}

/** The downbeat of a phrase's final bar, or the phrase start when that comes later. */
function finalDownbeat(scene: Scene, index: number): number {
  const phrase = scene.plan.phrases[index] as PlannedPhrase;
  const { meters } = scene.plan;
  let downbeat = barStartBeat(phrase.startBeat, meters);
  while (downbeat + beatsPerBarAt(downbeat, meters) < phrase.endBeat - BEAT_EPS) {
    downbeat += beatsPerBarAt(downbeat, meters);
  }
  return Math.max(downbeat, phrase.startBeat);
}

/**
 * The note a phrase closes on: the one sounding at its final bar's downbeat,
 * else the first onset after that downbeat; -1 when the final bar is silent.
 */
function heldNoteIndex(
  scene: Scene,
  index: number,
  line: readonly MotifNote[],
  downbeat: number,
): number {
  const phrase = scene.plan.phrases[index] as PlannedPhrase;
  const sounding = line.findIndex(
    (note) =>
      note.startBeat <= downbeat + BEAT_EPS &&
      note.startBeat + note.durationBeat > downbeat + BEAT_EPS,
  );
  return sounding >= 0
    ? sounding
    : line.findIndex(
        (note) =>
          note.startBeat >= downbeat - BEAT_EPS && note.startBeat < phrase.endBeat - BEAT_EPS,
      );
}

/**
 * Bend a phrase's closing note onto its cadence, holding every other note: the
 * note at `held`, or the last pulse note when that is -1. Mutates the note
 * in place, so a statement shared with a later derivation carries the repaired
 * pitch into it.
 */
function repairCadence(scene: Scene, index: number, line: MotifNote[], held: number): void {
  const phrase = scene.plan.phrases[index] as PlannedPhrase;
  if (phrase.cadence === null) {
    return;
  }
  let target = held;
  for (let i = line.length - 1; target < 0 && i >= 0; i -= 1) {
    if (positionClass((line[i] as MotifNote).startBeat, scene.plan.meters) !== 'off') {
      target = i;
    }
  }
  if (target < 0) {
    return;
  }
  const note = line[target] as MotifNote;
  const allowed = cadencePitchClasses(scene.plan, scene.timeline, phrase.cadence, note.startBeat);
  if (allowed === null) {
    return;
  }
  const frame = scene.frames[index] as PhraseFrame;
  const candidates = registerPitches(phrase).filter((pitch) =>
    allowed.includes(pitchClassOf(pitch)),
  );
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

/**
 * Re-choose the onset a phrase-final hold cut at the downbeat from the pitches
 * its position admits, holding every other note. A cadence note is left to
 * cadence repair, and a note inside a derived statement to its transformation.
 */
function repickCutOnset(scene: Scene, index: number, line: MotifNote[], held: number): void {
  const note = line[held] as MotifNote;
  const derived = scene.plan.motifs.some(
    (motif) =>
      motif.from !== null &&
      note.startBeat >= motif.startBeat - BEAT_EPS &&
      note.startBeat < motif.endBeat - BEAT_EPS,
  );
  if ((scene.plan.phrases[index] as PlannedPhrase).cadence !== null || derived) {
    return;
  }
  const frame = scene.frames[index] as PhraseFrame;
  const candidates = frame.candidatesAt(note.startBeat);
  if (candidates.includes(note.pitch)) {
    return;
  }
  const slots: PitchSlot[] = line.map((n, i) =>
    i === held
      ? { candidates, cost: frame.costAt(n.startBeat), fixed: false }
      : { candidates: [n.pitch], cost: () => 0, fixed: true },
  );
  const pitches = searchPitches(slots, frame.budget);
  if (pitches === null) {
    throw new NoSolutionError(`no pitch at the final downbeat joins its neighbours`, {
      at: frame.at,
    });
  }
  line[held] = { ...note, pitch: pitches[held] as number };
}

/** A phrase's notes before cadence repair, in time order. */
function phraseLine(scene: Scene, index: number): MotifNote[] {
  const line: MotifNote[] = [];
  for (const segment of segmentsOf(scene, index)) {
    line.push(
      ...(segment.motif === null
        ? freeSpan(scene, index, segment)
        : statementOf(scene, segment.motif)),
    );
  }
  return line.sort((a, b) => a.startBeat - b.startBeat);
}

/**
 * Charge the pitch search against the budget before any search runs: every
 * searched note of a root, a variation or a free span over the phrase's
 * register, plus every level a derived statement is replayed at.
 */
function chargePitchSearch(scene: Scene): void {
  const { plan } = scene;
  let estimate = 0;
  plan.phrases.forEach((phrase, index) => {
    let searched = 0;
    for (const segment of segmentsOf(scene, index)) {
      const motif = segment.motif === null ? undefined : plan.motifs[segment.motif];
      if (motif === undefined) {
        searched += freeNoteCount(scene, index, segment);
      } else if (motif.relation === null) {
        searched += motif.notes;
      } else {
        estimate += motif.notes * relationLevels(motif.relation.kind).length;
      }
    }
    const register = Math.max(0, phrase.register.high - phrase.register.low + 1);
    estimate += searched * SEARCH_STATES_SQUARED * register * register;
  });
  assertGenerationBudget(estimate, 'melody pitch search', scene.budget);
}

/**
 * Write a melody that follows a composition plan.
 *
 * Each phrase is written inside its planned register, and every note the
 * generator chooses freely takes a pitch its position class admits: a chord
 * tone on a strong pulse, a scale tone on a weak one, any pitch off the pulses.
 * A root motif takes the onset gaps its plan carries from its start, its last
 * note lasting to its end, or onsets drawn one after another on the sixteenth
 * grid toward the plan's onset levels and gap shares; its pitches come from a chain
 * search that moves by step, recovers from leaps and follows the phrase's
 * target shape. A derived motif replays its planned relation on the statement
 * it derives from, starting on its planned beat, at the pitch level inside the
 * register that best fits the harmony, the target curve and the planned level;
 * a harmony misfit it keeps is left, and only notes no level brings inside the
 * register are replaced. A variation keeps its source's rhythm and outer
 * pitches. The spans no motif covers get drawn onsets at the phrase's density
 * and searched pitches. In each phrase's final bar, the note sounding at the
 * downbeat (or the first onset after it) is held to the phrase's end, later
 * onsets are dropped, and that note is bent onto the tones the phrase's
 * cadence asks for; a note sounding across the downbeat is cut there, and the
 * downbeat becomes the held onset, re-chosen from the pitches the downbeat
 * admits unless a cadence or a derived statement decides it. Onsets fall on the sixteenth grid only, so
 * triplets never appear.
 *
 * Harmony is read from the plan alone, through {@link planTimeline}.
 *
 * @param plan The plan to follow; validated first.
 * @param opts Context and budget.
 * @returns The melody, in time order.
 * @throws {InvalidInputError} If the plan, the options or the context are
 *   malformed, or the context supplies an `rng`.
 * @throws {NoSolutionError} If a phrase's register admits no line, no pitch a
 *   position asks for, no pitch that ends its cadence, or a span more onsets
 *   than its grid holds; `at` is the phrase's start beat.
 * @throws {BudgetExceededError} If the onset grid or the pitch search would
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
 *   motifs: [{ phrase: 0, startBeat: 0, endBeat: 4, notes: 4, rhythm: [1, 1, 1], from: null, relation: null }],
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
  const timeline = planTimeline(plan);
  const scene: Scene = {
    plan,
    ctx: melodyContext(plan, asked.ctx),
    budget: asked.budget,
    timeline,
    harmonyMisfits: planHarmonyMisfits(plan, timeline),
    scales: plan.keys.map((key) => scaleOf(key)),
    members: membersOf(plan),
    frames: [],
    statements: new Map(),
    free: new Map(),
    inProgress: new Set(),
  };
  scene.frames = plan.phrases.map((_, index) => frameOf(scene, index));
  chargePitchSearch(scene);
  const melody: MotifNote[] = [];
  plan.phrases.forEach((_, index) => {
    const line = phraseLine(scene, index);
    const downbeat = finalDownbeat(scene, index);
    let held = heldNoteIndex(scene, index, line, downbeat);
    if (held >= 0) {
      line.length = held + 1;
      const note = line[held] as MotifNote;
      if (note.startBeat < downbeat - BEAT_EPS) {
        // Cut at the downbeat, which becomes the onset the phrase is held on.
        const cut = downbeat - note.startBeat;
        line[held] = { ...note, durationBeat: cut };
        line.push({ ...note, startBeat: downbeat, durationBeat: note.durationBeat - cut });
        held += 1;
        repickCutOnset(scene, index, line, held);
      }
    }
    repairCadence(scene, index, line, held);
    if (held >= 0) {
      // A copy, so the statements later derivations replay keep their own length.
      const note = line[held] as MotifNote;
      const phraseEnd = (plan.phrases[index] as PlannedPhrase).endBeat;
      line[held] = { ...note, durationBeat: phraseEnd - note.startBeat };
    }
    melody.push(...line);
  });
  melody.sort((a, b) => a.startBeat - b.startBeat);
  return motifToNoteEvents({ notes: melody });
}
