/**
 * The transformation rules that deform a remembered figure into the one this
 * bar needs.
 *
 * The division of labour is the whole point of keeping these separate from the
 * dictionary: **genre selects the material, complexity deforms it, difficulty
 * rejects it.** A transform therefore never consults a genre and never consults
 * a ceiling — it takes the figure it is given and reshapes it, and whether the
 * result is playable is decided afterwards, by {@link withinCeiling}.
 *
 * Every figure is a list of onsets on a sixteenth grid, whatever it is made of,
 * so the rules are written once and used by both the bass and the drums.
 */

import { assertRange } from '../../core/validation/index.js';
import { sustainsStrokes } from '../context/difficulty.js';
import type { Draw } from '../context/draw.js';

/** Sixteenth steps in one 4/4 bar; the grid every figure is written on. */
export const BAR_STEPS = 16;

/** Sixteenth steps in one quarter-note beat. */
export const BEAT_STEPS = 4;

/** One sixteenth expressed in quarter-note beats. */
export const STEP_BEATS = 1 / BEAT_STEPS;

/**
 * An onset on the shared sixteenth grid.
 *
 * Both kinds of material are lists of these with their own extra fields, so a
 * transform is generic over the record and only ever reads the fields named
 * here.
 *
 * @category Composition
 */
export type GridEvent = {
  /** Sixteenth-note index from the start of the figure. */
  step: number;
  /** Loudness as a factor of the passage's base velocity. */
  velocity: number;
  /**
   * The voice this onset is played on, where the material has more than one.
   * A figure written for a single voice — a bass lick — leaves it out.
   */
  voice?: string;
  /**
   * The limb that plays it, where the material names one. It outranks
   * {@link GridEvent.voice} as the stream an onset belongs to, since what
   * crowds a player is one limb rather than one drum.
   */
  limb?: string;
};

/**
 * The stream an onset belongs to: its limb, else its voice, else the one
 * stream a single-voice figure has.
 *
 * Transforms and the ceiling both group by this. Two hands are two players, so
 * a ghost snare neither blocks a hi-hat from anticipating nor makes the pair
 * count as one limb repeating.
 */
function streamOf(event: GridEvent): string {
  return event.limb ?? event.voice ?? '';
}

/**
 * How strongly a position on the sixteenth grid is felt, from 4 (the downbeat)
 * to 0 (an off sixteenth).
 *
 * This is the ranking the thinning rule works down: the notes a player drops
 * first when asked for something easier are the ones carrying the least of the
 * metre. It is named for the grid it reads because the analysis layer has a
 * metric weight of its own, on another scale and against a time signature; the
 * two answer different questions and are deliberately not the same function.
 *
 * @param step Sixteenth index within the bar.
 * @returns The weight, 0 to 4.
 *
 * @category Composition
 */
export function gridMetricWeight(step: number): number {
  const inBar = ((step % BAR_STEPS) + BAR_STEPS) % BAR_STEPS;
  if (inBar === 0) {
    return 4;
  }
  if (inBar % 8 === 0) {
    return 3;
  }
  if (inBar % 4 === 0) {
    return 2;
  }
  if (inBar % 2 === 0) {
    return 1;
  }
  return 0;
}

/**
 * Drop the notes carrying the least of the metre.
 *
 * The easing direction: at 0 nothing is dropped, and as the amount rises whole
 * ranks of positions go, off sixteenths first and the downbeat last. It is a
 * ranking rather than a sampling, so the same amount always removes the same
 * notes and a caller can explain which ones went.
 *
 * @param events The figure.
 * @param amount How much to thin, in [0, 1].
 * @returns The surviving events, in the order given.
 *
 * @category Composition
 */
export function thin<T extends GridEvent>(events: readonly T[], amount: number): T[] {
  assertRange(amount, 0, 1, 'thin amount');
  // Five ranks (0..4), so a full turn of the dial reaches the downbeat alone.
  const floor = Math.min(4, Math.floor(amount * 5));
  return events.filter((event) => gridMetricWeight(event.step) >= floor);
}

