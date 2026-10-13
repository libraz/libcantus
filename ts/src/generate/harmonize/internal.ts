/**
 * What the stages of the harmonizer share: the shapes they pass between them,
 * the defaults they fall back on, and the two questions about a key that more
 * than one of them asks.
 */

import { isMinorKey } from '../../analyze/functional/index.js';
import type { MeterLike, TimeSignature } from '../../core/meter/index.js';
import { beatsPerBar, pulseBeats } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import type { ChordQuality } from '../../theory/chord/index.js';
import { chordPitchClasses, makeChord } from '../../theory/chord/index.js';
import type { HarmonyRole } from '../../theory/harmony/index.js';
import type { KeyLike, ResolvedKey } from '../../theory/scale/index.js';
import { isScaleTone, majorKey, minorKey, scaleSystemOf } from '../../theory/scale/index.js';
import { leadingTonePcOf } from '../../theory/tendency/index.js';
import type { GenerationContextInput } from '../context/index.js';
import type { ChordSpan } from '../progression/index.js';

/**
 * A melody note supplied to the harmonizer: a {@link NoteEvent}.
 *
 * @category Reharmonization
 */
export type MelodyNote = NoteEvent;
/**
 * Options controlling {@link harmonizeMelody}.
 *
 * @category Reharmonization
 */
export type HarmonizePlacement = {
  /**
   * Move the melody into the key it is harmonized in. The search reports the
   * shift it chose in `transposeSemitones`; transposing the melody by that many
   * semitones puts it in the returned `key`, so melody and harmony always agree.
   *
   * Use it for a melody notated in one key that has to be sung or played in
   * another. It never changes register on its own — that is `octaveSearch`.
   *
   * @defaultValue false
   */
  transposeSearch: boolean;
  /**
   * Search octave placements as well, so a melody written too high or too low
   * is moved into a comfortable register. Octaves leave every pitch class where
   * it was, so this changes neither the key nor the chords.
   *
   * @defaultValue false
   */
  octaveSearch: boolean;
};
/**
 * Options controlling {@link harmonizeMelody}.
 *
 * Only `melody` is required; every other knob has the default a first call
 * wants.
 *
 * @category Reharmonization
 */
