/**
 * Voice independence as a measurement rather than a verdict.
 *
 * The species rules answer "is this allowed", which is the wrong question of a
 * pop arrangement: a harmony line in parallel thirds, a power-chord riff and a
 * pedal point all break them and all are the intended sound. This module
 * reports how independent two lines actually are and leaves the judgement to
 * the caller.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import { ConsonanceClass } from '../../core/interval/index.js';
import type { Note } from '../../core/pitch/index.js';
import { spelledInterval } from '../../core/pitch/index.js';
import { assertArray, assertOptions } from '../../core/validation/index.js';
import { classifySpelledInterval, pitchOf, simpleIntervalNumber } from './internal.js';

/**
 * How two lines move against each other, and how far apart they sit.
 *
 * @category Voicing & Counterpoint
 */
export type VoiceIndependenceReport = {
  /**
   * Share of the moves that fall into each motion type, summing to 1. A slot
   * pair in which neither voice moves is not a move and is left out entirely,
   * so an accompaniment that mostly sits still can still report mostly contrary
   * motion. All four are 0 when nothing moves.
   */
  motion: {
    /** The voices move in opposite directions. */
    contrary: number;
    /** One voice holds while the other moves. */
    oblique: number;
    /** Both rise or both fall, and the interval between them changes. */
    similar: number;
    /** Both rise or both fall, keeping the same interval. */
    parallel: number;
  };
  /**
   * Share of the slots where the lead holds or rests on which the counter
   * attacks: 1 when the counter fills every gap the lead leaves, 0 when it moves
   * only where the lead does. It is 0 when the lead never holds or rests, since
   * there was nothing to complement.
   */
  rhythmicComplementarity: number;
  /** Distance between the two lines, in semitones, over the slots where both sound. */
  separation: {
    /** Mean distance; 0 when the two lines never sound together. */
    mean: number;
    /** Closest approach; 0 when the two lines never sound together. */
    min: number;
  };
  /**
   * Slots at which the two lines sit in the opposite order to the one they keep
   * overall. A unison is not a crossing.
   */
  crossings: number;
  /** Longest run of consecutive slots sounding a perfect consonance. */
  longestPerfectRun: number;
  /** Slots at which both lines sound, the denominator of `separation`. */
  sounding: number;
};

/**
 * Options controlling {@link voiceIndependence}.
 *
 * @category Voicing & Counterpoint
 */
export type VoiceIndependenceOptions = {
  /**
   * Which slots are fresh attacks in the lead. Without it a slot counts as an
   * attack when its note differs from the previous slot's, which reads a
   * deliberately repeated note as a sustain.
   */
  leadAttacks?: readonly boolean[];
  /** Which slots are fresh attacks in the counter; read as `leadAttacks` is. */
  counterAttacks?: readonly boolean[];
  /**
   * Count the perfect fourth among the perfect consonances when measuring
   * `longestPerfectRun`. Useful for quartal writing, where the fourth is the
   * interval being sustained.
   *
   * @defaultValue false
   */
  countFourths?: boolean;
};

/** One slot of both lines, resolved to what the metrics read off it. */
type Slot = {
  lead: Note | null;
  counter: Note | null;
  leadPitch: number | null;
  counterPitch: number | null;
};

/** Whether a slot has both voices sounding. */
function bothSound(slot: Slot): slot is Slot & { lead: Note; counter: Note } {
  return slot.lead !== null && slot.counter !== null;
}

/** Whether a voice attacks at a slot, by the caller's flags or by note change. */
function attacksAt(
  index: number,
  notes: readonly (Note | null)[],
  flags: readonly boolean[] | undefined,
): boolean {
  if (flags !== undefined) {
    return flags[index] === true;
  }
  const current = notes[index];
  if (current === undefined || current === null) {
    return false;
  }
  const previous = index > 0 ? notes[index - 1] : undefined;
  if (previous === undefined || previous === null) {
    return true;
  }
  return (
    previous.letter !== current.letter ||
    previous.alter !== current.alter ||
    previous.octave !== current.octave
  );
}

/** The motion the two voices make between two adjacent sounding slots. */
function motionBetween(
  from: Slot & { lead: Note; counter: Note },
  to: Slot & { lead: Note; counter: Note },
): 'contrary' | 'oblique' | 'similar' | 'parallel' | null {
  const leadMove = pitchOf(to.lead) - pitchOf(from.lead);
  const counterMove = pitchOf(to.counter) - pitchOf(from.counter);
  if (leadMove === 0 && counterMove === 0) {
    return null;
  }
  if (leadMove === 0 || counterMove === 0) {
    return 'oblique';
  }
  if (leadMove > 0 !== counterMove > 0) {
    return 'contrary';
  }
  const before = simpleIntervalNumber(spelledInterval(from.counter, from.lead).number);
  const after = simpleIntervalNumber(spelledInterval(to.counter, to.lead).number);
  return before === after ? 'parallel' : 'similar';
}

