/**
 * The bass lick dictionary: the figures a bass player reaches for, held as
 * chord-relative degrees and beat positions and deformed to fit the progression
 * actually in front of them.
 *
 * Provenance: no entry reproduces a bass line from a particular song. Each is a
 * figure that belongs to nobody — the descending soul walk-down, the octave
 * slap, the boogie shuffle — of the kind every player of that music already
 * plays, and each records the ground it qualifies under.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import {
  type Articulation,
  foldIntoRange,
  type StringedProfile,
} from '../../core/instrument/index.js';
import { beatsPerBar, isStrongBeat, type TimeSignature } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertInteger,
  assertOneOf,
  assertRange,
  assertTimeSignature,
  clampToMidi,
} from '../../core/validation/index.js';
import type { Chord, ChordSegment } from '../../theory/chord/index.js';
import { nearestScaleTone } from '../../theory/scale/index.js';
import {
  assertDifficulty,
  type GenerationContextInput,
  resolveContextWith,
} from '../context/index.js';
import {
  BEAT_STEPS,
  deform,
  GENRES,
  type Genre,
  type GridEvent,
  mergeVocabulary,
  pickVocabulary,
  STEP_BEATS,
  type Vocabulary,
  vocabularyOfKind,
  withinCeiling,
} from '../vocabulary/index.js';
import {
  approachNote,
  bandFloor,
  bassPcOf,
  placePc,
  STRONG_VELOCITY,
  WEAK_VELOCITY,
} from './internal.js';

/**
 * One note of a lick, relative to the chord it is played over.
 *
 * A degree is 1-based and counts up from the chord's root: 1 is the root, 3 the
 * third, 8 the octave. Degrees the chord itself names — the third, fifth and
 * seventh — are taken from the chord, so the same figure comes out major over a
 * major chord and minor over a minor one; the rest are taken from the key. That
 * is what lets a figure be written once and fit a whole progression.
 *
 * @category Composition
 */
export type LickNote = GridEvent & {
  /** Chord degree, 1-based; 8 is the octave above the root. */
  degree: number;
  /** Chromatic alteration in semitones, for a flattened or raised degree. */
  alter?: number;
  /** Sounding length in sixteenths; one step when absent. */
  lengthSteps?: number;
  /** How the note is played, when it is more than a plain note. */
  articulation?: Articulation;
};

/**
 * A lick: its notes and how long the whole figure lasts.
 *
 * @category Composition
 */
export type LickMaterial = {
  /** Length of the figure in sixteenths. */
  lengthSteps: number;
  notes: LickNote[];
};

/**
 * A lick with the conditions it fits.
 *
 * @category Composition
 */
export type BassLick = Vocabulary<LickMaterial>;

/**
 * Whether a caller's material is a bass lick.
 *
 * @category Composition
 */
export function isLickMaterial(material: unknown): material is LickMaterial {
  const candidate = material as LickMaterial | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.lengthSteps === 'number' &&
    Array.isArray(candidate.notes)
  );
}

/** One note of a lick. */
function note(
  degree: number,
  step: number,
  velocity: number,
  extra?: { alter?: number; lengthSteps?: number; articulation?: LickNote['articulation'] },
): LickNote {
  return { degree, step, velocity, ...extra };
}

/** A one-bar figure on the sixteenth grid. */
const BAR: number = 4 * BEAT_STEPS;

/**
 * The meter every built-in figure is written in.
 *
 * It is declared rather than left out because an absent condition means "any",
 * and these are not any: their accents fall where a four-beat bar puts them, so
 * a waltz or a jig would be handed a figure written against a bar it does not
 * have.
 */
const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };

/**
 * The built-in bass licks, in declaration order.
 *
 * @category Composition
 */
