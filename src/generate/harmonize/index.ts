import { isDiatonic, parallelKey } from '../../analyze/functional/index.js';
import type { TimeSignature } from '../../core/meter/index.js';
import { beatsPerBar, isStrongBeat, pulseBeats } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertNoteEvents,
  assertRange,
  assertTimeSignature,
  soundingNotesOnly,
} from '../../core/validation/index.js';
import type { Chord, ChordQuality } from '../../theory/chord/index.js';
import { chordPitchClasses, diatonicTriad, makeChord } from '../../theory/chord/index.js';
import type { HarmonyRole } from '../../theory/harmony/index.js';
import { roleOf } from '../../theory/harmony/index.js';
import {
  isScaleTone,
  majorKey,
  minorKey,
  scaleTonesInDegreeOrder,
} from '../../theory/scale/index.js';
import { type GenerationContextInput, resolveContextWith } from '../context/index.js';
import type { ChordSpan } from '../progression/index.js';
import { classifyMelodyTones, snapToPulse } from './nct.js';

export type { ClassifiedMelodyTone, MelodyToneRole } from './nct.js';
export { classifyMelodyTones } from './nct.js';

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
   * wants, and so the default.
   *
   * @defaultValue `'infer'`
   */
  key?: KeyScale | 'infer';
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
  ts?: TimeSignature;
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
   * Seed for the deterministic tie-break perturbation. Sugar for
   * `ctx: { seed }`; the context wins where both are given.
   *
   * @defaultValue 0
   */
  seed?: number;
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
   * `seed` replaces `seed`.
   */
  ctx?: GenerationContextInput;
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
  key: KeyScale;
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
type CostNote = {
  /** Index in the sounding melody. */
  index: number;
  /** Beats of the segment the note sounds in, floored so a short note still counts. */
  weight: number;
  /** Whether the note enters the segment on a metric accent. */
  strong: boolean;
};

