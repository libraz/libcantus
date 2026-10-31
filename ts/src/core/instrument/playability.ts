import { canonicalNoteOrder, soundingIndices } from '../event-index/order.js';
import { BEAT_EPS } from '../meter/internal.js';
import type { NoteEvent } from '../types.js';
import { assertNoteEvents, assertRange } from '../validation/index.js';
import {
  fingeringsIn,
  type InstrumentProfileLike,
  type Limb,
  reachOf,
  type StringFingering,
  soundsIn,
  toInstrumentProfile,
  type ValidatedPercussionProfile,
  type ValidatedProfile,
  type ValidatedStringedProfile,
} from './profile.js';

/**
 * What makes a passage hard or impossible on an instrument.
 *
 * `noteOutOfRange` and `articulationUnavailable` belong to the first layer: the
 * instrument has no position for what was written. `stringConflict`,
 * `stretchTooWide`, `limbConflict` and `polyphonyExceeded` belong to the second:
 * the notes exist but the arrangement cannot be held or struck. `tooFast`
 * belongs to the third, the only one that depends on tempo.
 *
 * @category Core
 */
export type PlayabilityIssueType =
  | 'noteOutOfRange'
  | 'articulationUnavailable'
  | 'stringConflict'
  | 'stretchTooWide'
  | 'limbConflict'
  | 'polyphonyExceeded'
  | 'tooFast';

/**
 * Which playability layer an issue belongs to: 1 the note does not exist, 2 the
 * arrangement does not hold together, 3 there is not enough time.
 *
 * @category Core
 */
export type PlayabilityLayer = 1 | 2 | 3;

/**
 * One thing standing between a passage and a performance of it.
 *
 * @category Core
 */
export type PlayabilityIssue = {
  type: PlayabilityIssueType;
  layer: PlayabilityLayer;
  /** Indices into the analysed note array, ascending. */
  notes: readonly number[];
  /** Where the problem occurs, in quarter-note beats. */
  startBeat: number;
  /**
   * True when practice cannot fix it. Layers 1 and 2 depend on the instrument
   * alone, so they are impossible however skilled the player; only a layer-3
   * issue is a matter of degree.
   */
  impossible: boolean;
  message: string;
};

/**
 * How one note is actually produced: the string and fret it is stopped at, or
 * the limb that strikes it.
 *
 * This is reported for every note that has a position at all, whether or not
 * the passage raises issues, so a caller can apply its own standard rather than
 * take this module's.
 *
 * @category Core
 */
export type NotePlacement = {
  /** Index into the analysed note array. */
  note: number;
  /** String instruments: where the note is stopped. */
  fingering?: StringFingering;
  /** Percussion: which limb plays the stroke. */
  limb?: Limb;
};

/**
 * The verdict on a passage: how hard it is, what stands in the way, and how
 * each note would be produced.
 *
 * @category Core
 */
export type PlayabilityReport = {
  /**
   * Movement per unit time, mapped onto 1 (trivial) to 5 (at the limit).
   * Without a tempo the passage is measured at 120 BPM, so the number stays
   * comparable between passages; with one it rises as the tempo does.
   */
  difficulty: number;
  issues: PlayabilityIssue[];
  placements: NotePlacement[];
};

/** Tempo the difficulty is measured at when the caller gives none. */
export const REFERENCE_BPM = 120;
/** Fastest the fretting hand shifts along the neck, in frets per second. */
export const MAX_FRET_SHIFT_PER_SECOND = 100;
/** Shortest gap between two strokes of one limb, in seconds. */
export const MIN_LIMB_STROKE_SECONDS = 0.06;
/** Movement rate, in units per second, that reads as a demanding passage. */
export const DIFFICULTY_SCALE = 12;
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;
/** Cost of crossing one string, relative to moving one fret. */
export const STRING_CROSSING_COST = 2;
/** Onsets no further apart than this many beats count as simultaneous. */
export const SIMULTANEITY_BEATS = 1 / 128;
/**
 * Longest overlap, in beats, of a note past a later onset that still releases
 * it: a sixty-fourth note, which covers a legato or humanized line overlapping
 * its successor without reading it as a note held under the next one.
 */
