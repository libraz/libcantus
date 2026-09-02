/**
 * The fill vocabulary, as data.
 *
 * Every archetype is a list of strokes on the bar's grid and every selection is
 * a table indexed by a draw, so a fill can be added, replaced, or supplied by a
 * caller without touching a generator. The generator's part is to look one up.
 */

import type { Articulation } from '../../core/instrument/index.js';
import { type Draw, sustainsStrokes } from '../context/index.js';
import { deepFreeze } from '../vocabulary/freeze.js';
import type { HitList } from './hit.js';
import type { DrumStyle, SectionEnergy, SectionType } from './internal.js';
import { BACKBEAT_LIFT, EIGHTH, FILL_ACCENT_LIFT, GM, SIXTEENTH } from './internal.js';

/** The thirteen fill archetypes for section transitions, in declaration order. */
export const FILL_TYPES = Object.freeze([
  'snareRoll',
  'tomDescend',
  'tomAscend',
  'snareTomCombo',
  'simpleCrash',
  'linearFill',
  'ghostToAccent',
  'bdSnareAlternate',
  'hiHatChoke',
  'tomShuffle',
  'breakdownFill',
  'flamsAndDrags',
  'halfTimeFill',
] as const);

/** The thirteen fill archetypes for section transitions. */
export type FillType = (typeof FILL_TYPES)[number];

/**
 * How loud one stroke of a fill is.
 *
 * A fill's dynamics are written against the fill's own base velocity rather
 * than in absolute terms, so the same archetype sounds right in a verse and a
 * chorus: `fill` is the body of the fill, `accent` the stroke that lands. One
 * base for the whole gesture, not one per beat — a crescendo that restarts its
 * arithmetic at every beat line falls back in the middle of itself.
 */
export type FillVelocity = {
  base: 'fill' | 'accent';
  /** Factor on the base, for a crescendo or a ghosted stroke. */
  scale?: number;
  /** Fixed offset in MIDI velocity, for a stroke a little above or below. */
  offset?: number;
};

/** One stroke of a fill, positioned within the beat it belongs to. */
export type FillStroke = {
  /** General MIDI note number of the voice struck. */
  voice: number;
  /** Offset from the start of the beat, in quarter-note beats. */
  offset: number;
  /** Sounding length, in quarter-note beats. */
  duration: number;
  velocity: FillVelocity;
  /** How the stroke is played, when it is more than a plain hit. */
  articulation?: Articulation;
};

/**
 * A fill archetype: what each beat of the fill bar plays.
 *
 * Beats are indexed from the start of the bar. A beat with no entry is silent,
 * which is how the sparse archetypes leave the earlier beats to the groove.
 */
export type FillArchetype = {
  /** Strokes per beat of the bar, indexed 0..3. */
  atBeat: readonly (readonly FillStroke[])[];
  /**
   * Whether the archetype stops where its own strokes stop, rather than holding
   * its last beat over the beats of the bar it does not write.
   *
   * It answers for an archetype shorter than the bar it is placed in, so the
   * built-in archetypes — written beat by beat against the four-beat bar
   * {@link generateDrums} accepts — are unaffected by it; a caller's archetype
   * that writes fewer beats is where it decides anything. Most figures read
   * naturally when held, but a half-time gesture is bar-long and stops there.
   */
  boundToBar?: boolean;
};

const S = SIXTEENTH;
const E = EIGHTH;

/** Body velocity with an optional factor and offset. */
function fill(scale?: number, offset?: number): FillVelocity {
  return {
    base: 'fill',
    ...(scale === undefined ? {} : { scale }),
    ...(offset === undefined ? {} : { offset }),
  };
}

/** Accent velocity: the stroke the fill lands on. */
const accent: FillVelocity = { base: 'accent' };

/** One stroke. */
function at(
  voice: number,
  offset: number,
  duration: number,
  velocity: FillVelocity,
  articulation?: Articulation,
): FillStroke {
  return { voice, offset, duration, velocity, ...(articulation ? { articulation } : {}) };
}

/**
 * The pickup beats every archetype shares: a fill that starts at beat 2 is
 * approached the same way whichever archetype follows.
 */
