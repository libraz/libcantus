/**
 * Lay the figures of the dictionary over a chord progression.
 *
 * A segment takes a figure its genre plays, chosen by a draw addressed to that
 * segment, and the figure's degrees are read against the chord sounding under
 * it. What the figures are is `licks-data.ts`; which pitch a degree asks for is
 * `degrees.ts`. This module is what places them: which segment takes one, how
 * it is fitted to the span, and how one figure leads into the next.
 */

import { BEAT_EPS } from '../../analyze/adjacency.js';
import { foldIntoRange, type StringedProfile } from '../../core/instrument/index.js';
import {
  beatsPerBar,
  isStrongBeat,
  type MeterLike,
  meterAt,
  type TimeSignature,
  toMeterData,
} from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { NoteEvent } from '../../core/types.js';
import {
  assertArray,
  assertGenerationBudget,
  assertInteger,
  assertOneOf,
  assertRecord,
  clampToMidi,
} from '../../core/validation/index.js';
import type { ChordSegment } from '../../theory/chord/index.js';
import { type KeyLike, toKeyScale } from '../../theory/scale/index.js';
import { type ChordLike, toChordData } from '../../theory/symbol/index.js';
import { assertDifficulty, type GenerationContextInput, resolveContext } from '../context/index.js';
import {
  BEAT_STEPS,
  deform,
  GENRES,
  type Genre,
  mergeVocabulary,
  pickVocabulary,
  STEP_BEATS,
  vocabularyOfKind,
  withinCeiling,
} from '../vocabulary/index.js';
import { degreeSemitone, impliedScaleTones } from './degrees.js';
import {
  approachNote,
  assertBassSegments,
  barTiles,
  bassPcOf,
  bassRegister,
  DEFAULT_OCTAVE,
  DEFAULT_TS,
  placeAboveBass,
  placePc,
  placeRoot,
  STRONG_VELOCITY,
  WEAK_VELOCITY,
} from './internal.js';
import type { LickMaterial, LickNote } from './licks-data.js';
import { BASS_LICKS, isLickMaterial } from './licks-data.js';

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
   * The hardest figure that may be used, 1 to 5. Sugar for
   * `ctx: { complexity: { difficulty } }`; the context wins over both.
   */
  difficulty?: number;
  /** Time signature, in any form that names one; defaults to 4/4. */
  ts?: MeterLike;
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
   *
   * Its `complexity.rhythmic` is how busy the line is, in [0, 1]: it decides
   * both how often a segment takes a figure at all and, above its middle
   * setting, how much the figure is syncopated — one dial, because "less busy"
   * means both. Its `bpm` is the tempo the ceiling is measured against, and its
   * `seed` fixes which figures are chosen and where they land.
   *
   * @defaultValue `{ seed: 0, bpm: 120, complexity: { rhythmic: 0.6 } }`
   */
  ctx?: GenerationContextInput;
  /**
   * Maximum number of segments {@link placeLicks} may lay figures over, and of
   * bars those segments span. One figure is placed per bar of a segment, so
   * both are counted: this is the guard against an unbounded caller — a segment
   * running to a beat far past the music — rather than a limit on any search.
   *
   * @defaultValue 1000000
   */
  budget?: number;
};

const DEFAULT_BPM = 120;

/** How much of the line is figures when the caller names nothing. */
const DEFAULT_LICK_DENSITY = 0.6;

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
 * @param timeline Chord segments to play over; they need not be pre-sorted, and
 *   each segment's chord may be written as a chord symbol.
 * @param key Key context, which answers for the degrees the chords do not; a
 *   key name such as `'C major'` is read as that key.
 * @param opts Genre, density, ceiling and seed.
 * @returns Bass notes sorted by onset, non-overlapping.
 * @throws If a segment has a non-positive duration, two segments overlap, or
 *   the genre is not one this library names. A bass part is monophonic, so
 *   overlapping segments are refused here exactly as {@link generateBassLine}
 *   refuses them rather than being laid over each other.
 *
 * @example
 * ```ts
 * import { majorKey, makeChord, placeLicks } from '@libraz/libcantus';
 * const timeline = [
 *   { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj7') },
 *   { startBeat: 4, endBeat: 8, chord: makeChord(5, 'maj7') },
 * ];
 * const notes = placeLicks(timeline, majorKey(0), { genre: 'motown', ctx: { seed: 7 } });
 * ```
 *
 * @category Composition
 */