export const LEGATO_OVERLAP_BEATS = 1 / 16;

/** Working state shared by both instrument families. */
type Analysis = {
  notes: readonly NoteEvent[];
  /** Note indices in onset order, ties broken by pitch. */
  order: number[];
  placements: NotePlacement[];
  issues: PlayabilityIssue[];
  /** Accumulated movement, in frets or strokes. */
  movement: number;
  /** Seconds per quarter-note beat, or undefined when no tempo was given. */
  secondsPerBeat: number | undefined;
};

/**
 * Judge whether a passage can be played on an instrument, and how hard it is.
 *
 * Inspection is deliberately separate from generation: this answers "can this
 * be played" for a chart handed to a player or a practice tool, and never
 * rewrites or rejects anything. The three layers are reported together but stay
 * distinct — an out-of-range note or an impossible stretch is not the bottom of
 * the difficulty scale but a different axis, since no amount of skill puts a
 * note on an instrument that does not have it. Only the third layer consults
 * `bpm`, so omitting the tempo reports what the instrument alone decides.
 *
 * @param notes The passage, in any order. Drum hits qualify as note events.
 * @param profile The instrument to play it on.
 * @param bpm Tempo in quarter-note beats per minute; enables the third layer.
 * @returns Difficulty, the issues found, and each note's string/fret or limb.
 * @throws If the notes are not note events, the tempo is not a finite positive
 *   number of beats per minute, or the profile describes no instrument — a neck
 *   with no strings or a kit no limb reaches, whatever the passage holds.
 *
 * @example
 * ```ts
 * import { BASS_4_STRING, playability } from '@libraz/libcantus';
 * const report = playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }], BASS_4_STRING);
 * report.issues[0]?.type; // 'noteOutOfRange'
 * ```
 * @category Core
 */
export function playability(
  notes: readonly NoteEvent[],
  profile: InstrumentProfileLike,
  bpm?: number,
): PlayabilityReport {
  assertNoteEvents(notes, 'playability notes', { allowNonPositiveDuration: true });
  if (bpm !== undefined) {
    assertRange(bpm, Number.MIN_VALUE, 1000, 'playability bpm');
  }
  // The profile is read once here, as every sibling in the module reads it
  // before answering: a contradictory instrument is refused whether or not the
  // passage happens to hold a note that would have exposed it.
  const instrument = toInstrumentProfile(profile, 'playability profile');

  const state: Analysis = {
    notes,
    order: canonicalNoteOrder(notes),
    placements: notes.map((_, index) => ({ note: index })),
    issues: [],
    movement: 0,
    secondsPerBeat: bpm === undefined ? undefined : 60 / bpm,
  };

  const attacks = timelineOf(state);
  if (instrument.kind === 'stringed') {
    checkExistence(state, instrument, (pitch) => soundsIn(instrument, pitch));
    placeOnNeck(state, instrument, attacks);
  } else {
    // The kit is read here rather than inside the note-by-note stages, which is
    // what makes the reading below a lookup: asking the profile per note walked
    // the reach table for every stroke of the track.
    const kit = readKit(instrument);
    checkExistence(state, instrument, (pitch) => limbsFor(kit, pitch).length > 0);
    placeOnKit(state, kit, attacks);
  }

  return {
    difficulty: difficultyOf(state, attacks, bpm),
    issues: state.issues,
    placements: state.placements,
  };
}

/**
 * Layer 1: the instrument has no position for the note, or no such technique.
 *
 * Whether the instrument has a pitch is asked through `sounds`, which the
 * caller has already read the instrument for: a kit answers out of the table it
 * built once, and reading the profile again per note is the cost this stage
 * used to carry.
 */