export type HarmonizeOptions = {
  /** The melody to harmonize, in ascending onset order. */
  melody: readonly MelodyNote[];
  /**
   * The key to harmonize in, or `'infer'` to estimate it from the melody's
   * pitch-class weighting — which is what a caller who has only a melody
   * wants, and so the default. A key name such as `'C major'` is read as that
   * key; `'infer'` names no key and always asks for the estimate.
   *
   * @defaultValue `'infer'`
   */
  key?: KeyLike | 'infer';
  /**
   * Length of each chord slot in beats. Harmonization places chords on a fixed
   * grid of this length — unlike {@link chordTimelineFromNotes}, which searches
   * for the boundaries an existing piece already implies. Any positive value is
   * honoured; a value fine enough to make the search explode is rejected by the
   * generation budget rather than rounded up.
   *
   * Left out, it is read from `ts`: half a bar where the half falls on a pulse,
   * and the whole bar where it does not, so a waltz changes chord on its
   * downbeats rather than across them. In 4/4 that is one chord per half bar.
   *
   * @defaultValue half a bar of `ts` — 2 in 4/4
   */
  harmonicRhythm?: number;
  /**
   * Time signature the melody is barred in. It weights the metric accents the
   * chords are chosen against and sets the default chord grid, so a waltz or a
   * jig is harmonized on its own beats rather than on a 4/4 reading of them.
   *
   * @defaultValue `4/4`
   */
  ts?: MeterLike;
  /**
   * How far beyond the key's own triads the chord vocabulary reaches:
   * `'diatonic'` uses only them, `'secondaryDominant'` adds the dominants that
   * tonicize each degree, and `'borrowed'` adds the parallel mode's chords too.
   *
   * Sugar for `ctx: { complexity: { harmonic } }` at the three dial positions
   * these names have always stood for; a context names how far the vocabulary
   * reaches instead of which of three steps it stops at, and wins where both
   * are given.
   *
   * @defaultValue `'diatonic'`
   */
  reharmonize?: 'diatonic' | 'secondaryDominant' | 'borrowed';
  /**
   * Whether to search transpositions and octave placements for the melody.
   * Both are off by default, so the melody is harmonized where it was written.
   *
   * @defaultValue both false
   */
  placement?: HarmonizePlacement;
  /**
   * Beats at which the melody's phrases end, so a longer line closes at each of
   * them instead of only at its end.
   *
   * Naming a beat asks for a close there, and three things follow from it. The
   * beat divides the chord grid, so the slot the phrase closes in ends where the
   * phrase does rather than running on into the next one. The harmony moves into
   * that slot — the chord under a named close is never the chord that was
   * already sounding, which is what makes the close audible as one. And the note
   * the phrase comes to rest on is read as a structural tone rather than as an
   * ornament of the next phrase's first note, so a phrase resting on the tonic
   * is harmonized by the tonic.
   *
   * Which cadence that close forms is still the melody's to decide: a phrase
   * coming to rest on the tonic over an approach that can carry the dominant
   * cadences authentically, and one whose approach cannot is harmonized by what
   * it sounds.
   *
   * The melody always closes where it ends, whatever this says; these are the
   * closes *inside* it. `phrasesFromTimeline` finds the phrases of a line
   * already labelled with chords, and its `endBeat` values are what this
   * expects, so a caller harmonizes a whole piece in one call rather than
   * harmonizing each phrase and joining the results.
   *
   * A boundary landing exactly on a chord-slot boundary closes the slot before
   * it — the beat a phrase ends on is where the next phrase begins.
   *
   * @defaultValue none — one close, at the end
   */
  phraseEnds?: readonly number[];
  /**
   * The generation context. Its `complexity.harmonic` is how far the chord
   * vocabulary reaches beyond the key's own triads — 0 uses them alone, 0.5 has
   * every secondary dominant, 1 the parallel mode's chords as well — and its
   * `seed` drives the deterministic tie-break perturbation.
   *
   * @defaultValue `{ seed: 0 }`
   */
  ctx?: GenerationContextInput;
  /**
   * Upper bound on the work this call may do. The search is one pass per
   * placement over every pair of candidate chords in every slot, so a long line
   * harmonized with `placement.transposeSearch` on is what needs this raised.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};
/**
 * The chosen transpose, key, chord path, and per-note roles.
 *
 * @category Reharmonization
 */
export type HarmonizeResult = {
  /**
   * How far the melody was moved, in semitones. Transposing the melody by this
   * much puts it in `key`, which is the key the chords are in.
   */
  transposeSemitones: number;
  /**
   * The key the chords are in, whole.
   *
   * A key/scale alone says nothing about how it is written, so a result
   * carrying one would report whichever spelling its pitch classes read best
   * from, and an Ab minor handed in would come back out a G# minor. It matters
   * most under `key: 'infer'`, where this is the only account of which key was
   * chosen and a caller has nothing else to spell the chord spans from.
   */
  key: ResolvedKey;
  /** One span per chord change, each starting on a harmonic-rhythm boundary. */
  chords: ChordSpan[];
  /** Each melody note's role in the chord sounding under it, once chosen. */
  melodyRoles: { noteIndex: number; role: HarmonyRole }[];
};

/** One chord the search may place in a slot, with everything it is scored by. */
export type Candidate = {
  rootPc: number;
  quality: ChordQuality;
  degree?: number;
  secondaryDominant: boolean;
  targetDegree?: number;
  base: number;
  /**
   * The candidate's pitch classes, resolved once. The emission cost is
   * evaluated for every transpose, segment, and candidate, and the chord's
   * pitch classes depend on none of those.
   */
  pcs: number[];
};
/**
 * One note as a segment's emission term sees it: how much of the segment it
 * sounds in and whether it lands on an accent. Neither depends on the candidate
 * chord or on the transposition being tried, so both are found once.
 */
export type CostNote = {
  /** Index in the sounding melody. */
  index: number;
  /** Beats of the segment the note sounds in, floored so a short note still counts. */
  weight: number;
  /** Whether the note enters the segment on a metric accent. */
  strong: boolean;
};
export type Segment = {
  startBeat: number;
  endBeat: number;
  /**
   * The segment's own length in beats. Every term of the cost table is a rate per
   * beat, and a phrase end divides the grid where the caller named it, so a slot
   * cut short is scored by what it is worth rather than by what the harmonic
   * rhythm would have made it worth.
   */
  beats: number;
  /** Every sounding note overlapping the segment, by index in the sounding melody. */
  noteIndices: number[];
  /**
   * The notes that drive the segment's emission cost: its structural tones,
   * falling back to all of its notes when ornaments are all it has. A chord slot
   * with no note left to explain would be chosen by chord flow alone.
   */
  costNotes: CostNote[];
  /** Total emission weight of `costNotes`: what covering the segment is worth. */
  weight: number;
  /**
   * The last of `costNotes`, which is the tone a phrase closes on. Held as an
   * index because the pitch it carries moves with the transposition being tried.
   */
  closingIndex?: number;
};
export const FALLBACK: Candidate = {
  rootPc: 0,
  quality: 'maj',
  secondaryDominant: false,
  base: 0,
  pcs: chordPitchClasses(makeChord(0, 'maj')),
};
/**
 * Chord slot length assumed when the caller names none: half a bar of the metre
 * being harmonized in, or the whole bar where half of it does not fall on a
 * pulse.
 *
 * A grid is anchored at the melody's first slot boundary and repeats, so a slot
 * that is not a whole number of pulses long puts chord changes inside the bar
 * and drifts further from the barline with every repeat. In 3/4 half a bar is a
 * beat and a half; taking the bar instead is what makes a waltz change chord on
 * its downbeats.
 */
export function defaultHarmonicRhythm(ts: TimeSignature): number {
  const bar = beatsPerBar(ts);
  const half = bar / 2;
  return half % pulseBeats(ts) === 0 ? half : bar;
}
/** Placement assumed when the caller names none: harmonize the melody as written. */
export const DEFAULT_PLACEMENT: HarmonizePlacement = {
  transposeSearch: false,
  octaveSearch: false,
};
/** Default meter used to weight metric accents when none is supplied. */
export const DEFAULT_METER: TimeSignature = { numerator: 4, denominator: 4 };
/**
 * Magnitude of the seed-driven per-candidate perturbation. Kept far below the
 * smallest real cost difference (transition/emission terms are on the order of
 * 0.1 and up), so it can only decide between candidates or paths whose costs are
 * otherwise exactly equal. The seed therefore breaks ties deterministically and
 * never overrides melody fit or functional flow.
 */
export const TIE_BREAK_JITTER = 1e-6;
/**
 * Whether a key cadences through the raised seventh of the harmonic minor.
 *
 * A minor key does, and it is the only key that raises a seventh its own
 * signature lowers. A mode with a lowered third does not: dorian and phrygian
 * are held together by the sevenths they have, and locrian has no perfect fifth
 * to stand that dominant on at all, so raising theirs would overwrite the very
 * degree that names them. The scale system is what separates the two — a
 * natural-minor mask and an aeolian one are the same twelve bits, and the
 * difference is which tradition the key is being read in.
 */
export function cadencesThroughRaisedSeventh(key: KeyScale): boolean {
  return isMinorKey(key) && scaleSystemOf(key) === 'common-practice';
}
/**
 * Whether a pitch belongs to the key, counting the raised seventh of a minor
 * key.
 *
 * A minor key cadences through its harmonic-minor dominant, so its leading tone
 * is evidence for the key rather than a note foreign to it. Every term that asks
 * whether a note is in the key reads it this way — key inference, the emission
 * term's out-of-key surcharge, and the transposition search — so the dominant a
 * minor phrase closes with is not paid for twice. A modal key gets no such
 * allowance: its seventh is a degree, not an accidental waiting to be raised.
 */
export function isKeyTone(pitch: number, key: KeyScale): boolean {
  return (
    isScaleTone(pitch, key) ||
    (cadencesThroughRaisedSeventh(key) && pitchClass(pitch) === leadingTonePcOf(key))
  );
}
/**
 * Estimate the best-fit key from a melody's pitch-class weighting.
 *
 * Both major and natural-minor tonics are scored, so a minor melody is
 * recognized as its own minor key rather than being folded into the relative
 * major (which shares identical pitch-class content). Each in-scale note adds
 * its duration weight; notes matching the candidate tonic add a further
 * half-weight, and that tonic emphasis is what separates a minor key from its
 * relative major. For minor candidates the raised leading tone (the
 * harmonic-minor seventh) also counts as in-scale, so cadential leading tones do
 * not penalize the true minor key. Ties are broken toward the earlier candidate,
 * and major is scored before minor at each tonic.
 */
export function inferKey(melody: readonly MelodyNote[]): KeyScale {
  let best: KeyScale = majorKey(0);
  let bestScore = Number.NEGATIVE_INFINITY;
  const candidates: KeyScale[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    candidates.push(majorKey(tonic), minorKey(tonic));
  }
  for (const key of candidates) {
    const tonic = pitchClass(key.rootPc);
    let score = 0;
    for (const n of melody) {
      const w = Math.max(0.25, n.durationBeat);
      const pc = pitchClass(n.pitch);
      if (isKeyTone(n.pitch, key)) {
        score += w;
      }
      if (pc === tonic) {
        score += 0.5 * w;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}