export const BASS_LICKS: readonly BassLick[] = Object.freeze([
  {
    id: 'motownWalkDown',
    genre: 'motown',
    difficulty: 3,
    articulations: [],
    ts: FOUR_FOUR,
    fitsOver: ['maj', 'maj7', '6', 'dom7'],
    tempoRange: [88, 136],
    material: {
      lengthSteps: BAR,
      notes: [
        note(1, 0, 1),
        note(8, 4, 0.85),
        note(7, 8, 0.85),
        note(6, 10, 0.8),
        note(5, 12, 0.9),
        note(3, 14, 0.8),
      ],
    },
    provenance: {
      basis: 'idiom',
      note: 'the stepwise walk down from the octave that every player of the style plays',
    },
  },
  {
    id: 'soulOctavePush',
    genre: 'soul',
    difficulty: 2,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [72, 120],
    material: {
      lengthSteps: BAR,
      notes: [note(1, 0, 1), note(8, 6, 0.8), note(1, 8, 0.9), note(5, 14, 0.8)],
    },
    provenance: {
      basis: 'idiom',
      note: 'root and octave answering each other across the bar, with a push into the next chord',
    },
  },
  {
    id: 'funkSixteenthPop',
    genre: 'funk',
    difficulty: 4,
    articulations: ['mute', 'slide'],
    ts: FOUR_FOUR,
    tempoRange: [84, 124],
    material: {
      lengthSteps: BAR,
      notes: [
        note(1, 0, 1),
        note(1, 2, 0.4, { articulation: 'mute' }),
        note(8, 3, 0.9),
        note(1, 6, 0.5, { articulation: 'mute' }),
        note(5, 8, 0.85),
        note(1, 11, 0.4, { articulation: 'mute' }),
        note(8, 12, 0.9),
        note(7, 15, 0.7, { alter: -1 }),
      ],
    },
    provenance: {
      basis: 'idiom',
      note: 'the octave-and-ghost sixteenth figure that defines the style, with a flat seventh on the way out',
    },
  },
  {
    id: 'bluesBoogie',
    genre: 'blues',
    difficulty: 2,
    articulations: [],
    ts: FOUR_FOUR,
    fitsOver: ['maj', 'dom7'],
    tempoRange: [76, 168],
    material: {
      lengthSteps: BAR,
      notes: [
        note(1, 0, 1),
        note(5, 2, 0.85),
        note(6, 4, 0.85),
        note(7, 6, 0.85, { alter: -1 }),
        note(6, 8, 0.85),
        note(5, 10, 0.85),
        note(1, 12, 0.9),
        note(5, 14, 0.8),
      ],
    },
    provenance: {
      basis: 'traditional',
      note: 'the boogie figure of the twelve-bar tradition: root, fifth, sixth, flat seventh and back',
    },
  },
  {
    id: 'jazzWalkingApproach',
    genre: 'jazz',
    difficulty: 3,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [100, 240],
    material: {
      lengthSteps: BAR,
      notes: [note(1, 0, 1), note(3, 4, 0.85), note(5, 8, 0.85), note(6, 12, 0.85)],
    },
    provenance: {
      basis: 'idiom',
      note: 'the quarter-note walk through the chord that ends a step from wherever it is going',
    },
  },
  {
    id: 'bossaTwoFeel',
    genre: 'bossa',
    difficulty: 2,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [104, 168],
    material: {
      lengthSteps: BAR,
      notes: [note(1, 0, 1), note(5, 6, 0.85), note(1, 8, 0.95), note(5, 14, 0.8)],
    },
    provenance: {
      basis: 'traditional',
      note: 'the two-beat root-and-fifth of the Brazilian dance form, anticipated across the bar line',
    },
  },
  {
    id: 'gospelPassing',
    genre: 'gospel',
    difficulty: 4,
    articulations: ['slide'],
    ts: FOUR_FOUR,
    tempoRange: [60, 108],
    material: {
      lengthSteps: BAR,
      notes: [
        note(1, 0, 1),
        note(2, 3, 0.7),
        note(3, 4, 0.9),
        note(5, 7, 0.8),
        note(6, 8, 0.85),
        note(5, 11, 0.75),
        note(3, 12, 0.85),
        note(2, 15, 0.7),
      ],
    },
    provenance: {
      basis: 'idiom',
      note: 'the busy stepwise motion between chord tones that the church style fills its bars with',
    },
  },
  {
    id: 'countryAlternating',
    genre: 'country',
    difficulty: 1,
    articulations: [],
    ts: FOUR_FOUR,
    tempoRange: [80, 180],
    material: {
      lengthSteps: BAR,
      notes: [note(1, 0, 1), note(5, 4, 0.85), note(1, 8, 0.95), note(5, 12, 0.85)],
    },
    provenance: {
      basis: 'traditional',
      note: 'the alternating root and fifth of the dance-band bass, older than any recording of it',
    },
  },
  {
    id: 'reggaeOffbeatDrop',
    genre: 'reggae',
    difficulty: 3,
    articulations: ['mute'],
    ts: FOUR_FOUR,
    tempoRange: [64, 104],
    material: {
      lengthSteps: BAR,
      notes: [
        note(1, 2, 0.9),
        note(3, 4, 0.85),
        note(5, 6, 0.85),
        note(1, 10, 0.95),
        note(7, 14, 0.8, { alter: -1 }),
      ],
    },
    provenance: {
      basis: 'idiom',
      note: 'the figure that leaves the downbeat empty and lands after it',
    },
  },
]);