function checkExistence(
  state: Analysis,
  profile: ValidatedProfile,
  sounds: (pitch: number) => boolean,
): void {
  for (const index of state.order) {
    const note = state.notes[index];
    if (!note) {
      continue;
    }
    if (!sounds(note.pitch)) {
      state.issues.push({
        type: 'noteOutOfRange',
        layer: 1,
        notes: [index],
        startBeat: note.startBeat,
        impossible: true,
        message: `${profile.name} cannot sound MIDI ${note.pitch}`,
      });
    }
    // The note has been validated, so this names a technique the library knows:
    // the issue below says this instrument does not offer it, which is a fact
    // about the instrument rather than about the string that was written.
    const articulation = note.articulation;
    if (articulation !== undefined && !profile.articulations.includes(articulation)) {
      state.issues.push({
        type: 'articulationUnavailable',
        layer: 1,
        notes: [index],
        startBeat: note.startBeat,
        impossible: true,
        message: `${profile.name} cannot play ${articulation}`,
      });
    }
  }
}

/** One sounding note as every layer-2 and layer-3 check reads it. */
type TimedNote = {
  index: number;
  startBeat: number;
  endBeat: number;
  /** Onset of the attack the note is struck in. */
  attackBeat: number;
};

/** The sounding notes struck together, and the earlier ones still held under them. */
type Attack = {
  startBeat: number;
  /** The notes struck, by pitch and then by index. */
  members: TimedNote[];
  /** Notes of earlier attacks not yet released when this one lands. */
  held: TimedNote[];
};

/**
 * Whether a note ending at `endBeat` has let go by `beat`.
 *
 * A line played legato or humanized overlaps its successor by a few hundredths
 * of a beat; that overlap frees the string and the hand rather than holding the
 * note under the next one.
 */
function isReleased(endBeat: number, beat: number): boolean {
  return endBeat <= beat + LEGATO_OVERLAP_BEATS + BEAT_EPS;
}

/**
 * The passage as a timeline of attacks, built once for every check.
 *
 * Silent notes are left out, since they strike nothing. Simultaneity is the
 * distance between two onsets, never the cell each of them rounds into: two
 * strokes a ten-thousandth of a beat apart are one attack wherever a fixed grid
 * would happen to cut between them, and a part played by hand lands on no grid.
 */
function timelineOf(state: Analysis): Attack[] {
  const sounding = new Set(soundingIndices(state.notes));
  const attacks: Attack[] = [];
  let active: TimedNote[] = [];
  let current: Attack | undefined;
  for (const index of state.order) {
    const note = state.notes[index];
    if (!note || !sounding.has(index)) {
      continue;
    }
    if (!current || note.startBeat - current.startBeat > SIMULTANEITY_BEATS + BEAT_EPS) {
      const at = note.startBeat;
      active = active.filter((held) => !isReleased(held.endBeat, at));
      current = { startBeat: at, members: [], held: [...active] };
      attacks.push(current);
    }
    const timed: TimedNote = {
      index,
      startBeat: note.startBeat,
      endBeat: note.startBeat + note.durationBeat,
      attackBeat: current.startBeat,
    };
    current.members.push(timed);
    active.push(timed);
  }
  for (const attack of attacks) {
    attack.members.sort(
      (a, b) =>
        (state.notes[a.index]?.pitch ?? 0) - (state.notes[b.index]?.pitch ?? 0) ||
        a.index - b.index,
    );
  }
  return attacks;
}

/** Most notes of one attack that are placed jointly; a larger group keeps its greedy picks. */
const MAX_JOINT_PLACEMENT_NOTES = 12;
/** Most search nodes spent on one attack before the best placement found so far stands. */
const MAX_PLACEMENT_SEARCH_NODES = 20000;

/** One note of an attack waiting for a string. */
type NeckMember = TimedNote & { candidates: StringFingering[] };

/** Whether the fretted notes of a hand fit one maxStretch. */
function fitsHand(frets: readonly number[], maxStretch: number): boolean {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const fret of frets) {
    if (fret > 0) {
      low = Math.min(low, fret);
      high = Math.max(high, fret);
      count += 1;
    }
  }
  return count < 2 || high - low <= maxStretch;
}