export function placeLicks(
  timeline: readonly (Omit<ChordSegment, 'chord'> & { chord: ChordLike })[],
  key: KeyLike,
  opts: PlaceLicksOptions,
): NoteEvent[] {
  const asked = assertRecord<PlaceLicksOptions>(opts, 'opts');
  const placement = assertArray<Omit<ChordSegment, 'chord'> & { chord: ChordLike }>(
    timeline,
    'timeline',
  );
  assertGenerationBudget(placement.length, 'lick segments', asked.budget);
  const genre = assertOneOf(asked.genre, GENRES, 'lick genre');
  const ts = meterAt(0, toMeterData(asked.ts ?? DEFAULT_TS, 'ts'));
  const octave = asked.octave ?? DEFAULT_OCTAVE;
  assertInteger(octave, 'lick octave', -1, 8);
  // Key and chords are read into their plain form once, here at the boundary;
  // everything below works on the plain forms alone.
  const scale = toKeyScale(key);
  const segments: ChordSegment[] = placement
    .map((segment) => ({ ...segment, chord: toChordData(segment.chord) }))
    .sort((a, b) => a.startBeat - b.startBeat);
  assertBassSegments(segments);
  if (segments.length === 0) {
    return [];
  }
  // A figure is a bar long, so what is written is one figure per bar of the
  // placement rather than one per segment: a single segment running to a beat
  // the caller computed from a loop length or read out of a project file lays
  // as many bars as that number holds. The count is charged before any of them
  // is built, which is the same estimate the phrase-shape styles make before
  // reaching the same tiling.
  const barBeats = beatsPerBar(ts);
  const estimatedBars = segments.reduce(
    (count, segment) =>
      count + Math.max(1, Math.ceil((segment.endBeat - segment.startBeat) / barBeats)),
    0,
  );
  assertGenerationBudget(estimatedBars, 'lick bars', asked.budget);

  const resolved = resolveContext(asked.ctx);
  const draw = resolved.part('bass');
  const bpm = resolved.bpm ?? DEFAULT_BPM;
  const density = resolved.rhythmic ?? DEFAULT_LICK_DENSITY;
  // The caller's own ceiling is validated whether or not the context also names
  // one: whether the context does is not something the caller of this surface
  // can see, so an out-of-range value is rejected the same way either time.
  // Only leaving it out skips the check.
  const supplied =
    asked.difficulty === undefined
      ? undefined
      : assertDifficulty(asked.difficulty, 'lick difficulty');
  const difficulty = resolved.difficulty ?? supplied;
  const { instrument, low } = bassRegister(resolved.instrument('bass'), asked.instrument, octave);

  const dictionary = mergeVocabulary(
    BASS_LICKS,
    vocabularyOfKind(resolved.vocabulary, isLickMaterial),
  );
  // Naming an instrument is the request that the line be playable on it, so a
  // figure calling for a technique it cannot produce — a slide on an instrument
  // with no slide — is not offered rather than written and misread.
  const playable = instrument === undefined ? {} : { articulations: instrument.articulations };

  const raw: RawLickNote[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) {
      continue;
    }
    const rootPc = bassPcOf(segment.chord);
    // Where this chord sounds its bass note, and what its own quality settles
    // about the degrees it does not state: both are properties of the chord, so
    // both are read once for the whole segment.
    const rootMidi = placeRoot(rootPc, low);
    const implied = impliedScaleTones(segment.chord);
    let lastTilePlayed = false;
    let playedTile: PlayedTile | undefined;
    let firstOnset = segment.startBeat;

    // Each tile draws its own figure at its own address, so the bar after the
    // first is played rather than held, and a chord elsewhere in the piece
    // changing does not move any of them.
    const tiles = barTiles(segment.startBeat, segment.endBeat, ts);
    for (let tile = 0; tile < tiles.length; tile += 1) {
      const tileStart = tiles[tile]?.startBeat ?? segment.startBeat;
      const remaining = segment.endBeat - tileStart;
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
            ts,
          )
        : undefined;
      lastTilePlayed = notes !== undefined;
      if (notes !== undefined && entry !== undefined) {
        playedTile = { material: entry.material, tileStart };
      }

      const rootStep = entry === undefined ? 0 : anchorStepOf(entry.material, remaining);
      const rootAt = tileStart + rootStep * STEP_BEATS;
      if (tile === 0) {
        firstOnset = rootAt;
      }
      // Where the figure states its own note on this position, that note is the
      // one that sounds: the two share an onset, and the zero-length root is
      // dropped when durations are measured.
      raw.push({ startBeat: rootAt, pitch: rootMidi, velocity: STRONG_VELOCITY });

      if (notes) {
        // Over a slash chord the figure is written above the bass the chord
        // names, not folded into the register band: the band is an octave wide,
        // so a root folded into it sounds under a bass placed anywhere but the
        // bottom of it — and a `C/E` whose C sounds under its own E is a
        // root-position C, which is not the chord the part was written on.
        const figureRoot =
          segment.chord.bassPc === undefined
            ? placePc(pitchClass(segment.chord.rootPc), rootMidi, low)
            : placeAboveBass(pitchClass(segment.chord.rootPc), rootMidi);
        for (const lickNote of notes) {
          const at = tileStart + lickNote.step * STEP_BEATS;
          // Placed against the figure's own root rather than folded one note at
          // a time into the register band, which is what an octave figure
          // needs: its octave has to stay an octave.
          const offset = degreeSemitone(
            lickNote.degree,
            lickNote.alter ?? 0,
            segment.chord,
            scale,
            implied,
          );
          // The figure's plain root on the anchor onset is that onset's bass
          // note, so over a slash chord it sounds the written bass: the two
          // notes share the position and only one of them survives, and which
          // one it is must not decide what the chord change sounds like. The
          // rest of the figure stays measured from the chord's own root.
          const pitch =
            Math.abs(at - rootAt) < BEAT_EPS && lickNote.degree === 1 && (lickNote.alter ?? 0) === 0
              ? rootMidi
              : figureRoot + offset;
          raw.push({
            startBeat: at,
            pitch,
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
      // The connecting tone is the figure's own last note wherever the figure
      // states one in the beat before the change. Fixing it to the head of that
      // beat left the figure's real final onset — a sixteenth or two later in
      // seven of the nine genres — sounding its template degree into the next
      // chord, so the note that actually leads into the change was whatever the
      // figure happened to end on. Where the figure sounds nothing in that beat
      // the tone is introduced on the beat, as it always was, which is what
      // keeps the beat before a chord change from ever falling silent.
      const lastBeat = next.startBeat - STEP_BEATS * BEAT_STEPS;
      const approachAt = materialOnsetIn(playedTile, lastBeat, next.startBeat) ?? lastBeat;
      if (approachAt > firstOnset + BEAT_EPS) {
        const nextRoot = placeRoot(bassPcOf(next.chord), low);
        const occupied = soundingAt(raw, approachAt);
        // What matters is that the beat before the change leads into it by
        // step, not that something sounds there: the figure's own fixed degree
        // holds that beat whatever the next chord is, so leaving it alone
        // because it is occupied is what kept a walking line from ever walking
        // into the change. A note already a step away is the approach and
        // stands; any other is replaced by the connecting tone, which keeps the
        // figure's rhythm and takes over its pitch.
        const distance = occupied === undefined ? 0 : Math.abs(occupied.pitch - nextRoot);
        if (occupied === undefined || distance < 1 || distance > 2) {
          const from = lastPitchBefore(raw, approachAt, rootMidi);
          const midi = approachNote(nextRoot, from, scale, draw.prob(0.5, 'lickApproach', index));
          if (occupied === undefined) {
            raw.push({ startBeat: approachAt, pitch: midi, velocity: WEAK_VELOCITY });
          } else {
            occupied.pitch = midi;
          }
        }
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
    if (durationBeat <= BEAT_EPS) {
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

/** A note on its way into the line, before durations are measured from it. */
type RawLickNote = {
  startBeat: number;
  pitch: number;
  velocity: number;
  note?: LickNote;
};

/**
 * The note carrying a position, if one is written there.
 *
 * Where a figure states its own note on a position the segment also sounds its
 * root on, the last one written is the one that survives the duration pass, so
 * that is the note the position carries.
 */
function soundingAt(raw: readonly RawLickNote[], at: number): RawLickNote | undefined {
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const item = raw[index];
    if (item !== undefined && Math.abs(item.startBeat - at) < BEAT_EPS) {
      return item;
    }
  }
  return undefined;
}

/** The figure a tile played, and where that tile began. */
type PlayedTile = { material: LickMaterial; tileStart: number };

/**
 * The last onset the figure itself states between two positions, if any.
 *
 * Read from the material rather than from the notes the density dial left, as
 * the figure's anchor step is: where a chord change is led into from is a
 * property of the figure, and reading it off the thinned copy would move it as
 * the dial travels — a position that sounded at one setting would fall silent
 * at the next, which is the one thing the dial promises never to do.
 */
function materialOnsetIn(
  played: PlayedTile | undefined,
  from: number,
  to: number,
): number | undefined {
  if (played === undefined) {
    return undefined;
  }
  let last: number | undefined;
  for (const note of played.material.notes) {
    const at = played.tileStart + note.step * STEP_BEATS;
    if (at < from - BEAT_EPS || at > to - BEAT_EPS) {
      continue;
    }
    last = last === undefined ? at : Math.max(last, at);
  }
  return last;
}

/**
 * The pitch the line is coming from at a position, which decides which side of
 * the next chord's bass it is approached from.
 *
 * @param raw The notes written so far, in the order they were written.
 * @param at The position being led into.
 * @param fallback The pitch to answer with when nothing precedes it.
 */
function lastPitchBefore(raw: readonly RawLickNote[], at: number, fallback: number): number {
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const item = raw[index];
    if (item !== undefined && item.startBeat < at - BEAT_EPS) {
      return item.pitch;
    }
  }
  return fallback;
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
  if (first === undefined || first < 0 || first * STEP_BEATS >= spanBeats - BEAT_EPS) {
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
  resolved: ReturnType<typeof resolveContext>,
  draw: ReturnType<ReturnType<typeof resolveContext>['part']>,
  path: readonly (string | number)[],
  bpm: number,
  difficulty: number | undefined,
  ts: TimeSignature,
): LickNote[] | undefined {
  const deformed = deform(
    material.notes,
    {
      // The figure is thinned against the bar it is played in, not against a
      // four-four ladder: a downbeat of the meter in force must outrank an
      // offbeat of some other meter.
      ts,
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
  const inside = deformed.filter((lickNote) => lickNote.step < spanSteps - BEAT_EPS);
  if (inside.length === 0 || !withinCeiling(inside, bpm, difficulty)) {
    return undefined;
  }
  return inside;
}