/**
 * Fill in the gaps of a figure, one note per gap.
 *
 * Doubling is what a player does when asked for more of the same rather than
 * for something different: the added note sits halfway between two the figure
 * already has, takes its predecessor's identity, and is played softer.
 *
 * @param events The figure, which need not be sorted.
 * @param spanSteps Length of the figure in sixteenths.
 * @returns The figure with the midpoints filled, sorted by position.
 *
 * @category Composition
 */
export function double<T extends GridEvent>(events: readonly T[], spanSteps = BAR_STEPS): T[] {
  const sorted = [...events].sort((a, b) => a.step - b.step);
  const out: T[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const event = sorted[i];
    if (!event) {
      continue;
    }
    out.push(event);
    const next = sorted[i + 1]?.step ?? spanSteps;
    const mid = event.step + (next - event.step) / 2;
    // Only where the grid has a position for it: a gap of one sixteenth is
    // already as dense as the figure is written.
    if (Number.isInteger(mid) && mid > event.step && mid < spanSteps) {
      out.push({ ...event, step: mid, velocity: event.velocity * ADDED_NOTE_VELOCITY });
    }
  }
  return out;
}

/** How loud a note added by a transform is, relative to the one it follows. */
const ADDED_NOTE_VELOCITY = 0.75;

/**
 * Stretch a figure to twice its length: everything falls half as often.
 *
 * @param events The figure.
 * @param spanSteps Length of the figure in sixteenths; notes stretched past it
 *   are dropped, since the bar is the bar however the figure is felt.
 * @returns The stretched figure.
 *
 * @category Composition
 */
export function halfTime<T extends GridEvent>(events: readonly T[], spanSteps = BAR_STEPS): T[] {
  return events
    .map((event) => ({ ...event, step: event.step * 2 }))
    .filter((event) => event.step < spanSteps);
}

/**
 * Compress a figure to half its length and play it twice.
 *
 * The repeat is what makes this the mirror of {@link halfTime} rather than a
 * figure with a hole in it: the bar stays full.
 *
 * @param events The figure.
 * @param spanSteps Length of the figure in sixteenths.
 * @returns The compressed figure, repeated to fill the span.
 *
 * @category Composition
 */
export function doubleTime<T extends GridEvent>(events: readonly T[], spanSteps = BAR_STEPS): T[] {
  const out: T[] = [];
  for (const event of events) {
    // An odd step halves onto no grid position, so it is placed on the nearest
    // one. Dropping it instead took the "a" of the kick and three of the four
    // ghosts out of the figure that names the genre, and returned the result as
    // though it were the same figure played faster.
    const step = Math.round(event.step / 2);
    out.push({ ...event, step });
    const repeated = step + spanSteps / 2;
    if (repeated < spanSteps) {
      out.push({ ...event, step: repeated, velocity: event.velocity * ADDED_NOTE_VELOCITY });
    }
  }
  return out.sort((a, b) => a.step - b.step);
}

/**
 * Anticipate beats, one sixteenth early.
 *
 * Anticipation is the direction syncopation runs in every genre this library
 * names: the note arrives before the beat it belongs to. It is written as an
 * addition rather than a displacement — the anticipating stroke is softer, and
 * the note it anticipates stays where it was, the way a player ties into the
 * beat rather than abandoning it — because this is one of the dials that only
 * ever add material. Displacing instead would move onsets around under the
 * finger of anyone who puts the dial on a slider, and a saved project reopened
 * one notch along would not contain the piece it was. Which beats are
 * anticipated is fixed by position, so the bar next door is unaffected either
 * way.
 *
 * A position already taken blocks the anticipation only within the same stream
 * — the same limb, else the same voice. A ghost snare sitting where the hi-hat
 * wants to anticipate is another hand playing, not an obstacle, and whether two
 * limbs can actually strike together is the playability layer's question rather
 * than this one's.
 *
 * @param events The figure.
 * @param amount How much syncopation, in [0, 1].
 * @param draw The position-addressed sampler.
 * @param path Where the figure sits, so the same bar always syncopates alike.
 * @returns The figure with its anticipations, sorted by position.
 *
 * @category Composition
 */