/**
 * Measure how independent a counter line is from the lead it accompanies.
 *
 * Both lines are index-aligned samples: one slot per beat (or whatever grid the
 * caller works on), `null` for a rest, and a repeated note for a sustain. That
 * is what makes the rhythmic reading possible without a duration model, and
 * what makes a re-attacked repeated note look like a sustain unless
 * `leadAttacks` / `counterAttacks` say otherwise. Notes must carry octaves,
 * since separation and motion are measured between sounding pitches.
 *
 * Nothing here is a verdict. Parallel thirds report as parallel motion with a
 * small separation, a pedal point as oblique motion, a power-chord line as a
 * long perfect run — all facts about the texture, not faults in it.
 *
 * @param lead The leading line, one entry per slot.
 * @param counter The accompanying line, aligned slot for slot with `lead`.
 * @param opts Attack flags and the treatment of the fourth.
 * @returns The motion breakdown, rhythmic complementarity, separation,
 *   crossings, and the longest perfect-consonance run.
 * @throws If the two lines differ in length, if an attack array is supplied at
 *   another length than the lines, or if a note carries no octave.
 * @example
 * ```ts
 * import { parseNote, voiceIndependence } from '@libraz/libcantus';
 * const lead = ['C5', 'D5', 'E5'].map((n) => parseNote(n));
 * const counter = ['E4', 'F4', 'G4'].map((n) => parseNote(n));
 * voiceIndependence(lead, counter).motion.parallel; // 1 — a harmony line in sixths
 * ```
 * @category Voicing & Counterpoint
 */
export function voiceIndependence(
  lead: readonly (Note | null)[],
  counter: readonly (Note | null)[],
  opts?: VoiceIndependenceOptions,
): VoiceIndependenceReport {
  assertOptions(opts, 'opts');
  const upper = assertArray<Note | null>(lead, 'lead');
  const lower = assertArray<Note | null>(counter, 'counter');
  if (upper.length !== lower.length) {
    throw new InvalidInputError(
      `voiceIndependence needs the two lines aligned slot for slot; received ${upper.length} and ${lower.length}`,
    );
  }
  // The attack arrays are read slot by slot alongside the lines, so one of the
  // wrong length is not a shorter reading of the same texture but a silently
  // wrong one: every slot past its end would count as a sustain.
  for (const [name, flags] of [
    ['leadAttacks', opts?.leadAttacks],
    ['counterAttacks', opts?.counterAttacks],
  ] as const) {
    if (flags !== undefined && flags.length !== upper.length) {
      throw new InvalidInputError(
        `voiceIndependence needs ${name} aligned slot for slot with the lines; received ${flags.length} and ${upper.length}`,
      );
    }
  }
  const slots: Slot[] = upper.map((leadNote, index) => {
    const counterNote = lower[index] ?? null;
    return {
      lead: leadNote,
      counter: counterNote,
      leadPitch: leadNote === null ? null : pitchOf(leadNote),
      counterPitch: counterNote === null ? null : pitchOf(counterNote),
    };
  });

  const counts = { contrary: 0, oblique: 0, similar: 0, parallel: 0 };
  let moves = 0;
  for (let index = 1; index < slots.length; index += 1) {
    const from = slots[index - 1];
    const to = slots[index];
    if (from === undefined || to === undefined || !bothSound(from) || !bothSound(to)) {
      continue;
    }
    const motion = motionBetween(from, to);
    if (motion === null) {
      continue;
    }
    counts[motion] += 1;
    moves += 1;
  }

  let filled = 0;
  let gaps = 0;
  for (let index = 0; index < slots.length; index += 1) {
    const leadHolds = !attacksAt(index, lead, opts?.leadAttacks);
    if (!leadHolds) {
      continue;
    }
    gaps += 1;
    if (attacksAt(index, counter, opts?.counterAttacks)) {
      filled += 1;
    }
  }

  let sounding = 0;
  let totalGap = 0;
  let minGap = Number.POSITIVE_INFINITY;
  let orderSum = 0;
  let perfectRun = 0;
  let longestPerfectRun = 0;
  for (const slot of slots) {
    if (slot.leadPitch === null || slot.counterPitch === null) {
      perfectRun = 0;
      continue;
    }
    sounding += 1;
    const gap = slot.leadPitch - slot.counterPitch;
    totalGap += Math.abs(gap);
    minGap = Math.min(minGap, Math.abs(gap));
    orderSum += Math.sign(gap);
    const interval = spelledInterval(slot.counter as Note, slot.lead as Note);
    const perfect =
      classifySpelledInterval(interval) === ConsonanceClass.PerfectConsonance ||
      ((opts?.countFourths ?? false) &&
        interval.quality === 'P' &&
        simpleIntervalNumber(interval.number) === 4);
    perfectRun = perfect ? perfectRun + 1 : 0;
    longestPerfectRun = Math.max(longestPerfectRun, perfectRun);
  }

  // The prevailing order is whichever way round the two lines sit most of the
  // time; a line written above the lead is as ordinary as one written below, and
  // only the departures from its own habit count as crossings.
  const leadAbove = orderSum >= 0;
  let crossings = 0;
  for (const slot of slots) {
    if (slot.leadPitch === null || slot.counterPitch === null) {
      continue;
    }
    const gap = slot.leadPitch - slot.counterPitch;
    if (gap !== 0 && gap > 0 !== leadAbove) {
      crossings += 1;
    }
  }

  return {
    motion: {
      contrary: moves === 0 ? 0 : counts.contrary / moves,
      oblique: moves === 0 ? 0 : counts.oblique / moves,
      similar: moves === 0 ? 0 : counts.similar / moves,
      parallel: moves === 0 ? 0 : counts.parallel / moves,
    },
    rhythmicComplementarity: gaps === 0 ? 0 : filled / gaps,
    separation: {
      mean: sounding === 0 ? 0 : totalGap / sounding,
      min: sounding === 0 ? 0 : minGap,
    },
    crossings,
    longestPerfectRun,
    sounding,
  };
}