/** Semitones above the root for each degree of a major scale, 1-based. */
const MAJOR_DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/**
 * Semitones above the chord's root that a degree names.
 *
 * The chord answers for the degrees it actually contains, so a figure written
 * on the third comes out minor over a minor chord without the dictionary having
 * to hold two versions of it. Every other degree is taken from the key, which
 * is what keeps a passing tone inside the music rather than inside a template.
 *
 * The result is a signed offset, not a pitch class: degree 8 is the octave, and
 * reducing it modulo twelve would spell it as the root the figure just played,
 * turning every octave figure into a repeated note.
 */
function degreeSemitone(degree: number, alter: number, chord: Chord, key: KeyScale): number {
  const octaves = Math.floor((degree - 1) / 7);
  const within = ((degree - 1) % 7) + 1;
  const fromChord = chordDegreeSemitone(within, chord);
  const template = MAJOR_DEGREE_SEMITONES[within - 1] ?? 0;
  const semitone =
    fromChord ??
    // A degree the chord does not name is a passing tone, so the key decides it.
    nearestScaleTone(chord.rootPc + template, key) - chord.rootPc;
  // A degree names a position inside one octave; the octaves it spans are what
  // `octaves` carries. An extended chord states its ninth as fourteen semitones
  // and the key's answer may land on the octave itself, so both are folded here.
  return pitchClass(semitone) + 12 * octaves + alter;
}

/** The semitone a chord gives one of its own degrees, if it has that degree. */
function chordDegreeSemitone(degree: number, chord: Chord): number | undefined {
  for (const interval of chord.intervals) {
    if (degreeOfInterval(interval) === degree) {
      return interval;
    }
  }
  return undefined;
}

/** Which chord degree an interval from the root spells. */
function degreeOfInterval(interval: number): number | undefined {
  const within = ((interval % 12) + 12) % 12;
  if (within === 0) {
    return 1;
  }
  if (within === 1 || within === 2) {
    return 2;
  }
  if (within === 3 || within === 4) {
    return 3;
  }
  if (within === 5) {
    return 4;
  }
  if (within === 6 || within === 7 || within === 8) {
    return 5;
  }
  if (within === 9) {
    return 6;
  }
  return 7;
}

/**
 * Options controlling {@link placeLicks}.
 *
 * @category Composition
 */
export type PlaceLicksOptions = {
  /**
   * The genre whose figures may be used. Genre is what selects the material:
   * the dials then deform it, and the ceiling rejects it.
   */
  genre: Genre;
  /**
   * How busy the line is, in [0, 1]. It decides both how often a segment takes
   * a figure at all and, above its middle setting, how much the figure is
   * syncopated — one dial, because "less busy" means both. Sugar for
   * `ctx: { complexity: { rhythmic } }`; the context wins over both.
   *
   * @defaultValue 0.6
   */
  density?: number;
  /**
   * The hardest figure that may be used, 1 to 5. Sugar for
   * `ctx: { complexity: { difficulty } }`; the context wins over both.
   */
  difficulty?: number;
  /** Seed for the deterministic PRNG. Sugar for `ctx: { seed }`. */
  seed?: number;
  /** Tempo in BPM. Sugar for `ctx: { bpm }`. */
  bpm?: number;
  /** Time signature; defaults to 4/4. */
  ts?: TimeSignature;
  /**
   * Target register as a base MIDI octave; roots land around `octave*12+12`.
   *
   * @defaultValue 2
   */
  octave?: number;
  /** The instrument the line is written for; its range always applies. */
  instrument?: StringedProfile;
  /**
   * The generation context. Its `vocabulary` brings the caller's own figures,
   * its `complexity.ornament` decides how much decoration survives, and its
   * `complexity.difficulty` is the ceiling figures are rejected against.
   */
  ctx?: GenerationContextInput;
  /**
   * Maximum number of segments {@link placeLicks} may lay figures over. One
   * figure is placed per segment, so this is the guard against an unbounded
   * caller rather than a limit on any search.
   *
   * @defaultValue 1000000
   */
  budget?: number;
};