/**
 * Each member takes the cheapest free string in turn; strings with no free one
 * are reported. `freeAt` is the beat each string is released at; a string taken
 * inside the attack stays taken until it ends.
 */
function placeGreedily(
  members: readonly NeckMember[],
  previous: Origin,
  freeAt: readonly number[],
  heldBy: readonly (number | undefined)[],
): { picks: StringFingering[]; conflicts: { member: NeckMember; blocked: number[] }[] } {
  const free = [...freeAt];
  const held = [...heldBy];
  const picks: StringFingering[] = [];
  const conflicts: { member: NeckMember; blocked: number[] }[] = [];
  let from = previous;
  for (const member of members) {
    const open = member.candidates.filter((candidate) =>
      isReleased(free[candidate.string] ?? Number.NEGATIVE_INFINITY, member.attackBeat),
    );
    if (open.length === 0) {
      conflicts.push({
        member,
        blocked: member.candidates
          .map((candidate) => held[candidate.string])
          .filter((value): value is number => value !== undefined),
      });
    }
    const pool = open.length > 0 ? open : member.candidates;
    const origin = from;
    const chosen = pool.reduce((best, candidate) =>
      fingeringCost(candidate, origin) < fingeringCost(best, origin) ? candidate : best,
    );
    picks.push(chosen);
    free[chosen.string] = Number.POSITIVE_INFINITY;
    held[chosen.string] = member.index;
    from = movedTo(from, chosen);
  }
  return { picks, conflicts };
}

/**
 * Cheapest assignment of the members to distinct free strings, found by a
 * bounded depth-first search; `undefined` when none exists within the budget.
 * With `heldFrets` the fretted span, held notes included, must fit `maxStretch`.
 */
function searchPlacement(
  members: readonly NeckMember[],
  previous: Origin,
  freeAt: readonly number[],
  heldFrets: readonly number[] | undefined,
  maxStretch: number,
): StringFingering[] | undefined {
  const free = [...freeAt];
  const frets = heldFrets === undefined ? undefined : [...heldFrets];
  const picks: StringFingering[] = [];
  let best: StringFingering[] | undefined;
  let bestCost = Number.POSITIVE_INFINITY;
  let nodes = 0;
  const visit = (depth: number, from: Origin, cost: number): void => {
    if (cost >= bestCost || nodes >= MAX_PLACEMENT_SEARCH_NODES) {
      return;
    }
    const member = members[depth];
    if (member === undefined) {
      best = [...picks];
      bestCost = cost;
      return;
    }
    for (const candidate of member.candidates) {
      const previousFree = free[candidate.string] ?? Number.NEGATIVE_INFINITY;
      if (!isReleased(previousFree, member.attackBeat)) {
        continue;
      }
      nodes += 1;
      if (frets !== undefined) {
        frets.push(candidate.fret);
        if (!fitsHand(frets, maxStretch)) {
          frets.pop();
          continue;
        }
      }
      free[candidate.string] = Number.POSITIVE_INFINITY;
      picks.push(candidate);
      visit(depth + 1, movedTo(from, candidate), cost + fingeringCost(candidate, from));
      picks.pop();
      free[candidate.string] = previousFree;
      if (frets !== undefined) {
        frets.pop();
      }
    }
  };
  visit(0, previous, 0);
  return best;
}

/**
 * Pick a string for each note of one attack.
 *
 * The greedy picks stand when they are free and fit the hand. Otherwise the
 * notes are placed jointly, so that a chord tone is not pushed up the neck by
 * the note below it taking an open string; the greedy picks, and the issues they
 * raise, remain only when no assignment exists.
 */