const PICKUP_BEAT_0: FillStroke[] = [at(GM.BD, 0, E, fill()), at(GM.SD, E, E, fill(undefined, -5))];
const PICKUP_BEAT_1: FillStroke[] = [
  at(GM.SD, 0, E, fill()),
  at(GM.TOM_H, E, E, fill(undefined, -3)),
];

/** A crescendo of `count` snare sixteenths starting from `from`. */
function snareCrescendo(count: number, from: number): FillStroke[] {
  return Array.from({ length: count }, (_, i) => at(GM.SD, i * S, S, fill(from + 0.1 * i)));
}

/** An accelerating ghost-to-accent run of four snare sixteenths. */
function ghostRun(): FillStroke[] {
  return Array.from({ length: 4 }, (_, i) => at(GM.SD, i * S, S, fill(0.4, i * 10)));
}

/** Build an archetype from its beat-2 and beat-3 strokes. */
function archetype(
  beat2: readonly FillStroke[],
  beat3: readonly FillStroke[],
  boundToBar?: boolean,
): FillArchetype {
  return {
    atBeat: [PICKUP_BEAT_0, PICKUP_BEAT_1, beat2, beat3],
    ...(boundToBar ? { boundToBar } : {}),
  };
}

/**
 * The fill dictionary.
 *
 * Provenance: every archetype here is a rudiment or a stock phrase-end gesture
 * — a snare crescendo, a descending tom run, a crash on the last off-beat — of
 * the kind every drummer plays and nobody owns. None reproduces a fill from a
 * particular recording.
 */
export const FILL_ARCHETYPES: Readonly<Record<FillType, FillArchetype>> = deepFreeze({
  // One crescendo of seven strokes across the two beats, not two of four and
  // three: the roll is a single gesture and its second half continues where its
  // first half left off.
  snareRoll: archetype(snareCrescendo(4, 0.6), [
    ...snareCrescendo(3, 1.0),
    at(GM.SD, 3 * S, S, accent),
  ]),
  tomDescend: archetype(
    [at(GM.SD, 0, E, fill()), at(GM.TOM_H, E, E, fill(undefined, -5))],
    [
      at(GM.TOM_H, 0, S, fill()),
      at(GM.TOM_M, S, S, fill(undefined, -3)),
      at(GM.TOM_M, E, S, fill(undefined, -5)),
      at(GM.TOM_L, E + S, S, accent),
    ],
  ),
  tomAscend: archetype(
    [at(GM.SD, 0, E, fill()), at(GM.TOM_L, E, E, fill(undefined, -5))],
    [
      at(GM.TOM_L, 0, S, fill()),
      at(GM.TOM_M, S, S, fill(undefined, 3)),
      at(GM.TOM_M, E, S, fill(undefined, 5)),
      at(GM.TOM_H, E + S, S, accent),
    ],
  ),
  snareTomCombo: archetype(
    [at(GM.SD, 0, E, fill()), at(GM.SD, E, S, fill(undefined, -5)), at(GM.TOM_H, E + S, S, fill())],
    [
      at(GM.TOM_M, 0, S, fill()),
      at(GM.SD, S, S, fill(undefined, -3)),
      at(GM.TOM_L, E, S, fill(undefined, 2)),
      at(GM.BD, E + S, S, accent),
    ],
  ),
  simpleCrash: archetype([], [at(GM.BD, E + S, S, accent), at(GM.CRASH, E + S, E, accent)]),
  linearFill: archetype(
    [
      at(GM.BD, 0, S, fill()),
      at(GM.SD, S, S, fill()),
      at(GM.TOM_H, 2 * S, S, fill()),
      at(GM.TOM_M, 3 * S, S, fill()),
    ],
    [
      at(GM.TOM_L, 0, S, fill(undefined, 3)),
      at(GM.SD, S, S, fill(undefined, 5)),
      at(GM.BD, 2 * S, S, fill(undefined, 7)),
      at(GM.SD, 3 * S, S, accent),
    ],
  ),
  ghostToAccent: archetype(ghostRun(), [at(GM.SD, 0, E, fill()), at(GM.SD, E, E, accent)]),
  bdSnareAlternate: archetype(
    [
      at(GM.BD, 0, S, fill()),
      at(GM.SD, S, S, fill()),
      at(GM.BD, 2 * S, S, fill(undefined, 3)),
      at(GM.SD, 3 * S, S, fill(undefined, 3)),
    ],
    [
      at(GM.BD, 0, S, fill(undefined, 5)),
      at(GM.SD, S, S, fill(undefined, 5)),
      at(GM.BD, 2 * S, S, accent),
      at(GM.SD, 3 * S, S, accent),
    ],
  ),
  hiHatChoke: archetype(
    [at(GM.OHH, 0, E, fill()), at(GM.OHH, E, E, fill(undefined, 5))],
    [at(GM.OHH, 0, S, fill(undefined, 8)), at(GM.CHH, S, S, accent), at(GM.SD, E, E, accent)],
  ),
  tomShuffle: archetype(
    [at(GM.TOM_H, 0, E, fill()), at(GM.TOM_M, E + S / 2, S, fill(undefined, -5))],
    [at(GM.TOM_M, 0, E, fill()), at(GM.TOM_L, E + S / 2, S, fill(undefined, 5))],
  ),
  breakdownFill: archetype([], [at(GM.SD, E, S, accent)]),
  flamsAndDrags: archetype(
    // The ornaments are attributes of the principal stroke, not extra onsets:
    // one flammed note rather than a grace note written a 64th early, one
    // dragged note rather than a pair of soft strokes before it.
    [at(GM.SD, 0, E, fill(), 'flam'), at(GM.SD, E + S, E, fill(), 'drag')],
    [at(GM.SD, 0, 1, accent, 'flam')],
  ),
  halfTimeFill: archetype(
    [at(GM.SD, 0, 1, accent), at(GM.BD, 0, 1, fill())],
    // At low energy the fill spans only beat 3, so this beat keeps the phrase
    // end from going silent: a broad half-time backbeat snare with a light
    // pickup into the next section.
    [at(GM.SD, 0, EIGHTH, accent), at(GM.SD, E, S, fill(0.6)), at(GM.SD, E + S, S, accent)],
    true,
  ),
});

