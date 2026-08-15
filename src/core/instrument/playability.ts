import type { NoteEvent } from '../types.js';
import { assertNoteEvents, assertRange } from '../validation/index.js';
import {
  canSound,
  fingeringsFor,
  type InstrumentProfile,
  type Limb,
  type StringFingering,
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
const REFERENCE_BPM = 120;
/** Fastest the fretting hand shifts along the neck, in frets per second. */
const MAX_FRET_SHIFT_PER_SECOND = 100;
/** Shortest gap between two strokes of one limb, in seconds. */
const MIN_LIMB_STROKE_SECONDS = 0.06;
/** Movement rate, in units per second, that reads as a demanding passage. */
const DIFFICULTY_SCALE = 12;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 5;
/** Cost of crossing one string, relative to moving one fret. */
const STRING_CROSSING_COST = 2;
/** Onsets closer than this fraction of a beat count as simultaneous. */
const ONSET_GRID = 128;

const EPS = 1e-9;

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
  profile: InstrumentProfile,
  bpm?: number,
): PlayabilityReport {
  assertNoteEvents(notes, 'playability notes', { allowNonPositiveDuration: true });
  if (bpm !== undefined) {
    assertRange(bpm, Number.MIN_VALUE, 1000, 'playability bpm');
  }

  const order = notes
    .map((_, index) => index)
    .sort((a, b) => {
      const left = notes[a];
      const right = notes[b];
      if (!left || !right) {
        return a - b;
      }
      return left.startBeat - right.startBeat || left.pitch - right.pitch || a - b;
    });

  const state: Analysis = {
    notes,
    order,
    placements: notes.map((_, index) => ({ note: index })),
    issues: [],
    movement: 0,
    secondsPerBeat: bpm === undefined ? undefined : 60 / bpm,
  };

  checkExistence(state, profile);
  if (profile.kind === 'stringed') {
    placeOnNeck(state, profile);
  } else {
    placeOnKit(state, profile);
  }

  return {
    difficulty: difficultyOf(state, bpm),
    issues: state.issues,
    placements: state.placements,
  };
}