export function syncopate<T extends GridEvent>(
  events: readonly T[],
  amount: number,
  draw: Draw,
  ...path: readonly (string | number)[]
): T[] {
  assertRange(amount, 0, 1, 'syncopate amount');
  const occupied = new Set(events.map((event) => `${streamOf(event)}@${event.step}`));
  const out: T[] = [...events];
  for (const event of events) {
    const anticipated = event.step - 1;
    // The downbeat takes none: its anticipation would fall in the bar before
    // the one the figure belongs to.
    if (
      gridMetricWeight(event.step) < 2 ||
      anticipated < 1 ||
      occupied.has(`${streamOf(event)}@${anticipated}`)
    ) {
      continue;
    }
    if (!draw.prob(amount, ...path, 'syncopate', event.step)) {
      continue;
    }
    out.push({ ...event, step: anticipated, velocity: event.velocity * ADDED_NOTE_VELOCITY });
  }
  return out.sort((a, b) => a.step - b.step);
}

/**
 * How much decoration a figure keeps.
 *
 * A decorated note — a ghost, a flam, anything the figure marks as ornament —
 * survives on its own draw, so raising the dial only ever brings more of them
 * back and never disturbs the ones already sounding. Notes that are not
 * decoration are untouched.
 *
 * @param events The figure.
 * @param isOrnament Which events count as decoration.
 * @param amount The ornament dial, in [0, 1].
 * @param draw The position-addressed sampler.
 * @param path Where the figure sits.
 * @returns The figure with the surviving decoration.
 *
 * @category Composition
 */
export function ornamentBy<T extends GridEvent>(
  events: readonly T[],
  isOrnament: (event: T) => boolean,
  amount: number,
  draw: Draw,
  ...path: readonly (string | number)[]
): T[] {
  assertRange(amount, 0, 1, 'ornament amount');
  return events.filter(
    (event) => !isOrnament(event) || draw.prob(amount, ...path, 'ornament', event.step),
  );
}

/**
 * Everything the complexity dials do to a figure, in one pass.
 *
 * @category Composition
 */
export type DeformOptions = {
  /**
   * Subdivision and syncopation, in [0, 1]. Below the neutral middle the figure
   * is thinned; above it, syncopated. The middle leaves it as the dictionary
   * wrote it, which is what makes the dictionary the thing a reader can check.
   */
  rhythmic?: number;
  /** Ghosts and decoration, in [0, 1]; absent keeps every ornament. */
  ornament?: number;
  /** Which events are decoration, for the ornament dial. */
  isOrnament?: (event: GridEvent) => boolean;
  /**
   * Rate: stretch or compress the figure before the dials are applied. It is
   * named for what it does to the note values, since "feel" elsewhere in the
   * drum surface names the swing a figure is played with — a different
   * question, asked of the same figure.
   */
  rate?: 'straight' | 'half' | 'double';
  /** Length of the figure in sixteenths. */
  spanSteps?: number;
};

/** The rhythmic setting at which a figure is left as written. */
const NEUTRAL_RHYTHMIC = 0.5;

