import { meterAt, pulseBeats, toMeterData } from '../../core/meter/index.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertNoteEvents,
  assertOneOf,
  assertRange,
  assertRecord,
  assertTimeSignature,
  soundingNotesOnly,
} from '../../core/validation/index.js';
import type { Chord } from '../../theory/chord/index.js';
import { makeChord } from '../../theory/chord/index.js';
import { roleOf } from '../../theory/harmony/index.js';
import { resolveKey } from '../../theory/scale/index.js';
import { resolveContext } from '../context/index.js';
import type { ChordSpan } from '../progression/index.js';
import { classifyMelodyTones, snapToPulse } from './nct.js';

export type { ClassifiedMelodyTone, MelodyToneRole } from './nct.js';
export { classifyMelodyTones } from './nct.js';

import type { Candidate, HarmonizeOptions, HarmonizeResult } from './internal.js';
import {
  DEFAULT_METER,
  DEFAULT_PLACEMENT,
  defaultHarmonicRhythm,
  FALLBACK,
  inferKey,
  TIE_BREAK_JITTER,
} from './internal.js';
import { keyFitCost, tessituraCost } from './key-fit.js';
import { harmonizeOnce } from './search.js';
import { buildSegments, mergeRepeats, phraseEndSegments } from './segments.js';

export type {
  HarmonizeOptions,
  HarmonizePlacement,
  HarmonizeResult,
  MelodyNote,
} from './internal.js';

import { buildCandidates, REHARMONIZE_DIAL, REHARMONIZE_STRENGTHS } from './candidates.js';
import { segmentIndexAt } from './segments.js';

/**
 * Harmonize a melody with a min-cost chord progression.
 *
 * The melody's ornaments are classified first, from the melody and the metre
 * alone (see {@link classifyMelodyTones}); the chords then have to explain the
 * structural tones only, so a passing tone no longer buys itself a chord. The
 * melody is segmented by `harmonicRhythm`; each segment is scored against the
 * candidate chords the harmonic dial opens — the key's own triads, then the
 * secondary dominants, then the parallel mode's chords, one at a time as
 * `ctx.complexity.harmonic` rises from 0 to 1 — by the fit of those structural
 * tones, and a Viterbi search picks the lowest-cost path using a
 * functional-flow transition cost and a cadence bonus at the end of the melody
 * it is given — one cadence, at the close, unless `phraseEnds` names the closes
 * inside a longer line, and then one at each of them as well. Runs of the same
 * chord are reported once, so the chord count follows the harmony rather than
 * the grid.
 *
 * With `placement.transposeSearch` the melody is moved into the key it is
 * harmonized in, and `transposeSemitones` reports how far; with
 * `placement.octaveSearch` it is moved by octaves into a comfortable register,
 * which leaves the key and the chords untouched. Both may be set, and the
 * reported shift is their sum.
 *
 * The `seed` drives a deterministic tie-break only: it perturbs candidates by a
 * magnitude far below any real cost difference (see `TIE_BREAK_JITTER`),
 * so it can decide between chords or paths of otherwise-equal cost but never
 * overrides melody fit or functional flow. For a well-determined melody the
 * result is identical across seeds; the same seed always yields the same result.
 *
 * @param opts The melody and, optionally, the generation context, key, harmonic
 *   rhythm, reharmonization strength, placement search, meter, and seed. Only
 *   `melody` is required.
 * @returns The chosen transpose, key, chord path, and per-note roles.
 * @example
 * ```ts
 * import { harmonizeMelody } from '@libraz/libcantus';
 * const result = harmonizeMelody({
 *   melody: [
 *     { pitch: 60, startBeat: 0, durationBeat: 1 },
 *     { pitch: 64, startBeat: 1, durationBeat: 1 },
 *   ],
 * });
 * result.chords; // one ChordSpan per chord change, on the harmonic-rhythm grid
 * ```
 * @category Reharmonization
 */