/** Layer 1: the instrument has no position for the note, or no such technique. */
function checkExistence(state: Analysis, profile: InstrumentProfile): void {
  for (const index of state.order) {
    const note = state.notes[index];
    if (!note) {
      continue;
    }
    if (!canSound(profile, note.pitch)) {
      state.issues.push({
        type: 'noteOutOfRange',
        layer: 1,
        notes: [index],
        startBeat: note.startBeat,
        impossible: true,
        message: `${profile.name} cannot sound MIDI ${note.pitch}`,
      });
    }
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

/** Note indices sounding at each distinct onset, in onset order. */
function soundingGroups(state: Analysis): { startBeat: number; members: number[] }[] {
  const groups: { startBeat: number; members: number[] }[] = [];
  let active: number[] = [];
  let cursor = 0;
  let previousKey = Number.NaN;
  for (const index of state.order) {
    const note = state.notes[index];
    if (!note) {
      continue;
    }
    const key = Math.round(note.startBeat * ONSET_GRID);
    if (key === previousKey) {
      continue;
    }
    previousKey = key;
    const at = note.startBeat;
    active = active.filter((member) => {
      const held = state.notes[member];
      return held !== undefined && held.startBeat + held.durationBeat > at + EPS;
    });
    while (cursor < state.order.length) {
      const candidateIndex = state.order[cursor];
      const candidate = candidateIndex === undefined ? undefined : state.notes[candidateIndex];
      if (!candidate || candidate.startBeat > at + EPS) {
        break;
      }
      if (candidateIndex !== undefined && candidate.startBeat + candidate.durationBeat > at + EPS) {
        active.push(candidateIndex);
      }
      cursor += 1;
    }
    groups.push({ startBeat: at, members: [...active] });
  }
  return groups;
}

/** Layers 2 and 3 for a string instrument, and the fingering that goes with them. */
function placeOnNeck(state: Analysis, profile: InstrumentProfile & { kind: 'stringed' }): void {
  /** Beat each string becomes free again. */
  const stringFreeAt = profile.tuning.map(() => Number.NEGATIVE_INFINITY);
  /** Note currently holding each string. */
  const stringHeldBy = profile.tuning.map<number | undefined>(() => undefined);
  let previous: StringFingering | undefined;
  let previousIndex: number | undefined;

  for (const index of state.order) {
    const note = state.notes[index];
    const placement = state.placements[index];
    if (!note || !placement) {
      continue;
    }
    const candidates = fingeringsFor(profile, note.pitch);
    if (candidates.length === 0) {
      continue;
    }
    const free = candidates.filter(
      (candidate) => (stringFreeAt[candidate.string] ?? 0) <= note.startBeat + EPS,
    );
    if (free.length === 0) {
      const blocked = candidates
        .map((candidate) => stringHeldBy[candidate.string])
        .filter((held): held is number => held !== undefined);
      state.issues.push({
        type: 'stringConflict',
        layer: 2,
        notes: [...new Set([...blocked, index])].sort((a, b) => a - b),
        startBeat: note.startBeat,
        impossible: true,
        message: `MIDI ${note.pitch} needs a string already sounding on ${profile.name}`,
      });
    }
    const pool = free.length > 0 ? free : candidates;
    const chosen = pool.reduce((best, candidate) =>
      fingeringCost(candidate, previous) < fingeringCost(best, previous) ? candidate : best,
    );
    placement.fingering = chosen;
    stringFreeAt[chosen.string] = note.startBeat + note.durationBeat;
    stringHeldBy[chosen.string] = index;

    state.movement += 1;
    if (previous) {
      state.movement +=
        Math.abs(chosen.fret - previous.fret) + Math.abs(chosen.string - previous.string);
      checkShiftSpeed(state, profile, previousIndex, index, previous, chosen);
    }
    previous = chosen;
    previousIndex = index;
  }

  for (const group of soundingGroups(state)) {
    checkStretch(state, profile, group);
    checkPolyphony(state, profile, group);
  }
}

/** Cost of taking a position, counting a string crossing as several frets. */
function fingeringCost(candidate: StringFingering, previous: StringFingering | undefined): number {
  if (!previous) {
    // With nothing to move from, the low frets are the resting position.
    return candidate.fret + candidate.string / 100;
  }
  return (
    Math.abs(candidate.fret - previous.fret) +
    STRING_CROSSING_COST * Math.abs(candidate.string - previous.string) +
    candidate.string / 100
  );
}

/** Layer 3: the fretting hand cannot travel that far in the time available. */
function checkShiftSpeed(
  state: Analysis,
  profile: InstrumentProfile,
  fromIndex: number | undefined,
  toIndex: number,
  from: StringFingering,
  to: StringFingering,
): void {
  const secondsPerBeat = state.secondsPerBeat;
  if (secondsPerBeat === undefined || fromIndex === undefined) {
    return;
  }
  const previousNote = state.notes[fromIndex];
  const note = state.notes[toIndex];
  if (!previousNote || !note) {
    return;
  }
  const seconds = (note.startBeat - previousNote.startBeat) * secondsPerBeat;
  const shift = Math.abs(to.fret - from.fret);
  if (seconds <= EPS || shift === 0) {
    return;
  }
  if (shift / seconds > MAX_FRET_SHIFT_PER_SECOND) {
    state.issues.push({
      type: 'tooFast',
      layer: 3,
      notes: [fromIndex, toIndex].sort((a, b) => a - b),
      startBeat: note.startBeat,
      impossible: false,
      message: `a ${shift}-fret shift in ${seconds.toFixed(3)}s is beyond ${profile.name}`,
    });
  }
}

/** Layer 2: one hand cannot span that many frets at once. */
function checkStretch(
  state: Analysis,
  profile: InstrumentProfile & { kind: 'stringed' },
  group: { startBeat: number; members: number[] },
): void {
  const frets = group.members
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
      notes: [...group.members].sort((a, b) => a - b),
      startBeat: group.startBeat,
      impossible: true,
      message: `a ${span}-fret stretch exceeds the ${profile.maxStretch} frets one hand spans on ${profile.name}`,
    });
  }
}