/**
 * Whether a caller's material is a fill.
 *
 * A context carries one dictionary for the whole piece, so each generator has
 * to recognise its own material; a bass lick reaching the fill selector would
 * otherwise be rendered as silence.
 */
export function isFillArchetype(material: unknown): material is FillArchetype {
  return (
    typeof material === 'object' &&
    material !== null &&
    Array.isArray((material as FillArchetype).atBeat)
  );
}

/**
 * The archetype an id names.
 *
 * @param id Archetype name, built-in or supplied.
 * @param supplied The caller's archetypes, keyed by id.
 * @returns The archetype, or undefined when nothing carries that name.
 */
export function fillArchetypeFor(
  id: string,
  supplied?: ReadonlyMap<string, FillArchetype>,
): FillArchetype | undefined {
  return supplied?.get(id) ?? FILL_ARCHETYPES[id as FillType];
}

/**
 * Beat at which a fill begins, widening with section energy.
 *
 * One beat per step of energy, so every beat an archetype writes is played by
 * some transition: a peak takes the bar from its downbeat, pickup included, and
 * a low-energy phrase end is the last beat alone.
 */
export function getFillStartBeat(energy: SectionEnergy): number {
  switch (energy) {
    case 'low':
      return 3;
    case 'medium':
      return 2;
    case 'high':
      return 1;
    case 'peak':
      return 0;
  }
}

/**
 * The archetype offered at each draw, per transition context.
 *
 * A table is read by index, so an archetype named twice is simply twice as
 * likely; that is the whole weighting mechanism, and it is visible in the data
 * rather than buried in the branches of a switch.
 */
type FillTable = readonly FillType[];

/** Sparse styles keep the phrase end small whatever the transition. */
const SPARSE_FILLS: FillTable = ['simpleCrash', 'breakdownFill'];

/** Dropping into a low-energy section: keep the phrase end gentle. */
const LOW_ENERGY_FILLS: FillTable = ['simpleCrash', 'breakdownFill', 'halfTimeFill'];