type Segment = {
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

const FALLBACK: Candidate = {
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
function defaultHarmonicRhythm(ts: TimeSignature): number {
  const bar = beatsPerBar(ts);
  const half = bar / 2;
  return half % pulseBeats(ts) === 0 ? half : bar;
}

/** Placement assumed when the caller names none: harmonize the melody as written. */
const DEFAULT_PLACEMENT: HarmonizePlacement = { transposeSearch: false, octaveSearch: false };

/** Default meter used to weight metric accents when none is supplied. */
const DEFAULT_METER: TimeSignature = { numerator: 4, denominator: 4 };

/** Comfortable melodic range (MIDI) and the per-semitone cost of leaving it. */
const COMFORT_LOW = 55;
const COMFORT_HIGH = 79;
const TESSITURA_WEIGHT = 0.001;

/**
 * The cost table, in one place because only the *ratios* between these terms
 * decide anything. Every term is on the same order of magnitude, so covering one
 * more melody note can never outweigh a functional progression: a chord that
 * leaves an accented structural tone unexplained pays about what a cadence or a
 * dominant resolution is worth, not several times more.
 *
 * **Every term is a rate per beat of music**, not per chord or per slot. The
 * emission term is charged per structural note by the beats it sounds; the
 * vocabulary term by the beats the slot's structural notes are worth; the
 * transition and phrase-end terms by the length of the slot they apply to. That
 * is what keeps the balance between melody fit and functional flow the same
 * whichever harmonic rhythm the caller asks for: with per-chord constants,
 * halving the slot length would double the total root-motion reward paid over
 * the same melody while its emission cost stayed put, and a fine harmonic rhythm
 * would spend chords the melody never asked for.
 *
 * ```text
 * emission   per structural note, weighted by the beats it sounds in the segment
 *   non-chord tone on a strong beat                    +4
 *   non-chord tone on a weak beat                      +1
 *   note outside the key, on top of the above        +0.5
 * vocabulary per beat the slot's structural notes are worth
 *   degree, by tonal weight: I 0, V 0.1, IV 0.15,
 *   ii and vi 0.3, iii 0.45, vii 0.9
 *   secondary dominant                               +0.5
 *   borrowed chord                                   +0.5
 * transition per beat of the slot it enters
 *   changing chord at all                            +0.8
 *   descending-fifth root motion                     -0.4
 *   ascending-fifth root motion                         0
 *   root motion by step or third                +0.15..0.2
 *   root motion by tritone                           +0.4
 *   V -> I                                           -0.3
 *   secondary dominant going anywhere but its target +1.0
 *   secondary dominant of the chord before it        +0.8
 * phrase end per beat of the phrase-final slot, when the melody's own
 *            closing tone is the tonic
 *   lands on the tonic                                 -7
 *   approached from V, on top of the above           -0.5
 * placement per candidate placement of the melody
 *   note outside the target key, per beat            +3.0
 *   semitone outside the comfortable range          +0.001
 * ```
 *
 * Ornamental tones are removed before the emission term is computed (see
 * {@link classifyMelodyTones}), so these numbers weigh structural tones only.
 */
const NON_CHORD_TONE_STRONG = 4;
const NON_CHORD_TONE_WEAK = 1;
const NON_SCALE_TONE = 0.5;
/**
 * What each degree costs to use, in degree order, standing for how much tonal
 * weight it carries: the tonic is free, the other primary triads are nearly so,
 * and the further a degree sits from them the more evidence the melody has to
 * supply. Without it every triad sharing a melody note is equally good and the
 * search wanders through the ones that chain by fifths. The same shape applies
 * in minor, where the slots are i, ii, III, iv, v, VI and VII.
 */
const DEGREE_BASE = [0, 0.3, 0.45, 0.15, 0.1, 0.3, 0.9];
/**
 * What a chord from outside the key's own triads costs — more than any of them,
 * and more than the flow reward reaching it and leaving it can repay. A chromatic
 * chord is therefore never reached by chord flow alone: the melody has to sound
 * the note only that chord explains, which is worth several times as much.
 * Widening the vocabulary adds the chords the melody asks for and leaves a
 * melody with no accidental in it where it was.
 */
const SECONDARY_DOMINANT_BASE = 0.5;
const BORROWED_BASE = 0.5;
/**
 * What changing chord costs at all, before the motion is judged. It is more than
 * the deepest discount any motion earns — a dominant resolving to its tonic —
 * so no chord change is ever cheaper than holding the chord already sounding.
 * Without it the discounts form a cycle a search can ride for free: I - IV - V -
 * I pays less than staying on I, and the melody has no say in it, so a harmonic
 * rhythm fine enough to fit the cycle in fills the whole melody with it.
 * Functional flow still orders the changes the melody does ask for, which is all
 * it is there to do.
 */
const CHORD_CHANGE = 0.8;
const DESCENDING_FIFTH = -0.4;
const ASCENDING_FIFTH = 0;
const DOMINANT_TO_TONIC = -0.3;
/**
 * What a secondary dominant pays for not reaching the degree it tonicizes.
 * Reaching it earns no separate discount: the descending fifth an applied
 * dominant makes into its target is already priced, and paying it twice made
 * borrowing a chromatic chord and resolving it cheaper than staying in the key.
 */
const SECONDARY_UNRESOLVED = 1;
const SECONDARY_AFTER_TARGET = 0.8;
/**
 * What other root motion costs, by the shorter distance in semitones between
 * the two roots: a third or a step asks a little, a tritone asks a lot. Motion
 * by a fifth is not priced here — it is the motion tonal harmony is built from
 * and is judged by direction instead, the descending one being the one a
 * progression is driven by.
 */
const ROOT_MOTION_COST = [0, 0.15, 0.15, 0.2, 0.2, 0, 0.4];
/**
 * What closing a phrase on the tonic is worth, per beat of the closing slot. It
 * is worth more than everything that slot can otherwise decide — covering every
 * one of its structural tones, the widest vocabulary and root-motion difference
 * between two candidates — because a phrase whose melody has come to rest on the
 * tonic is closed, and a chord that covers one more note on a stronger beat does
 * not reopen it. The bonus is paid only where the melody's own closing tone is
 * the tonic, so a phrase ending anywhere else is still harmonized by what it
 * sounds.
 */
const PHRASE_TONIC = -7;
const PHRASE_AUTHENTIC = -0.5;
const OUT_OF_KEY_PER_BEAT = 3;

/**
 * Magnitude of the seed-driven per-candidate perturbation. Kept far below the
 * smallest real cost difference (transition/emission terms are on the order of
 * 0.1 and up), so it can only decide between candidates or paths whose costs are
 * otherwise exactly equal. The seed therefore breaks ties deterministically and
 * never overrides melody fit or functional flow.
 */
const TIE_BREAK_JITTER = 1e-6;

/** Whether a key's scale is minor: it has a minor third and no major third. */
function isMinorKey(key: KeyScale): boolean {
  return ((key.modeMask12 >> 3) & 1) === 1 && ((key.modeMask12 >> 4) & 1) === 0;
}

/** The pitch class a semitone below the tonic, which a minor key cadences through. */
function leadingTonePc(key: KeyScale): number {
  return (pitchClass(key.rootPc) + 11) % 12;
}

/**
 * Whether a pitch belongs to the key, counting the raised seventh of a minor
 * key.
 *
 * A minor key cadences through its harmonic-minor dominant, so its leading tone
 * is evidence for the key rather than a note foreign to it. Every term that asks
 * whether a note is in the key reads it this way — key inference, the emission
 * term's out-of-key surcharge, and the transposition search — so the dominant a
 * minor phrase closes with is not paid for twice.
 */
function isKeyTone(pitch: number, key: KeyScale): boolean {
  return isScaleTone(pitch, key) || (isMinorKey(key) && pitchClass(pitch) === leadingTonePc(key));
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
function inferKey(melody: readonly MelodyNote[]): KeyScale {
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

/**
 * The degrees a secondary dominant conventionally tonicizes, in the order the
 * candidate list has always held them.
 */
const SECONDARY_DOMINANT_TARGETS = [2, 4, 5, 6];

/**
 * The order those dominants open up in as the harmonic dial rises, by the
 * degree each tonicizes: the dominant's own dominant is the one an arranger
 * reaches for first, then the relative minor's, and the subdominant's last.
 * Kept apart from {@link SECONDARY_DOMINANT_TARGETS} so that widening the
 * vocabulary adds to the candidate list without reordering it.
 */
const SECONDARY_DOMINANT_ENTRY_ORDER = [5, 6, 2, 4];

/**
 * The dial position at which the last secondary dominant has entered. Above it
 * the parallel mode's chords start arriving, so the two families open one after
 * the other rather than at once.
 */
const SECONDARY_DOMINANT_BAND = 0.5;

/** Where each named reharmonization strength sits on the harmonic dial. */
const REHARMONIZE_DIAL: Record<NonNullable<HarmonizeOptions['reharmonize']>, number> = {
  diatonic: 0,
  secondaryDominant: SECONDARY_DOMINANT_BAND,
  borrowed: 1,
};

/**
 * How many members of a vocabulary family a dial fraction opens: none at or
 * below 0, all at 1, and one more each time the fraction crosses another
 * `1 / size` of the way up. That is what makes the dial continuous — a small
 * move opens one more chord rather than a whole family — while leaving the
 * family complete at the top of its band, so the named strengths reach exactly
 * the vocabulary they always did.
 */
function admittedCount(fraction: number, size: number): number {
  return Math.max(0, Math.min(size, Math.ceil(fraction * size)));
}

/**
 * Enumerate candidate chords for the key, gated by the harmonic dial.
 *
 * Exported for the tests that pin the vocabulary a dial position opens; it is
 * not part of the package surface.
 */
export function buildCandidates(key: KeyScale, harmonic: number): Candidate[] {
  const tones = scaleTonesInDegreeOrder(key);
  const candidates: Candidate[] = tones.map((rootPc, index) => {
    // Scale degrees are 1-based across the library, while the array index is
    // not; the candidate records the degree, which is what reaches the caller.
    const degree = index + 1;
    const quality = diatonicTriad(degree, key).quality;
    return {
      rootPc,
      quality,
      degree,
      secondaryDominant: false,
      base: DEGREE_BASE[index] ?? 0.6,
      pcs: chordPitchClasses(makeChord(rootPc, quality)),
    };
  });

  // A minor key cadences through the harmonic-minor dominant, so the major triad
  // a fifth above the tonic belongs to the key's own vocabulary rather than to
  // any widening of it — the reading `generateProgression` already takes. Without
  // it the dominant-to-tonic and cadence terms are unreachable in minor, and a
  // minor melody can be harmonized but never closed. The natural-minor `v` stays
  // alongside it and carries the same degree, so the search chooses between them
  // on the melody. A major key already holds this chord as its diatonic V, and
  // the duplicate filter below drops the repeat.
  if (isMinorKey(key)) {
    const rootPc = (pitchClass(key.rootPc) + 7) % 12;
    candidates.push({
      rootPc,
      quality: 'maj',
      degree: 5,
      secondaryDominant: false,
      base: DEGREE_BASE[4] ?? 0.6,
      pcs: chordPitchClasses(makeChord(rootPc, 'maj')),
    });
  }

  // The degrees are kept in the same 1-based space as `Candidate.degree`, which
  // the voice-leading cost compares them against.
  const secondaryOpen = admittedCount(
    harmonic / SECONDARY_DOMINANT_BAND,
    SECONDARY_DOMINANT_TARGETS.length,
  );
  for (const target of SECONDARY_DOMINANT_TARGETS) {
    if (SECONDARY_DOMINANT_ENTRY_ORDER.indexOf(target) >= secondaryOpen) {
      continue;
    }
    const targetRoot = tones[target - 1] ?? 0;
    const rootPc = (targetRoot + 7) % 12;
    candidates.push({
      rootPc,
      quality: 'dom7',
      secondaryDominant: true,
      targetDegree: target,
      base: SECONDARY_DOMINANT_BASE,
      pcs: chordPitchClasses(makeChord(rootPc, 'dom7')),
    });
  }

  const parallel = parallelKey(key);
  const parallelTones = scaleTonesInDegreeOrder(parallel);
  const borrowed: Chord[] = [];
  for (let degree = 1; degree <= parallelTones.length; degree += 1) {
    const chord = diatonicTriad(degree, parallel);
    if (!isDiatonic(chord, key)) {
      borrowed.push(chord);
    }
  }
  const borrowedOpen = admittedCount(
    (harmonic - SECONDARY_DOMINANT_BAND) / (1 - SECONDARY_DOMINANT_BAND),
    borrowed.length,
  );
  for (const chord of borrowed.slice(0, borrowedOpen)) {
    candidates.push({
      rootPc: chord.rootPc,
      quality: chord.quality,
      secondaryDominant: false,
      base: BORROWED_BASE,
      pcs: chordPitchClasses(chord),
    });
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const id = `${candidate.rootPc}:${candidate.quality}`;
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

/**
 * Melody-fit cost of a candidate over a segment's structural notes.
 *
 * Only the segment's `costNotes` are charged: an ornament is explained by the
 * melodic figure it forms, not by the chord under it, so making the chord cover
 * it would be paying twice. Each note is weighted by the portion of its duration
 * that overlaps the segment, so a note sustained across a boundary contributes
 * to every segment it sounds in rather than only the one it starts in. The
 * candidate's own vocabulary cost is charged by the same total weight, so what a
 * chord costs to use and what it costs to leave a note unexplained are measured
 * against the same amount of music.
 */
function emissionCost(
  seg: Segment,
  cand: Candidate,
  melody: readonly MelodyNote[],
  key: KeyScale,
): number {
  const pcs = cand.pcs;
  let cost = cand.base * seg.weight;
  for (const { index, weight, strong } of seg.costNotes) {
    const note = melody[index];
    if (!note || pcs.includes(pitchClass(note.pitch))) {
      continue;
    }
    cost += (strong ? NON_CHORD_TONE_STRONG : NON_CHORD_TONE_WEAK) * weight;
    if (!isKeyTone(note.pitch, key)) {
      cost += NON_SCALE_TONE * weight;
    }
  }
  return cost;
}

/**
 * Register cost of a placed melody: a small penalty for notes pushed outside a
 * comfortable range. Kept far below emission/transition costs so it only breaks
 * ties between otherwise-equal octave placements.
 */
function tessituraCost(melody: readonly MelodyNote[]): number {
  let cost = 0;
  for (const n of melody) {
    if (n.pitch < COMFORT_LOW) {
      cost += (COMFORT_LOW - n.pitch) * TESSITURA_WEIGHT;
    } else if (n.pitch > COMFORT_HIGH) {
      cost += (n.pitch - COMFORT_HIGH) * TESSITURA_WEIGHT;
    }
  }
  return cost;
}

/** Whether a candidate is the key's dominant, in a quality that can act as one. */
function isDominantOf(cand: Candidate, tonicPc: number): boolean {
  return cand.rootPc === (tonicPc + 7) % 12 && (cand.quality === 'maj' || cand.quality === 'dom7');
}

/**
 * How badly a placed melody sits in the key it is about to be harmonized in.
 *
 * This is what makes a transposition search mean "move the melody into this
 * key": a shift is judged by the melody's own key membership, not by how many
 * chord tones a chord path can be talked into covering. The winning shift
 * therefore always agrees with the key the result reports.
 */
function keyFitCost(melody: readonly MelodyNote[], key: KeyScale): number {
  let cost = 0;
  for (const n of melody) {
    if (!isKeyTone(n.pitch, key)) {
      cost += Math.max(0.25, n.durationBeat) * OUT_OF_KEY_PER_BEAT;
    }
  }
  return cost;
}

/**
 * Collapse runs of the same chord into one span.
 *
 * The harmonic rhythm sets the grid the search may change chords on, not a
 * requirement to change on every slot; repeating a slot's chord is the same
 * harmony held longer, and reporting it once is what a chart shows.
 */
function mergeRepeats(spans: ChordSpan[]): ChordSpan[] {
  const merged: ChordSpan[] = [];
  for (const span of spans) {
    const prev = merged.at(-1);
    if (
      prev &&
      prev.rootPc === span.rootPc &&
      prev.quality === span.quality &&
      prev.degree === span.degree &&
      prev.secondaryDominant === span.secondaryDominant
    ) {
      continue;
    }
    merged.push(span);
  }
  return merged;
}

/**
 * Functional-flow cost of moving from one candidate chord to the next, per beat
 * of the slot the move enters.
 *
 * The caller scales it by that slot's length: root motion is worth what the
 * music it spans is worth, not what one grid boundary is worth, so dividing the
 * same melody into finer slots cannot buy more flow reward than the melody's
 * emission cost can answer for.
 */
function transitionCost(prev: Candidate, cur: Candidate, tonicPc: number): number {
  let cost = prev.rootPc === cur.rootPc && prev.quality === cur.quality ? 0 : CHORD_CHANGE;
  const down = (prev.rootPc - cur.rootPc + 12) % 12;
  if (down === 7) {
    cost += DESCENDING_FIFTH;
  } else if (down === 5) {
    cost += ASCENDING_FIFTH;
  } else {
    cost += ROOT_MOTION_COST[Math.min(down, 12 - down)] ?? 0;
  }
  if (isDominantOf(prev, tonicPc) && cur.rootPc === tonicPc) {
    cost += DOMINANT_TO_TONIC;
  }
  if (prev.secondaryDominant && cur.degree !== prev.targetDegree) {
    cost += SECONDARY_UNRESOLVED;
  }
  // Reaching a chord's own dominant from that chord leads straight back where it
  // came from. Once it is cheaper to tonicize than to stay put, a search with no
  // memory will otherwise rock between the two forever.
  if (cur.secondaryDominant && prev.degree !== undefined && prev.degree === cur.targetDegree) {
    cost += SECONDARY_AFTER_TARGET;
  }
  return cost;
}

/**
 * Bonus for closing a phrase on the tonic, over the whole of what that slot is
 * worth.
 *
 * A melody that has come to rest on the tonic has closed, so the chord under it
 * is the tonic — whatever the rest of the slot sounds, and whatever chord the
 * slot before it settled on. The bonus is therefore weighed against everything
 * that slot can otherwise decide, which is why it is scaled by the slot's own
 * emission weight rather than being a constant one accented note can outbid.
 *
 * It is paid only where the melody's own closing tone is the tonic: a phrase
 * that comes to rest anywhere else — on the third, on the leading tone, on a
 * degree the tonic chord cannot support — has not closed, and is harmonized by
 * what it sounds.
 *
 * `prev` is the chord approaching the close, or null when the phrase is a single
 * chord long and there is nothing to approach it from.
 */
function phraseEndBonus(
  prev: Candidate | null,
  cur: Candidate,
  tonicPc: number,
  seg: Segment,
  melody: readonly MelodyNote[],
): number {
  if (cur.rootPc !== tonicPc || seg.closingIndex === undefined) {
    return 0;
  }
  const closing = melody[seg.closingIndex];
  if (!closing || pitchClass(closing.pitch) !== tonicPc) {
    return 0;
  }
  const weight = Math.max(seg.weight, seg.beats);
  return (
    (PHRASE_TONIC + (prev !== null && isDominantOf(prev, tonicPc) ? PHRASE_AUTHENTIC : 0)) * weight
  );
}

/** Tolerance for comparing a phrase boundary with a segment boundary, in beats. */
const BEAT_EPS = 1e-9;

/**
 * The beats the chord grid may change on: the harmonic rhythm's own boundaries,
 * plus every named phrase end that falls inside the melody.
 *
 * A named end lands on a boundary that is already there for most callers, and
 * naming one that is not adds it rather than moving the grid, so the slots after
 * a phrase end stay where the harmonic rhythm put them.
 */
function gridBounds(
  segmentStart: number,
  hr: number,
  gridCount: number,
  ends: readonly number[],
): number[] {
  const bounds: number[] = [];
  for (let s = 0; s <= gridCount; s += 1) {
    bounds.push(segmentStart + s * hr);
  }
  const last = segmentStart + gridCount * hr;
  for (const end of ends) {
    if (end > segmentStart + BEAT_EPS && end < last - BEAT_EPS) {
      bounds.push(end);
    }
  }
  bounds.sort((a, b) => a - b);
  return bounds.filter(
    (beat, index) => index === 0 || beat - (bounds[index - 1] ?? beat) > BEAT_EPS,
  );
}

/**
 * The note each named phrase closes on: the last one to begin before the beat
 * the phrase ends at.
 */
function closingNoteIndices(
  spans: readonly { startBeat: number; endBeat: number }[],
  ends: readonly number[],
): Set<number> {
  const closing = new Set<number>();
  for (const end of ends) {
    let index = -1;
    let start = Number.NEGATIVE_INFINITY;
    for (const [i, span] of spans.entries()) {
      if (span.startBeat < end - BEAT_EPS && span.startBeat >= start) {
        start = span.startBeat;
        index = i;
      }
    }
    if (index >= 0) {
      closing.add(index);
    }
  }
  return closing;
}

/** The index of the segment a beat sounds in: the last boundary at or before it. */
function segmentIndexAt(bounds: readonly number[], beat: number): number {
  let low = 0;
  let high = bounds.length - 2;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((bounds[mid] ?? 0) <= beat) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** Whether two candidates are the same harmony, which is what holding a chord means. */
function sameHarmony(a: Candidate, b: Candidate): boolean {
  return a.rootPc === b.rootPc && a.quality === b.quality;
}

/**
 * Segments that close and therefore have to cadence.
 *
 * The melody handed to the harmonizer closes at its end, so its last segment
 * always cadences. A caller who knows where the phrases of a longer line fall —
 * `phrasesFromTimeline` finds them — names their ends as beats, and the segment
 * each end falls in cadences too, so one call harmonizes the whole line instead
 * of the caller harmonizing each phrase and joining the results. Every cadence
 * term reads the boundaries from here.
 *
 * The named ends are returned apart from the melody's own close because they ask
 * for more than it does: naming a beat asks for a cadence there, and a cadence
 * is a chord change into the close.
 */
function phraseEndSegments(
  segments: readonly Segment[],
  ends: readonly number[],
): { closing: Set<number>; named: Set<number> } {
  const closing = new Set(segments.length > 0 ? [segments.length - 1] : []);
  const named = new Set<number>();
  for (const end of ends) {
    // The phrase closes in the segment its last beat sounds in, which is the
    // last segment beginning before that beat — a boundary landing exactly on a
    // segment start belongs to the phrase that ended, not the one starting.
    let index = -1;
    for (let s = 0; s < segments.length; s += 1) {
      if ((segments[s]?.startBeat ?? 0) < end - BEAT_EPS) {
        index = s;
      }
    }
    if (index >= 0) {
      closing.add(index);
      named.add(index);
    }
  }
  return { closing, named };
}

/** Run one Viterbi harmonization pass over a fixed melody and key. */
function harmonizeOnce(
  melody: readonly MelodyNote[],
  key: KeyScale,
  candidates: Candidate[],
  segments: Segment[],
  jitter: number[],
  phraseEnds: ReadonlySet<number>,
  articulated: ReadonlySet<number>,
): { cost: number; path: number[] } {
  const tonicPc = pitchClass(key.rootPc);
  const n = candidates.length;
  const candAt = (i: number): Candidate => candidates[i] ?? FALLBACK;
  const seg0 = segments[0];

  // A phrase one segment long has no approach chord, so its close is judged on
  // the chord alone.
  let dp = candidates.map(
    (c, ci) =>
      (seg0 ? emissionCost(seg0, c, melody, key) : 0) +
      (seg0 && phraseEnds.has(0) ? phraseEndBonus(null, c, tonicPc, seg0, melody) : 0) +
      (jitter[ci] ?? 0),
  );
  const back: number[][] = [];

  for (let s = 1; s < segments.length; s += 1) {
    const seg = segments[s];
    if (!seg) {
      continue;
    }
    const closes = phraseEnds.has(s);
    // A beat the caller named as a phrase end is a cadence point, and a cadence
    // is harmonic motion into the close: the chord under it is not the chord
    // that was already sounding. The melody's own close is not held to this —
    // naming a beat is what asks for it — so a call that names none is scored
    // exactly as it was.
    const articulates = articulated.has(s);
    const next: number[] = [];
    const ptr: number[] = [];
    for (let c = 0; c < n; c += 1) {
      let best = Number.POSITIVE_INFINITY;
      let bestPrev = 0;
      for (let p = 0; p < n; p += 1) {
        if (articulates && sameHarmony(candAt(p), candAt(c))) {
          continue;
        }
        // The cadence bonus is part of the step into a phrase-final segment, not
        // an afterthought added to the finished path, so the approach chord is
        // chosen for the cadence it makes.
        const cost =
          (dp[p] ?? Number.POSITIVE_INFINITY) +
          transitionCost(candAt(p), candAt(c), tonicPc) * seg.beats +
          (closes ? phraseEndBonus(candAt(p), candAt(c), tonicPc, seg, melody) : 0);
        if (cost < best) {
          best = cost;
          bestPrev = p;
        }
      }
      next[c] = best + emissionCost(seg, candAt(c), melody, key) + (jitter[c] ?? 0);
      ptr[c] = bestPrev;
    }
    dp = next;
    back.push(ptr);
  }

  let bestCost = Number.POSITIVE_INFINITY;
  let bestEnd = 0;
  for (let c = 0; c < n; c += 1) {
    const total = dp[c] ?? Number.POSITIVE_INFINITY;
    if (total < bestCost) {
      bestCost = total;
      bestEnd = c;
    }
  }

  const path: number[] = new Array<number>(segments.length).fill(bestEnd);
  for (let s = segments.length - 2; s >= 0; s -= 1) {
    const ptr = back[s];
    const nextIdx = path[s + 1] ?? bestEnd;
    path[s] = ptr ? (ptr[nextIdx] ?? bestEnd) : bestEnd;
  }
  return { cost: bestCost, path };
}

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
  assertNoteEvents(opts.melody, 'harmonize melody', { allowNonPositiveDuration: true });
  const phraseEnds = opts.phraseEnds ?? [];
  for (const end of phraseEnds) {
    assertFiniteNumber(end, 'harmonize phrase end');
  }
  const soundingMelody = soundingNotesOnly(opts.melody);
  const ts = opts.ts ?? DEFAULT_METER;
  assertTimeSignature(ts);
  const requestedKey = opts.key ?? 'infer';
  const key = requestedKey === 'infer' ? inferKey(soundingMelody) : requestedKey;
  const placement = opts.placement ?? DEFAULT_PLACEMENT;
  const ctx = resolveContextWith(opts.ctx, { seed: opts.seed });
  // `reharmonize` names three points on the dial the context sets continuously,
  // so a caller who says `'secondaryDominant'` gets exactly the vocabulary that
  // name has always meant.
  const harmonic = ctx.harmonic ?? REHARMONIZE_DIAL[opts.reharmonize ?? 'diatonic'];
  // Nothing to harmonize: inventing a tonic bar here would silently insert a
  // ghost chord into a chart built by harmonizing sections and concatenating
  // them. The sibling generators return an empty result for empty input too.
  if (soundingMelody.length === 0) {
    return { transposeSemitones: 0, key, chords: [], melodyRoles: [] };
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
  const melodyEnd = spans.reduce((end, span) => Math.max(end, span.endBeat), 0);
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
  const segmentStart = Math.floor(melodyStart / hr) * hr;
  const gridCount = Math.max(1, Math.ceil((melodyEnd - segmentStart) / hr));
  assertGenerationBudget(gridCount, 'harmonic segments');
  // The grid the search may change chords on: the harmonic rhythm, anchored at
  // the melody's first slot boundary, divided again at every beat the caller
  // named as a phrase end. A named end falling inside a slot cuts it, so the
  // slot a phrase closes in ends where the phrase does instead of running on
  // into the next one, and the grid then resumes on its own boundaries — which
  // is what keeps the chord changes after the boundary on the barline.
  const bounds = gridBounds(segmentStart, hr, gridCount, phraseEnds);
  const segCount = bounds.length - 1;
  assertGenerationBudget(segCount, 'harmonic segments');
  const segments: Segment[] = Array.from({ length: segCount }, (_, s) => {
    const startBeat = bounds[s] ?? segmentStart;
    const endBeat = bounds[s + 1] ?? startBeat + hr;
    return {
      startBeat,
      endBeat,
      beats: endBeat - startBeat,
      noteIndices: [],
      costNotes: [],
      weight: 0,
    };
  });
  // Associate each note only with the windows it actually spans: each note is
  // visited once per window it covers, and no temporary note objects are
  // allocated.
  let memberships = 0;
  for (const [index, span] of spans.entries()) {
    const first = segmentIndexAt(bounds, span.startBeat);
    let lastExclusive = first;
    while (
      lastExclusive < segCount &&
      (bounds[lastExclusive] ?? 0) < span.endBeat - Number.EPSILON
    ) {
      lastExclusive += 1;
    }
    memberships += Math.max(0, lastExclusive - first);
    assertGenerationBudget(memberships, 'note-to-segment memberships');
    for (let segment = first; segment < lastExclusive; segment += 1) {
      segments[segment]?.noteIndices.push(index);
    }
  }

  // Classify the ornaments before any chord exists, and keep only the structural
  // tones in each slot's emission term. Transposing a melody moves every note
  // alike, so the figures are the same at every placement and are found once —
  // and so is the metric weight of each note in each slot it sounds in.
  const tones = classifyMelodyTones(soundingMelody, ts);
  // The classifier reads a note against the notes on either side of it, and
  // knows nothing of phrases: the melody's own last note is structural because
  // nothing follows it, but the note closing a phrase inside the line has the
  // next phrase's first note after it and is heard as an ornament of it — a
  // close on the tonic between two supertonics reads as a lower neighbour. A
  // phrase's last note is structural for the same reason the melody's last note
  // is, so the closes the caller named are put back.
  const phraseClosingNotes = closingNoteIndices(spans, phraseEnds);
  for (const segment of segments) {
    const structural = segment.noteIndices.filter(
      (idx) => tones[idx]?.ornamental !== true || phraseClosingNotes.has(idx),
    );
    const costIndices = structural.length > 0 ? structural : segment.noteIndices;
    let closingStart = Number.NEGATIVE_INFINITY;
    for (const index of costIndices) {
      const span = spans[index];
      if (!span) {
        continue;
      }
      const overlapStart = Math.max(span.startBeat, segment.startBeat);
      const overlap = Math.min(span.endBeat, segment.endBeat) - overlapStart;
      if (overlap <= 0) {
        continue;
      }
      const weight = Math.max(0.25, overlap);
      segment.costNotes.push({ index, weight, strong: isStrongBeat(overlapStart, ts) });
      segment.weight += weight;
      // The tone a phrase closes on is the last one to start, which is not the
      // last one listed when a note held from earlier is still sounding under it.
      if (span.startBeat >= closingStart) {
        closingStart = span.startBeat;
        segment.closingIndex = index;
      }
    }
  }

  const { closing: closingSegments, named: namedEndSegments } = phraseEndSegments(
    segments,
    phraseEnds,
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
  assertGenerationBudget(
    transposes.length * segCount * candidates.length * candidates.length,
    'harmonization placement search',
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

  const melodyRoles = opts.melody.map((note, noteIndex) => {
    const segIdx = segmentIndexAt(bounds, note.startBeat);
    const cand = candAt(bestPath[segIdx] ?? 0);
    const chord: Chord = makeChord(cand.rootPc, cand.quality);
    return { noteIndex, role: roleOf(note.pitch + bestTs, chord).role };
  });

  return { transposeSemitones: bestTs, key, chords, melodyRoles };
}