/** Layer 2: more notes sounding at once than the instrument has voices. */
function checkPolyphony(
  state: Analysis,
  profile: InstrumentProfile,
  group: { startBeat: number; members: number[] },
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

/** Layers 2 and 3 for a kit, and the limb assignment that goes with them. */
function placeOnKit(state: Analysis, profile: InstrumentProfile & { kind: 'percussion' }): void {
  /** Limb that last struck each voice, so a voice keeps its stick. */
  const limbForVoice = new Map<number, Limb>();
  /** Last stroke of each limb, as a note index. */
  const lastStroke = new Map<Limb, number>();

  for (const group of onsetGroups(state)) {
    const taken = new Set<Limb>();
    let conflicted = false;
    // The most constrained voice picks first: a kick only the right foot
    // reaches must not lose it to a snare that either hand could have taken.
    const members = [...group.members].sort((a, b) => {
      const left = reachOf(profile, state.notes[a]?.pitch);
      const right = reachOf(profile, state.notes[b]?.pitch);
      return left.length - right.length || a - b;
    });
    for (const index of members) {
      const note = state.notes[index];
      const placement = state.placements[index];
      if (!note || !placement) {
        continue;
      }
      const candidates = reachOf(profile, note.pitch);
      if (candidates.length === 0) {
        continue;
      }
      const preferred = limbForVoice.get(note.pitch);
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
      limbForVoice.set(note.pitch, chosen);

      state.movement += 1;
      const previousIndex = lastStroke.get(chosen);
      if (previousIndex !== undefined) {
        const previousNote = state.notes[previousIndex];
        if (previousNote && previousNote.pitch !== note.pitch) {
          // The limb had to travel across the kit rather than repeat a voice.
          state.movement += 1;
        }
        checkStrokeSpeed(state, profile, previousIndex, index, chosen);
      }
      lastStroke.set(chosen, index);
    }
    if (conflicted) {
      state.issues.push({
        type: 'limbConflict',
        layer: 2,
        notes: [...group.members].sort((a, b) => a - b),
        startBeat: group.startBeat,
        impossible: true,
        message: `${group.members.length} simultaneous strokes cannot be shared among the limbs of ${profile.name}`,
      });
    } else {
      checkPolyphony(state, profile, group);
    }
  }
}

/** The limbs a kit can strike a voice with, empty when it has no such voice. */
function reachOf(
  profile: InstrumentProfile & { kind: 'percussion' },
  pitch: number | undefined,
): readonly Limb[] {
  if (pitch === undefined) {
    return [];
  }
  return (profile.reach[pitch] ?? []).filter((limb) => profile.limbs.includes(limb));
}

/** Layer 3: one limb cannot strike twice that close together. */
function checkStrokeSpeed(
  state: Analysis,
  profile: InstrumentProfile,
  fromIndex: number,
  toIndex: number,
  limb: Limb,
): void {
  const secondsPerBeat = state.secondsPerBeat;
  if (secondsPerBeat === undefined) {
    return;
  }
  const previousNote = state.notes[fromIndex];
  const note = state.notes[toIndex];
  if (!previousNote || !note) {
    return;
  }
  const seconds = (note.startBeat - previousNote.startBeat) * secondsPerBeat;
  if (seconds <= EPS || seconds >= MIN_LIMB_STROKE_SECONDS) {
    return;
  }
  state.issues.push({
    type: 'tooFast',
    layer: 3,
    notes: [fromIndex, toIndex].sort((a, b) => a - b),
    startBeat: note.startBeat,
    impossible: false,
    message: `${limb} strikes twice ${seconds.toFixed(3)}s apart on ${profile.name}`,
  });
}

/** Note indices sharing each distinct onset, in onset order. */
function onsetGroups(state: Analysis): { startBeat: number; members: number[] }[] {
  const groups: { startBeat: number; members: number[] }[] = [];
  let key = Number.NaN;
  let current: { startBeat: number; members: number[] } | undefined;
  for (const index of state.order) {
    const note = state.notes[index];
    if (!note) {
      continue;
    }
    const onsetKey = Math.round(note.startBeat * ONSET_GRID);
    if (!current || onsetKey !== key) {
      current = { startBeat: note.startBeat, members: [] };
      groups.push(current);
      key = onsetKey;
    }
    current.members.push(index);
  }
  return groups;
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
function difficultyOf(state: Analysis, bpm: number | undefined): number {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const note of state.notes) {
    if (!note) {
      continue;
    }
    first = Math.min(first, note.startBeat);
    last = Math.max(last, note.startBeat + Math.max(0, note.durationBeat));
  }
  const spanBeats = last - first;
  if (!Number.isFinite(spanBeats) || spanBeats <= EPS) {
    return MIN_DIFFICULTY;
  }
  const seconds = (spanBeats * 60) / (bpm ?? REFERENCE_BPM);
  const rate = state.movement / seconds;
  const scaled =
    MIN_DIFFICULTY + (MAX_DIFFICULTY - MIN_DIFFICULTY) * (1 - Math.exp(-rate / DIFFICULTY_SCALE));
  return Math.round(scaled * 1e4) / 1e4;
}