/** Big lead-ins to a chorus, from a high-energy style. */
const TO_CHORUS_HIGH_FILLS: FillTable = [
  'tomDescend',
  'tomDescend',
  'snareRoll',
  'linearFill',
  'bdSnareAlternate',
  'flamsAndDrags',
  'tomShuffle',
  'ghostToAccent',
];

/** Lead-ins to a chorus from the remaining styles. */
const TO_CHORUS_FILLS: FillTable = [
  'snareTomCombo',
  'snareTomCombo',
  'tomDescend',
  'ghostToAccent',
  'hiHatChoke',
  'linearFill',
  'snareRoll',
  'snareRoll',
];

/** Leaving the intro: lighter, building character. */
const FROM_INTRO_FILLS: FillTable = [
  'snareRoll',
  'snareRoll',
  'simpleCrash',
  'ghostToAccent',
  'breakdownFill',
  'halfTimeFill',
];

/** Generic medium/high/peak fills for a high-energy style. */
const GENERIC_HIGH_FILLS: FillTable = [
  'tomDescend',
  'snareRoll',
  'tomAscend',
  'snareTomCombo',
  'linearFill',
  'bdSnareAlternate',
  'flamsAndDrags',
  'tomShuffle',
];

/** Generic medium/high/peak fills for the remaining styles. */
const GENERIC_FILLS: FillTable = [
  'snareRoll',
  'snareRoll',
  'snareTomCombo',
  'ghostToAccent',
  'hiHatChoke',
  'halfTimeFill',
  'breakdownFill',
  'breakdownFill',
];

/**
 * The table a transition reads from.
 *
 * The transition-specific tables (into a chorus, out of an intro) are checked
 * before the generic energy tables so every archetype stays reachable; with
 * `from === to` the caller effectively asks for a within-section fill.
 */
function fillTableFor(
  from: SectionType,
  to: SectionType,
  style: DrumStyle,
  nextEnergy: SectionEnergy,
): FillTable {
  if (style === 'sparse') {
    return SPARSE_FILLS;
  }
  const highEnergy = style === 'rock' || style === 'fourOnFloor';
  if (nextEnergy === 'low') {
    return LOW_ENERGY_FILLS;
  }
  if (to === 'chorus') {
    return highEnergy ? TO_CHORUS_HIGH_FILLS : TO_CHORUS_FILLS;
  }
  if (from === 'intro') {
    return FROM_INTRO_FILLS;
  }
  return highEnergy ? GENERIC_HIGH_FILLS : GENERIC_FILLS;
}

/**
 * Pick a fill archetype for a section transition.
 *
 * @param from Section the fill leaves.
 * @param to Section the fill leads into.
 * @param style Internal drum style.
 * @param nextEnergy Energy of the section the fill leads into.
 * @param draw Position-addressed draws for the fill.
 * @param bar Bar the fill occupies; the choice is addressed by it, so a fill
 *   elsewhere in the piece is unaffected by this one.
 * @param extra Ids a caller's dictionary contributes for this transition. They
 *   are offered after the built-in table, so the built-in choices keep the draws
 *   they had and a caller adds to the vocabulary rather than displacing it.
 * @param accepts Which archetypes may be drawn at all. A fill beyond the
 *   difficulty ceiling is taken out of the table and the draw runs over what
 *   remains, rather than being simplified into a fill nobody wrote.
 * @returns The id drawn, or undefined when the table has nothing this
 *   transition accepts.
 */
export function selectFillType(
  from: SectionType,
  to: SectionType,
  style: DrumStyle,
  nextEnergy: SectionEnergy,
  draw: Draw,
  bar: number,
  extra: readonly string[] = [],
  accepts: (id: string) => boolean = () => true,
): string | undefined {
  const table = fillTableFor(from, to, style, nextEnergy);
  // An id a built-in already carries is a replacement, not an addition: the
  // material is resolved through the caller's map wherever the table names it,
  // so appending it as well would give that one fill two ways of being drawn
  // and a weight no other entry has.
  const added = extra.filter((id) => FILL_ARCHETYPES[id as FillType] === undefined);
  const offered = added.length === 0 ? table : [...table, ...added];
  const candidates = offered.filter(accepts);
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates[draw.range(0, candidates.length - 1, 'fill', bar)] ?? candidates[0];
}