const DEFAULT_TS: TimeSignature = FOUR_FOUR;
const DEFAULT_OCTAVE = 2;
const DEFAULT_BPM = 120;

/** How much of the line is figures when the caller names nothing. */
const DEFAULT_LICK_DENSITY = 0.6;

const EPS = 1e-9;

/**
 * Lay licks over a chord placement.
 *
 * Each segment is offered the figures whose conditions it meets — the genre,
 * the chord quality, the tempo, and the difficulty ceiling — and one of them is
 * chosen by a draw addressed to that segment, so changing a chord elsewhere
 * leaves this segment's figure where it was. A segment that takes no figure
 * gets its root, and the last note before a chord change leads into the next
 * root by step, the way a walking line does.
 *
 * @param timeline Chord segments to play over; they need not be pre-sorted.
 * @param key Key context, which answers for the degrees the chords do not.
 * @param opts Genre, density, ceiling and seed.
 * @returns Bass notes sorted by onset, non-overlapping.
 * @throws If a segment has a non-positive duration, or the genre is not one
 *   this library names.
 *
 * @example
 * ```ts
 * import { majorKey, makeChord, placeLicks } from '@libraz/libcantus';
 * const timeline = [
 *   { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj7') },
 *   { startBeat: 4, endBeat: 8, chord: makeChord(5, 'maj7') },
 * ];
 * const notes = placeLicks(timeline, majorKey(0), { genre: 'motown', seed: 7 });
 * ```
 *
 * @category Composition
 */