/**
 * Apply the complexity dials to a figure.
 *
 * This is the one place complexity touches vocabulary: genre has already chosen
 * the material, and the ceiling has not been consulted yet.
 *
 * @param events The figure.
 * @param opts What the dials say.
 * @param draw The position-addressed sampler.
 * @param path Where the figure sits.
 * @returns The deformed figure, sorted by position.
 *
 * @example
 * ```ts
 * import { deform, resolveContext } from '@libraz/libcantus';
 * const figure = [
 *   { step: 0, velocity: 1, limb: 'kick' },
 *   { step: 4, velocity: 0.9, limb: 'snare' },
 *   { step: 8, velocity: 1, limb: 'kick' },
 *   { step: 12, velocity: 0.9, limb: 'snare' },
 * ];
 * const draw = resolveContext(7).part('drums');
 * const busier = deform(figure, { rhythmic: 0.9 }, draw, 'bar', 0);
 * // Above the neutral middle the figure is syncopated: onsets are added off
 * // the beat, and the result comes back sorted by position.
 * busier.length; // 7
 * busier.map((event) => event.step); // [0, 3, 4, 7, 8, 11, 12]
 * ```
 *
 * @category Composition
 */
export function deform<T extends GridEvent>(
  events: readonly T[],
  opts: DeformOptions,
  draw: Draw,
  ...path: readonly (string | number)[]
): T[] {
  const spanSteps = opts.spanSteps ?? BAR_STEPS;
  let out: T[] =
    opts.rate === 'half'
      ? halfTime(events, spanSteps)
      : opts.rate === 'double'
        ? doubleTime(events, spanSteps)
        : [...events];

  if (opts.rhythmic !== undefined) {
    const rhythmic = assertRange(opts.rhythmic, 0, 1, 'complexity rhythmic');
    if (rhythmic < NEUTRAL_RHYTHMIC) {
      // Below the middle the request is for less, and less means the notes that
      // carry the least of the metre.
      out = thin(out, (NEUTRAL_RHYTHMIC - rhythmic) / NEUTRAL_RHYTHMIC);
    } else if (rhythmic > NEUTRAL_RHYTHMIC) {
      out = syncopate(out, (rhythmic - NEUTRAL_RHYTHMIC) / NEUTRAL_RHYTHMIC, draw, ...path);
    }
  }

  if (opts.ornament !== undefined && opts.isOrnament) {
    const isOrnament = opts.isOrnament;
    out = ornamentBy(out, (event) => isOrnament(event), opts.ornament, draw, ...path);
  }

  return out.sort((a, b) => a.step - b.step);
}

/**
 * Whether a figure is inside the difficulty ceiling at this tempo.
 *
 * The ceiling is measured against the closest pair of onsets the figure asks
 * one player for, which is the thing that actually stops a hand — so the pairs
 * are counted within a stream (the limb, else the voice) rather than across the
 * whole kit, because a hi-hat and a kick a sixteenth apart are two limbs and not
 * one hand playing twice. A figure that fails is rejected — never quietly
 * simplified, because a simplified figure is a different figure and the caller
 * asked for this one.
 *
 * @param events The figure.
 * @param bpm Tempo, or undefined when the caller gave none.
 * @param difficulty The ceiling, or undefined for no ceiling.
 * @returns True when the figure is playable at the ceiling, and whenever either
 *   the ceiling or the tempo is unknown.
 *
 * @category Composition
 */
export function withinCeiling(
  events: readonly GridEvent[],
  bpm: number | undefined,
  difficulty: number | undefined,
): boolean {
  if (difficulty === undefined || bpm === undefined || events.length < 2) {
    return true;
  }
  const byStream = new Map<string, Set<number>>();
  for (const event of events) {
    const stream = streamOf(event);
    const steps = byStream.get(stream);
    if (steps) {
      steps.add(event.step);
    } else {
      byStream.set(stream, new Set([event.step]));
    }
  }
  let closest = Number.POSITIVE_INFINITY;
  for (const stream of byStream.values()) {
    const steps = [...stream].sort((a, b) => a - b);
    for (let i = 1; i < steps.length; i += 1) {
      const gap = (steps[i] ?? 0) - (steps[i - 1] ?? 0);
      if (gap > 0 && gap < closest) {
        closest = gap;
      }
    }
  }
  if (!Number.isFinite(closest)) {
    return true;
  }
  return sustainsStrokes(closest * STEP_BEATS, bpm, difficulty);
}