/**
 * The strokes a fill plays on one beat of the fill bar.
 *
 * @param shape The archetype.
 * @param beat Beat index within the bar.
 * @returns The strokes, empty where the archetype leaves the beat to the groove.
 */
function strokesAtBeat(shape: FillArchetype, beat: number): readonly FillStroke[] {
  const lastBeat = shape.atBeat.length - 1;
  const index = beat > lastBeat ? (shape.boundToBar ? -1 : lastBeat) : beat;
  return shape.atBeat[index] ?? [];
}

/**
 * Whether a fill is inside the difficulty ceiling at this tempo.
 *
 * The fill is measured as it will actually be played — from the beat it starts
 * on to the end of the bar — and voice by voice, since what stops a player is
 * one limb repeating faster than it can rather than the bar's total count. The
 * phrase end is the most exposed bar there is, so a ceiling that governs the
 * groove and not the fill governs nothing a listener would notice.
 *
 * @param shape The archetype.
 * @param fromBeat Beat the fill starts on.
 * @param barBeats Beats in the bar.
 * @param bpm Tempo, or undefined when the caller gave none.
 * @param difficulty The ceiling, or undefined for no ceiling.
 * @returns True when the fill is playable at the ceiling, and whenever either
 *   the ceiling or the tempo is unknown.
 */
export function fillWithinCeiling(
  shape: FillArchetype,
  fromBeat: number,
  barBeats: number,
  bpm: number | undefined,
  difficulty: number | undefined,
): boolean {
  if (difficulty === undefined || bpm === undefined) {
    return true;
  }
  const byVoice = new Map<number, number[]>();
  for (let beat = fromBeat; beat < barBeats; beat += 1) {
    for (const stroke of strokesAtBeat(shape, beat)) {
      const positions = byVoice.get(stroke.voice);
      if (positions) {
        positions.push(beat + stroke.offset);
      } else {
        byVoice.set(stroke.voice, [beat + stroke.offset]);
      }
    }
  }
  for (const positions of byVoice.values()) {
    positions.sort((a, b) => a - b);
    for (let i = 1; i < positions.length; i += 1) {
      const gap = (positions[i] ?? 0) - (positions[i - 1] ?? 0);
      if (gap > 0 && !sustainsStrokes(gap, bpm, difficulty)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Emit a fill for a single beat of the fill bar.
 *
 * @param track Hit accumulator.
 * @param beatTick Absolute beat position of this beat.
 * @param beat Beat index within the bar (0-3).
 * @param fillType Selected archetype, by name or as material of its own.
 * @param velocity Base velocity for the beat.
 * @param place Where a position inside the beat is written, which is the
 *   section's own grid: a fill written straight through a bar the rest of the
 *   kit swings puts its offbeats ahead of every other voice, and two voices a
 *   sixteenth's swing apart in one bar are heard as a flam.
 */
export function generateFill(
  track: HitList,
  beatTick: number,
  beat: number,
  fillType: FillType | FillArchetype,
  velocity: number,
  place: (tick: number) => number = (tick) => tick,
): void {
  const shape =
    typeof fillType === 'string' ? FILL_ARCHETYPES[fillType] : (fillType as FillArchetype);
  if (!shape) {
    return;
  }
  const strokes = strokesAtBeat(shape, beat);
  const fillVel = velocity * 0.9;
  // The stroke a fill lands on is the loudest thing in the bar. Reading it as a
  // fraction of the beat velocity put it below the strokes leading into it and
  // some twenty units under the backbeat next to it, which is a phrase end
  // heard as a hole.
  const accentVel = velocity + BACKBEAT_LIFT + FILL_ACCENT_LIFT;
  for (const stroke of strokes) {
    const base = stroke.velocity.base === 'accent' ? accentVel : fillVel;
    const scaled = stroke.velocity.scale === undefined ? base : base * stroke.velocity.scale;
    track.add(
      stroke.voice,
      place(beatTick + stroke.offset),
      stroke.duration,
      scaled + (stroke.velocity.offset ?? 0),
      stroke.articulation,
    );
  }
}