export function placeLicks(
  timeline: readonly ChordSegment[],
  key: KeyScale,
  opts: PlaceLicksOptions,
): NoteEvent[] {
  assertGenerationBudget(timeline.length, 'lick segments', opts.budget);
  const genre = assertOneOf(opts.genre, GENRES, 'lick genre');
  const ts = opts.ts ?? DEFAULT_TS;
  assertTimeSignature(ts, 'lick time signature');
  const octave = opts.octave ?? DEFAULT_OCTAVE;
  assertInteger(octave, 'lick octave', -1, 8);
  if (opts.density !== undefined) {
    assertRange(opts.density, 0, 1, 'lick density');
  }
  const segments = [...timeline].sort((a, b) => a.startBeat - b.startBeat);
  for (const segment of segments) {
    assertRange(segment.startBeat, 0, Number.MAX_SAFE_INTEGER, 'lick segment startBeat');
    if (segment.endBeat <= segment.startBeat) {
      throw new InvalidInputError(
        `lick segment at beat ${segment.startBeat} must have a positive duration`,
      );
    }
  }
  if (segments.length === 0) {
    return [];
  }

  const resolved = resolveContextWith(opts.ctx, {
    seed: opts.seed,
    bpm: opts.bpm,
    rhythmic: opts.density,
  });
  const draw = resolved.part('bass');
  const bpm = resolved.bpm ?? DEFAULT_BPM;
  const density = resolved.rhythmic ?? DEFAULT_LICK_DENSITY;
  const difficulty =
    resolved.difficulty ??
    (opts.difficulty === undefined
      ? undefined
      : assertDifficulty(opts.difficulty, 'lick difficulty'));
  const named = resolved.instrument('bass');
  const instrument =
    opts.instrument ?? (named !== undefined && named.kind === 'stringed' ? named : undefined);
  const low = bandFloor(octave * 12 + 12, instrument);

  const dictionary = mergeVocabulary(
    BASS_LICKS,
    vocabularyOfKind(resolved.vocabulary, isLickMaterial),
  );
  // Naming an instrument is the request that the line be playable on it, so a
  // figure calling for a technique it cannot produce — a slide on an instrument
  // with no slide — is not offered rather than written and misread.
  const playable = instrument === undefined ? {} : { articulations: instrument.articulations };
  const barBeats = beatsPerBar(ts);

  const raw: { startBeat: number; pitch: number; velocity: number; note?: LickNote }[] = [];
  /** The last pitch that sounded, which decides where a connecting tone leads. */
  let anchor = low;
  /** Where the last root sat, which is what keeps the line in its register. */
  let rootAnchor = low;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) {
      continue;
    }
    const rootPc = bassPcOf(segment.chord);
    const onsets: number[] = [];
    let lastTilePlayed = false;
    let firstOnset = segment.startBeat;

    // A figure is a bar long and a chord is not: a ballad or a modal vamp holds
    // one chord for four of them. The figure is laid across the whole segment,
    // one tile per bar of it, and each tile draws its own figure at its own
    // address — so the bar after the first is played rather than held, and a
    // chord elsewhere in the piece changing does not move any of them.
    for (let tile = 0; ; tile += 1) {
      const tileStart = segment.startBeat + tile * barBeats;
      const remaining = segment.endBeat - tileStart;
      if (remaining <= EPS) {
        break;
      }
      // The figure this tile would play is decided before the density dial is
      // consulted, so where its root sounds does not move as the dial travels:
      // a genre whose figures land after the downbeat keeps its root there
      // whether or not this turn of the dial takes the whole figure.
      const entry = pickVocabulary(
        dictionary,
        { genre, bpm, ts, difficulty, quality: segment.chord.quality, ...playable },
        draw,
        'lickChoice',
        index,
        tile,
      );
      const takesLick = entry !== undefined && draw.prob(density, 'lick', index, tile);
      const notes = takesLick
        ? fitToSegment(
            entry.material,
            remaining,
            density,
            resolved,
            draw,
            [index, tile],
            bpm,
            difficulty,
          )
        : undefined;
      lastTilePlayed = notes !== undefined;

      const rootStep = entry === undefined ? 0 : anchorStepOf(entry.material, remaining);
      const rootAt = tileStart + rootStep * STEP_BEATS;
      if (tile === 0) {
        firstOnset = rootAt;
      }
      onsets.push(rootAt);
      // Roots are placed against the root before them rather than against the
      // last note that sounded: a figure that ends on its octave would
      // otherwise pull the next root up with it, and a four-bar vamp would
      // climb out of the register the caller asked for by its second bar.
      rootAnchor = placePc(rootPc, rootAnchor, low);
      anchor = rootAnchor;
      // Where the figure states its own note on this position, that note is the
      // one that sounds: the two share an onset, and the zero-length root is
      // dropped when durations are measured.
      raw.push({ startBeat: rootAt, pitch: rootAnchor, velocity: STRONG_VELOCITY });

      if (notes) {
        const figureRoot = placePc(pitchClass(segment.chord.rootPc), rootAnchor, low);
        for (const lickNote of notes) {
          const at = tileStart + lickNote.step * STEP_BEATS;
          // Placed against the figure's own root rather than folded one note at
          // a time into the register band, which is what an octave figure
          // needs: its octave has to stay an octave.
          const offset = degreeSemitone(lickNote.degree, lickNote.alter ?? 0, segment.chord, key);
          anchor = figureRoot + offset;
          onsets.push(at);
          raw.push({
            startBeat: at,
            pitch: anchor,
            velocity: Math.round(
              (isStrongBeat(at, ts) ? STRONG_VELOCITY : WEAK_VELOCITY) * lickNote.velocity,
            ),
            note: lickNote,
          });
        }
      }
    }

    // The connecting tone between one figure and the next is the walking line's
    // approach note, reused: the figures are the vocabulary, and leading into
    // the next chord is grammar that belongs to neither of them. The beat before
    // a chord change therefore always sounds — the figure's own note where it
    // has one there, this one where it does not — so a busier setting never
    // empties a beat a quieter one filled.
    const next = segments[index + 1];
    if (next && lastTilePlayed) {
      const approachAt = next.startBeat - STEP_BEATS * BEAT_STEPS;
      const alreadySounds = onsets.some((onset) => Math.abs(onset - approachAt) < EPS);
      if (approachAt > firstOnset + EPS && !alreadySounds) {
        const nextRoot = placePc(bassPcOf(next.chord), rootAnchor, low);
        const midi = approachNote(
          nextRoot,
          anchor,
          low,
          key,
          draw.prob(0.5, 'lickApproach', index),
        );
        anchor = midi;
        raw.push({ startBeat: approachAt, pitch: midi, velocity: WEAK_VELOCITY });
      }
    }
  }

  raw.sort((a, b) => a.startBeat - b.startBeat);
  const lastEnd = segments.reduce((m, seg) => Math.max(m, seg.endBeat), Number.NEGATIVE_INFINITY);
  const out: NoteEvent[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item) {
      continue;
    }
    const nextStart = raw[i + 1]?.startBeat ?? lastEnd;
    const written = item.note?.lengthSteps;
    const durationBeat = Math.min(
      nextStart - item.startBeat,
      written === undefined ? Number.POSITIVE_INFINITY : written * STEP_BEATS,
    );
    if (durationBeat <= EPS) {
      continue;
    }
    const placed = instrument ? foldIntoRange(item.pitch, instrument) : item.pitch;
    const event: NoteEvent = {
      pitch: clampToMidi(placed, 'generated bass pitch'),
      startBeat: item.startBeat,
      durationBeat,
      velocity: Math.max(1, Math.min(127, item.velocity)),
    };
    if (item.note?.articulation) {
      event.articulation = item.note.articulation;
    }
    out.push(event);
  }
  return out;
}