function placeAttack(
  members: readonly NeckMember[],
  previous: Origin,
  freeAt: readonly number[],
  heldBy: readonly (number | undefined)[],
  heldFrets: readonly number[],
  maxStretch: number,
): { picks: StringFingering[]; conflicts: { member: NeckMember; blocked: number[] }[] } {
  const greedy = placeGreedily(members, previous, freeAt, heldBy);
  const soundingFrets = [...heldFrets, ...greedy.picks.map((pick) => pick.fret)];
  if (greedy.conflicts.length === 0 && fitsHand(soundingFrets, maxStretch)) {
    return greedy;
  }
  if (members.length > MAX_JOINT_PLACEMENT_NOTES) {
    return greedy;
  }
  const fitted = searchPlacement(members, previous, freeAt, heldFrets, maxStretch);
  if (fitted !== undefined) {
    return { picks: fitted, conflicts: [] };
  }
  if (greedy.conflicts.length > 0) {
    const loose = searchPlacement(members, previous, freeAt, undefined, maxStretch);
    if (loose !== undefined) {
      return { picks: loose, conflicts: [] };
    }
  }
  return greedy;
}

/** Where the fretting hand stands: the last note stopped at a fret. */
type HandPosition = { note: TimedNote; fingering: StringFingering };

/**
 * Layers 2 and 3 for a string instrument, and the fingering that goes with them.
 *
 * The fretting hand moves once per attack, between stopped notes: an open
 * string leaves it where it was, and the notes of one attack are one hand shape.
 */
function placeOnNeck(
  state: Analysis,
  profile: ValidatedStringedProfile,
  attacks: readonly Attack[],
): void {
  /** Beat each string is released at. */
  const stringFreeAt = profile.tuning.map(() => Number.NEGATIVE_INFINITY);
  /** Note currently holding each string. */
  const stringHeldBy = profile.tuning.map<number | undefined>(() => undefined);
  let origin: Origin = {};
  let hand: HandPosition | undefined;

  for (const attack of attacks) {
    const members: NeckMember[] = [];
    for (const timed of attack.members) {
      const note = state.notes[timed.index];
      const candidates = note === undefined ? [] : fingeringsIn(profile, note.pitch);
      if (candidates.length > 0) {
        members.push({ ...timed, candidates });
      }
    }
    const heldFrets = attack.held
      .map((held) => state.placements[held.index]?.fingering?.fret)
      .filter((fret): fret is number => fret !== undefined);
    const { picks, conflicts } = placeAttack(
      members,
      origin,
      stringFreeAt,
      stringHeldBy,
      heldFrets,
      profile.maxStretch,
    );
    let shifted = hand;
    members.forEach((member, k) => {
      const chosen = picks[k];
      const placement = state.placements[member.index];
      if (!chosen || !placement) {
        return;
      }
      const conflict = conflicts.find((entry) => entry.member === member);
      const note = state.notes[member.index];
      if (conflict && note) {
        state.issues.push({
          type: 'stringConflict',
          layer: 2,
          notes: [...new Set([...conflict.blocked, member.index])].sort((a, b) => a - b),
          startBeat: member.startBeat,
          impossible: true,
          message: `MIDI ${note.pitch} needs a string already sounding on ${profile.name}`,
        });
      }
      placement.fingering = chosen;
      stringFreeAt[chosen.string] = member.endBeat;
      stringHeldBy[chosen.string] = member.index;

      state.movement += 1;
      if (origin.string !== undefined) {
        state.movement += Math.abs(chosen.string - origin.string);
      }
      origin = movedTo(origin, chosen);
      if (chosen.fret > 0) {
        shifted = { note: member, fingering: chosen };
      }
    });
    if (hand && shifted && shifted !== hand) {
      state.movement += Math.abs(shifted.fingering.fret - hand.fingering.fret);
      checkShiftSpeed(state, profile, hand, shifted);
    }
    hand = shifted;
  }

  for (const attack of attacks) {
    checkStretch(state, profile, attack);
    checkPolyphony(state, profile, { startBeat: attack.startBeat, members: soundingAt(attack) });
  }
}

/**
 * Where the hands are before a note: the string last played, and the fret the
 * fretting hand last stopped. An open string moves the picking hand only.
 */