export function harmonizeMelody(opts: HarmonizeOptions): HarmonizeResult {
  assertRecord(opts, 'harmonize options');
  assertNoteEvents(opts.melody, 'harmonize melody', {
    allowNonPositiveDuration: true,
    budget: opts.budget,
  });
  const phraseEnds = opts.phraseEnds ?? [];
  for (const end of phraseEnds) {
    assertFiniteNumber(end, 'harmonize phrase end');
  }
  const soundingMelody = soundingNotesOnly(opts.melody);
  const ts = meterAt(0, toMeterData(opts.ts ?? DEFAULT_METER, 'ts'));
  assertTimeSignature(ts);
  const requestedKey = opts.key ?? 'infer';
  // The key is read once, here at the boundary, and kept whole: the search
  // below wants only the pitch classes, and the result reports the key the
  // caller named — spelling and all — rather than the pitch classes it worked
  // from. An inferred key is read the same way, so both arrive spelled.
  const resolvedKey = resolveKey(
    requestedKey === 'infer' ? inferKey(soundingMelody) : requestedKey,
  );
  const key = resolvedKey.scale;
  const placement = opts.placement ?? DEFAULT_PLACEMENT;
  const ctx = resolveContext(opts.ctx);
  // `reharmonize` names three points on the dial the context sets continuously,
  // so a caller who says `'secondaryDominant'` gets exactly the vocabulary that
  // name has always meant. The name is checked whether or not the context also
  // sets the dial: a value from a config file that reached the table unchecked
  // would read as `undefined`, and the NaN dial position that follows opens the
  // secondary-dominant family in full while suppressing the borrowed one.
  const reharmonize = assertOneOf(
    opts.reharmonize ?? 'diatonic',
    REHARMONIZE_STRENGTHS,
    'reharmonize',
  );
  const harmonic = ctx.harmonic ?? REHARMONIZE_DIAL[reharmonize];
  // Nothing to harmonize: inventing a tonic bar here would silently insert a
  // ghost chord into a chart built by harmonizing sections and concatenating
  // them. The sibling generators return an empty result for empty input too.
  if (soundingMelody.length === 0) {
    return { transposeSemitones: 0, key: resolvedKey, chords: [], melodyRoles: [] };
  }
  const candidates = buildCandidates(key, harmonic);
  const candAt = (i: number): Candidate => candidates[i] ?? FALLBACK;
  const draw = ctx.part('harmony');
  const jitter = candidates.map((_, index) => draw.at('jitter', index) * TIE_BREAK_JITTER);

  // Read every onset and release as the metric position it is playing. A melody
  // arrives as note events from a DAW or MIDI track, so its beats carry the
  // timing of a performance; without this a few milliseconds of jitter would put
  // a note in the slot before the one it belongs to, weigh a sliver of it as if
  // it sounded there, and change the chords chosen for the whole phrase.
  const pulse = pulseBeats(ts);
  const spans = soundingMelody.map((note) => ({
    startBeat: snapToPulse(note.startBeat, pulse),
    endBeat: snapToPulse(note.startBeat + note.durationBeat, pulse),
  }));

  const melodyStart = spans.reduce(
    (start, span) => Math.min(start, span.startBeat),
    Number.POSITIVE_INFINITY,
  );
  // Accumulated from the melody alone rather than from beat 0: a pickup sounds
  // before the first downbeat, and a melody written entirely in one — an
  // upbeat lifted out of a chart — ended at beat 0 by the accumulator's own
  // starting value, which grew a grid past where the melody reaches and put the
  // cadence bonus on an empty segment after its last note.
  const melodyEnd = spans.reduce(
    (end, span) => Math.max(end, span.endBeat),
    Number.NEGATIVE_INFINITY,
  );
  // Any positive value is honoured: a silent clamp would make the option mean
  // something different here than it does on the analysis side. A value small
  // enough to make the search explode is caught by the budget assertions below,
  // not rounded away.
  const hr = assertRange(
    opts.harmonicRhythm ?? defaultHarmonicRhythm(ts),
    Number.MIN_VALUE,
    Number.MAX_SAFE_INTEGER,
    'harmonic rhythm',
  );
  const { segments, innerEnds, bounds, segmentStart } = buildSegments(
    spans,
    soundingMelody,
    ts,
    { start: melodyStart, end: melodyEnd, harmonicRhythm: hr },
    phraseEnds,
    opts.budget,
  );

  const { closing: closingSegments, named: namedEndSegments } = phraseEndSegments(
    segments,
    innerEnds,
  );
  // A cadence needs two chords to be told apart, so the articulation rule can
  // only be applied where the vocabulary offers a second harmony to move to.
  const articulatedSegments =
    new Set(candidates.map((c) => `${c.rootPc}:${c.quality}`)).size > 1
      ? namedEndSegments
      : new Set<number>();

  // Two independent axes: the semitone shift that puts the melody in the key it
  // is harmonized in, and the octave that puts it in a comfortable register.
  // Octaves preserve pitch classes, so they can only move the register.
  const semitoneShifts: number[] = [0];
  if (placement.transposeSearch) {
    for (let s = -6; s <= 6; s += 1) {
      if (s !== 0) {
        semitoneShifts.push(s);
      }
    }
  }
  const octaveShifts: number[] = placement.octaveSearch ? [0, -12, 12] : [0];
  const transposes = semitoneShifts.flatMap((s) => octaveShifts.map((o) => s + o));
  // The estimate is the search itself: one pass per placement visits every pair
  // of candidates in every slot, and that product dominates everything else the
  // call does. A caller harmonizing a whole piece with the placement search on
  // raises `budget` to cover it, the way the sibling generators are given room
  // for the work they were asked for.
  assertGenerationBudget(
    transposes.length * segments.length * candidates.length * candidates.length,
    'harmonization placement search',
    opts.budget,
  );

  let bestCost = Number.POSITIVE_INFINITY;
  let bestTs = 0;
  let bestPath: number[] = [];
  for (const shift of transposes) {
    const shifted = soundingMelody.map((n) => ({ ...n, pitch: n.pitch + shift }));
    const { cost, path } = harmonizeOnce(
      shifted,
      key,
      candidates,
      segments,
      jitter,
      closingSegments,
      articulatedSegments,
    );
    const total = cost + keyFitCost(shifted, key) + tessituraCost(shifted);
    if (total < bestCost) {
      bestCost = total;
      bestTs = shift;
      bestPath = path;
    }
  }

  const chords = mergeRepeats(
    bestPath.map((ci, s) => {
      const cand = candAt(ci);
      const chord: ChordSpan = {
        rootPc: cand.rootPc,
        quality: cand.quality,
        startBeat: segments[s]?.startBeat ?? segmentStart + s * hr,
      };
      if (cand.degree !== undefined) {
        chord.degree = cand.degree;
      }
      if (cand.secondaryDominant) {
        chord.secondaryDominant = true;
      }
      return chord;
    }),
  );

  // A note's role is its role in the chord the search chose for the slot it was
  // charged against, so the slot is read from the same snapped onset the cost
  // model read: taking the raw onset would report a note that begins a few
  // milliseconds before a boundary against the chord on the other side of it,
  // which is the performance jitter the snap exists to absorb.
  const melodyRoles = opts.melody.map((note, noteIndex) => {
    const segIdx = segmentIndexAt(bounds, snapToPulse(note.startBeat, pulse));
    const cand = candAt(bestPath[segIdx] ?? 0);
    const chord: Chord = makeChord(cand.rootPc, cand.quality);
    return { noteIndex, role: roleOf(note.pitch + bestTs, chord).role };
  });

  return { transposeSemitones: bestTs, key: resolvedKey, chords, melodyRoles };
}