/**
 * The step a figure begins on, which is where the segment sounds its root.
 *
 * Reading it from the material rather than from the deformed figure is what
 * keeps the position fixed as the density dial travels: thinning can take the
 * figure's first note away, and the root would otherwise jump to the downbeat.
 *
 * @param material The figure the segment would play.
 * @param spanBeats Length of the segment.
 * @returns The step, or 0 when the figure starts past the end of the segment.
 */
function anchorStepOf(material: LickMaterial, spanBeats: number): number {
  let first: number | undefined;
  for (const note of material.notes) {
    if (first === undefined || note.step < first) {
      first = note.step;
    }
  }
  if (first === undefined || first < 0 || first * STEP_BEATS >= spanBeats - EPS) {
    return 0;
  }
  return first;
}

/**
 * Deform a figure to the segment it is being played over, and reject it if the
 * result is beyond the ceiling.
 *
 * The three never fight because each acts once and in one direction: the genre
 * has already chosen this figure, the dials reshape it here, and the ceiling
 * only says yes or no to what came out.
 */
function fitToSegment(
  material: LickMaterial,
  spanBeats: number,
  density: number,
  resolved: ReturnType<typeof resolveContextWith>,
  draw: ReturnType<ReturnType<typeof resolveContextWith>['part']>,
  path: readonly (string | number)[],
  bpm: number,
  difficulty: number | undefined,
): LickNote[] | undefined {
  const deformed = deform(
    material.notes,
    {
      // The one density the whole generator reads, defaults included: passing
      // the documented default explicitly and leaving it out have to be the
      // same request, and they were not while the figure was deformed by the
      // raw dial and chosen by the resolved one.
      rhythmic: density,
      ...(resolved.ornament === undefined ? {} : { ornament: resolved.ornament }),
      isOrnament: (event) => (event as LickNote).articulation === 'mute',
      spanSteps: material.lengthSteps,
    },
    draw,
    'lickShape',
    ...path,
  );
  // A figure longer than the chord it is played over is cut at the chord
  // change: the harmony is the thing the figure exists to serve.
  const spanSteps = spanBeats / STEP_BEATS;
  const inside = deformed.filter((lickNote) => lickNote.step < spanSteps - EPS);
  if (inside.length === 0 || !withinCeiling(inside, bpm, difficulty)) {
    return undefined;
  }
  return inside;
}