type Origin = { string?: number; fret?: number };

/** The origin after playing `chosen`. */
function movedTo(origin: Origin, chosen: StringFingering): Origin {
  return { string: chosen.string, fret: chosen.fret > 0 ? chosen.fret : origin.fret };
}

/** Cost of taking a position, counting a string crossing as several frets. */
function fingeringCost(candidate: StringFingering, origin: Origin): number {
  // With no fret stopped yet, the low frets are the resting position; an open
  // string asks nothing of the fretting hand.
  const stopped =
    candidate.fret === 0
      ? 0
      : origin.fret === undefined
        ? candidate.fret
        : Math.abs(candidate.fret - origin.fret);
  const crossing =
    origin.string === undefined
      ? 0
      : STRING_CROSSING_COST * Math.abs(candidate.string - origin.string);
  return stopped + crossing + candidate.string / 100;
}

/** Layer 3: the fretting hand cannot travel that far between two attacks. */
function checkShiftSpeed(
  state: Analysis,
  profile: ValidatedProfile,
  from: HandPosition,
  to: HandPosition,
): void {
  const secondsPerBeat = state.secondsPerBeat;
  if (secondsPerBeat === undefined) {
    return;
  }
  const seconds = (to.note.attackBeat - from.note.attackBeat) * secondsPerBeat;
  const shift = Math.abs(to.fingering.fret - from.fingering.fret);
  if (seconds <= BEAT_EPS || shift === 0) {
    return;
  }
  if (shift / seconds > MAX_FRET_SHIFT_PER_SECOND) {
    state.issues.push({
      type: 'tooFast',
      layer: 3,
      notes: [from.note.index, to.note.index].sort((a, b) => a - b),
      startBeat: to.note.startBeat,
      impossible: false,
      message: `a ${shift}-fret shift in ${seconds.toFixed(3)}s is beyond ${profile.name}`,
    });
  }
}

/** Every note sounding once an attack has landed: the held ones and the struck ones. */
function soundingAt(attack: Attack): number[] {
  return [...attack.held, ...attack.members].map((timed) => timed.index);
}

/** Layer 2: one hand cannot span that many frets at once. */
function checkStretch(state: Analysis, profile: ValidatedStringedProfile, attack: Attack): void {
  const sounding = soundingAt(attack);
  const frets = sounding
    .map((member) => state.placements[member]?.fingering)
    .filter(
      (fingering): fingering is StringFingering => fingering !== undefined && fingering.fret > 0,
    )
    .map((fingering) => fingering.fret);
  if (frets.length < 2) {
    return;
  }
  const span = Math.max(...frets) - Math.min(...frets);
  if (span > profile.maxStretch) {
    state.issues.push({
      type: 'stretchTooWide',
      layer: 2,
      notes: sounding.sort((a, b) => a - b),
      startBeat: attack.startBeat,
      impossible: true,
      message: `a ${span}-fret stretch exceeds the ${profile.maxStretch} frets one hand spans on ${profile.name}`,
    });
  }
}

/** Layer 2: more notes sounding at once than the instrument has voices. */
function checkPolyphony(
  state: Analysis,
  profile: ValidatedProfile,
  group: { startBeat: number; members: readonly number[] },
): void {
  if (group.members.length <= profile.polyphony) {
    return;
  }
  state.issues.push({
    type: 'polyphonyExceeded',
    layer: 2,
    notes: [...group.members].sort((a, b) => a - b),
    startBeat: group.startBeat,
    impossible: true,
    message: `${group.members.length} notes sound at once; ${profile.name} has ${profile.polyphony}`,
  });
}

/** One take a percussion part is recorded on: the kit, or a voice dubbed over it. */
type KitPass = {
  /** Identity of the pass, so no two of them share a limb's history. */
  id: string;
  /** The notes struck on this pass at one attack. */
  members: TimedNote[];
};

/**
 * The kit a percussion part is read against.
 *
 * Which limbs can strike a voice, and whether a voice is dubbed over the kit,
 * are properties of the instrument rather than of the passage, so both are read
 * out of the profile once per call: asking the profile per stroke — inside a
 * sort comparator, at that — rebuilt the same answer for every note of the
 * track and allocated an array each time it did.
 */
type Kit = {
  profile: ValidatedPercussionProfile;
  /** Limbs the player has that reach each voice, in preference order. */
  limbs: ReadonlyMap<number, readonly Limb[]>;
  /** Voices played on a pass of their own. */
  overdub: ReadonlySet<number>;
};

/** No limb reaches a voice the kit does not name. */
const NO_LIMBS: readonly Limb[] = Object.freeze([]);

/** Read a kit's limbs and overdubs out of the profile, once. */
function readKit(profile: ValidatedPercussionProfile): Kit {
  const limbs = new Map<number, readonly Limb[]>();
  for (const key of Object.keys(profile.reach)) {
    const pitch = Number(key);
    limbs.set(pitch, reachOf(profile, pitch));
  }
  return { profile, limbs, overdub: new Set(profile.overdub ?? []) };
}

/** The limbs that can strike a voice, or none for a note that is not there. */
function limbsFor(kit: Kit, pitch: number | undefined): readonly Limb[] {
  if (pitch === undefined) {
    return NO_LIMBS;
  }
  return kit.limbs.get(pitch) ?? NO_LIMBS;
}

/** What the limbs were last doing, carried from one onset to the next. */
type KitMemory = {
  /** Limb that last struck each voice, so a voice keeps its stick. */
  limbForVoice: Map<number, Limb>;
  /** Last stroke of each limb on each pass. */
  lastStroke: Map<string, TimedNote>;
};

/**
 * The passes one onset is played on.
 *
 * A percussion part is a kit performance with voices dubbed over it, and each
 * overdubbed voice is its own take: it takes no limb from the kit and none from
 * another overdub. That is what lets a tambourine sound on a backbeat where a
 * snare is already in one hand and a hi-hat in the other — a player does not
 * grow a third arm for it, the part is recorded twice.
 */
function passesAt(state: Analysis, kit: Kit, members: readonly TimedNote[]): KitPass[] {
  const played: KitPass = { id: 'kit', members: [] };
  const overdubs = new Map<number, KitPass>();
  for (const member of members) {
    const pitch = state.notes[member.index]?.pitch;
    if (pitch === undefined || !kit.overdub.has(pitch)) {
      played.members.push(member);
      continue;
    }
    let pass = overdubs.get(pitch);
    if (!pass) {
      pass = { id: `overdub ${pitch}`, members: [] };
      overdubs.set(pitch, pass);
    }
    pass.members.push(member);
  }
  return [played, ...overdubs.values()];
}

/**
 * Hand every stroke of one pass to a limb, at one onset.
 *
 * @returns True when the pass wants more limbs at once than it has.
 */
function placePass(state: Analysis, kit: Kit, pass: KitPass, memory: KitMemory): boolean {
  const taken = new Set<Limb>();
  let conflicted = false;
  // The most constrained voice picks first: a kick only the right foot
  // reaches must not lose it to a snare that either hand could have taken.
  const members = [...pass.members].sort((a, b) => {
    const left = limbsFor(kit, state.notes[a.index]?.pitch);
    const right = limbsFor(kit, state.notes[b.index]?.pitch);
    return left.length - right.length || a.index - b.index;
  });
  for (const member of members) {
    const note = state.notes[member.index];
    const placement = state.placements[member.index];
    if (!note || !placement) {
      continue;
    }
    const candidates = limbsFor(kit, note.pitch);
    if (candidates.length === 0) {
      continue;
    }
    const preferred = memory.limbForVoice.get(note.pitch);
    const free = candidates.filter((limb) => !taken.has(limb));
    const chosen =
      free.length === 0
        ? candidates[0]
        : preferred !== undefined && free.includes(preferred)
          ? preferred
          : free[0];
    if (free.length === 0) {
      conflicted = true;
    }
    if (chosen === undefined) {
      continue;
    }
    taken.add(chosen);
    placement.limb = chosen;
    memory.limbForVoice.set(note.pitch, chosen);

    state.movement += 1;
    const strokeKey = `${pass.id} ${chosen}`;
    const previousStroke = memory.lastStroke.get(strokeKey);
    if (previousStroke !== undefined) {
      const previousNote = state.notes[previousStroke.index];
      if (previousNote && previousNote.pitch !== note.pitch) {
        // The limb had to travel across the kit rather than repeat a voice.
        state.movement += 1;
      }
      checkStrokeSpeed(state, kit.profile, previousStroke, member, chosen);
    }
    memory.lastStroke.set(strokeKey, member);
  }
  return conflicted;
}

/** Layers 2 and 3 for a kit, and the limb assignment that goes with them. */
function placeOnKit(state: Analysis, kit: Kit, attacks: readonly Attack[]): void {
  const memory: KitMemory = { limbForVoice: new Map(), lastStroke: new Map() };

  for (const attack of attacks) {
    const strokes = attack.members.map((member) => member.index);
    let conflicted = false;
    for (const pass of passesAt(state, kit, attack.members)) {
      if (!placePass(state, kit, pass, memory)) {
        continue;
      }
      conflicted = true;
      state.issues.push({
        type: 'limbConflict',
        layer: 2,
        notes: pass.members.map((member) => member.index).sort((a, b) => a - b),
        startBeat: attack.startBeat,
        impossible: true,
        message: `${pass.members.length} simultaneous strokes cannot be shared among the limbs of ${kit.profile.name}`,
      });
    }
    if (!conflicted) {
      checkPolyphony(state, kit.profile, { startBeat: attack.startBeat, members: strokes });
    }
  }
}

/** Layer 3: one limb cannot strike twice that close together. */
function checkStrokeSpeed(
  state: Analysis,
  profile: ValidatedProfile,
  from: TimedNote,
  to: TimedNote,
  limb: Limb,
): void {
  const secondsPerBeat = state.secondsPerBeat;
  if (secondsPerBeat === undefined) {
    return;
  }
  const seconds = (to.attackBeat - from.attackBeat) * secondsPerBeat;
  if (seconds <= BEAT_EPS || seconds >= MIN_LIMB_STROKE_SECONDS) {
    return;
  }
  state.issues.push({
    type: 'tooFast',
    layer: 3,
    notes: [from.index, to.index].sort((a, b) => a - b),
    startBeat: to.startBeat,
    impossible: false,
    message: `${limb} strikes twice ${seconds.toFixed(3)}s apart on ${profile.name}`,
  });
}

/**
 * Movement per unit time, on a 1..5 scale.
 *
 * The rate is what a passage demands of the player: strokes and shifts divided
 * by the seconds available for them. It is mapped through a saturating curve so
 * the scale has a fixed top a ceiling can be compared against — a faster tempo
 * over the same notes never reads easier, and 5 is reached only where the
 * passage has already left what the instrument allows.
 */
function difficultyOf(
  state: Analysis,
  attacks: readonly Attack[],
  bpm: number | undefined,
): number {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const attack of attacks) {
    for (const member of attack.members) {
      first = Math.min(first, member.startBeat);
      last = Math.max(last, member.endBeat);
    }
  }
  const spanBeats = last - first;
  if (!Number.isFinite(spanBeats) || spanBeats <= BEAT_EPS) {
    return MIN_DIFFICULTY;
  }
  const seconds = (spanBeats * 60) / (bpm ?? REFERENCE_BPM);
  const rate = state.movement / seconds;
  const scaled =
    MIN_DIFFICULTY + (MAX_DIFFICULTY - MIN_DIFFICULTY) * (1 - Math.exp(-rate / DIFFICULTY_SCALE));
  return Math.round(scaled * 1e4) / 1e4;
}
