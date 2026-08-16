import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import { assertGenerationBudget, assertPositiveInt } from '../../core/validation/index.js';
import type { Chord } from '../chord/index.js';
import { chordPitchClasses } from '../chord/index.js';
import type { ScaleNameInput } from '../scale/index.js';
import { NAMED_SCALES, namedScaleMask, requireScaleMask } from '../scale/index.js';

/** Count the set bits (scale tones) in a 12-bit mode mask. */
function popcount12(mask: number): number {
  let count = 0;
  for (let n = 0; n < 12; n += 1) {
    count += (mask >> n) & 1;
  }
  return count;
}

/** Test whether a pitch class belongs to a mode mask rooted on `scaleRootPc`. */
function maskHasPitchClass(mask: number, scaleRootPc: number, pc: number): boolean {
  const offset = pitchClass(pc - scaleRootPc);
  return ((mask >> offset) & 1) === 1;
}

/**
 * Test whether every chord pitch class is contained in a scale.
 *
 * @param chordPcs The chord's pitch classes (0..11).
 * @param scaleMask The scale's 12-bit mode mask.
 * @param scaleRootPc The pitch class the mask is rooted on.
 * @returns True if the scale is a superset of the chord.
 *
 * @category Scales
 */
export function scaleMatchesChord(
  chordPcs: number[],
  scaleMask: number,
  scaleRootPc: number,
): boolean {
  for (const pc of chordPcs) {
    if (!maskHasPitchClass(scaleMask, scaleRootPc, pc)) {
      return false;
    }
  }
  return true;
}

/**
 * A named scale rooted on a pitch class that fits over a chord.
 *
 * @category Scales
 */
export type ChordScaleMatch = {
  name: string;
  rootPc: number;
};

/**
 * Scale names whose mask duplicates another {@link NAMED_SCALES} entry
 * (major/ionian, naturalMinor/aeolian). Chord-scale analysis conventionally
 * speaks in mode names, so these aliases are skipped and only the modal name
 * is reported.
 */
const ALIASED_SCALE_NAMES = new Set(['major', 'naturalMinor']);

/** Number of tones in a heptatonic (seven-note) scale. */
const HEPTATONIC_SIZE = 7;

/**
 * Conventional preference among equally-fitting scales, brightest first.
 *
 * Several modes fit a chord that states no third or sixth — a power chord, a
 * suspension — equally well. Alphabetical order made `aeolian` the answer for
 * those, naming a minor mode as the best fit for a mode-neutral chord.
 */
const SCALE_PREFERENCE = [
  'ionian',
  'major',
  'mixolydian',
  'dorian',
  'lydian',
  'aeolian',
  'naturalMinor',
  'phrygian',
  'locrian',
] as const;

/** Conventional first choices that pure set-fit ranking cannot express. */
const IDIOMATIC_SCALES: Partial<Record<Chord['quality'], readonly string[]>> = {
  aug: ['wholeTone'],
  m7b5: ['locrian'],
  // The diminished scale played over a diminished seventh is the whole-half
  // octatonic. Its half-whole rotation belongs to the dominant it colours: over
  // a diminished seventh every one of its non-chord tones lands a semitone
  // above a chord tone, so it offers no tension at all.
  dim7: ['octatonicWholeHalf'],
  minMaj7: ['melodicMinor'],
};

/** Position of a scale in {@link SCALE_PREFERENCE}, or last when unlisted. */
function conventionalRank(name: string): number {
  const index = (SCALE_PREFERENCE as readonly string[]).indexOf(name);
  return index < 0 ? SCALE_PREFERENCE.length : index;
}

/** Whether this scale is an idiomatic color choice for the chord quality. */
function idiomaticRank(chord: Chord, name: string): number {
  const choices = IDIOMATIC_SCALES[chord.quality];
  if (choices === undefined) {
    return 0;
  }
  const index = choices.indexOf(name);
  return index < 0 ? choices.length + 1 : index;
}

/**
 * An ordinary dominant seventh may use altered colors while retaining its
 * perfect fifth in the voicing; the `7alt` quality makes that alteration
 * explicit, but lead sheets commonly write the shorter `7` here.
 */
function isAlteredDominant(chord: Chord, scaleName: string): boolean {
  return chord.quality === 'dom7' && scaleName === 'altered';
}

/**
 * List the scales that fit over a chord, best fit first.
 *
 * Only the chord root is considered as the scale root, matching the
 * conventional chord-scale relationship. Every entry of {@link NAMED_SCALES}
 * whose pitch-class set is a superset of the chord's is returned once per
 * distinct pitch-class set (aliased masks such as major/ionian report only the
 * modal name), ranked by fewest extra scale tones beyond the chord and then by
 * conventional
 * preference. For bare triads and smaller chords, heptatonic scales rank before
 * pentatonics and other sizes: a pentatonic adds no modal color over a triad,
 * so the seven-note modes are the more useful answer. The chromatic scale is
 * only returned as a fallback when no other scale contains the chord.
 *
 * The ranking is by fit, so the first entry is the tightest-fitting scale
 * rather than the idiomatic choice: a four-note chord that a pentatonic covers
 * exactly puts that pentatonic ahead of the mode a player would name. Read the
 * whole list, or pick by name, when the idiomatic scale is what is wanted;
 * {@link scalesForChanges} makes that choice for a progression.
 *
 * @param chord The chord to fit scales over.
 * @returns The matching scales rooted on the chord root, best fit first.
 *
 * @example
 * ```ts
 * import { makeChord, chordScales } from '@libraz/libcantus';
 * const scales = chordScales(makeChord(0, 'maj7'));
 * // scales for Cmaj7, best fit first; each is { name, rootPc: 0 }
 * ```
 *
 * @category Scales
 */
export function chordScales(chord: Chord): ChordScaleMatch[] {
  const chordPcs = chordPitchClasses(chord);
  const rootPc = pitchClass(chord.rootPc);
  const ranked: { name: string; extra: number; size: number; avoid: number }[] = [];
  const seenMasks = new Set<number>();
  for (const name of Object.keys(NAMED_SCALES)) {
    if (name === 'chromatic' || ALIASED_SCALE_NAMES.has(name)) {
      continue;
    }
    const mask = namedScaleMask(name);
    if (mask === undefined || seenMasks.has(mask)) {
      continue;
    }
    seenMasks.add(mask);
    if (scaleMatchesChord(chordPcs, mask, rootPc) || isAlteredDominant(chord, name)) {
      const size = popcount12(mask);
      ranked.push({
        name,
        extra: size - chordPcs.length,
        size,
        avoid: avoidNotes(chord, name).length,
      });
    }
  }
  if (ranked.length === 0) {
    // No diatonic-style scale contains the chord; fall back to the chromatic
    // scale, which trivially contains every pitch class.
    if (NAMED_SCALES.chromatic !== undefined) {
      return [{ name: 'chromatic', rootPc }];
    }
    return [];
  }
  const preferHeptatonic = chordPcs.length <= 3;
  ranked.sort((a, b) => {
    const idiomaticA = idiomaticRank(chord, a.name);
    const idiomaticB = idiomaticRank(chord, b.name);
    if (idiomaticA !== idiomaticB) {
      return idiomaticA - idiomaticB;
    }
    if (preferHeptatonic && (a.size === HEPTATONIC_SIZE) !== (b.size === HEPTATONIC_SIZE)) {
      return a.size === HEPTATONIC_SIZE ? -1 : 1;
    }
    if (a.extra !== b.extra) {
      return a.extra - b.extra;
    }
    const rankA = conventionalRank(a.name);
    const rankB = conventionalRank(b.name);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    // Among scales the modal preference does not name — the symmetric and
    // melodic-minor scales — the one that clashes with the chord least is the
    // one a player reaches for. Alphabetical order answered with the rotation
    // that leaves nothing playable.
    if (a.avoid !== b.avoid) {
      return a.avoid - b.avoid;
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return ranked.map((entry) => ({ name: entry.name, rootPc }));
}

/**
 * The tone standing in the third's place when a chord suspends its third.
 *
 * Read from the tones the chord sounds rather than from its quality name: one
 * suspension is written `sus4`, `7sus4`, `9sus4`, `11` and `sus4(add9)`, and
 * the eleventh chord states it by omitting the third rather than by naming a
 * suspension, so a set of names can only ever cover part of it. A chord with no
 * third that sounds a fourth suspends into that fourth; one that sounds a
 * second suspends into the second.
 *
 * @param chordPcs The chord's pitch classes.
 * @param rootPc The chord root's pitch class.
 * @returns The suspended tone's pitch class, or undefined when the chord states
 *   a third of its own.
 */
function suspendedTone(chordPcs: number[], rootPc: number): number | undefined {
  const sounds = (semitones: number): boolean => chordPcs.includes(pitchClass(rootPc + semitones));
  if (sounds(3) || sounds(4)) {
    return undefined;
  }
  if (sounds(5)) {
    return pitchClass(rootPc + 5);
  }
  if (sounds(2)) {
    return pitchClass(rootPc + 2);
  }
  return undefined;
}

/**
 * Which use an avoid note is judged for: sounding it, or passing through it.
 *
 * `'harmonic'` is the Berklee-style rule in full — a tone that must not be
 * sounded against the chord. `'melodic'` keeps only what a line cannot pass
 * through either, which is the semitone above the root; every other clash
 * resolves as the line moves on.
 *
 * @category Scales
 */
export type AvoidNoteUse = 'harmonic' | 'melodic';

/**
 * Options for {@link avoidNotes}.
 *
 * @category Scales
 */
export type AvoidNotesOptions = {
  use?: AvoidNoteUse;
};

/**
 * List a scale's avoid notes over a chord.
 *
 * An avoid note is a non-chord scale tone that lies a semitone directly above a
 * chord tone, or the third a suspension displaced; sounding it against the
 * chord clashes. The scale is rooted on the chord root. If the scale does not
 * contain the chord, no avoid notes exist.
 *
 * The rule states which tones must not be *sounded* against the chord, which is
 * not the same question as which tones a line may not touch. Pass
 * `{ use: 'melodic' }` for the melodic reading: only the semitone above the
 * root survives it, so the result is always a subset of the harmonic one.
 *
 * @param chord The chord providing the chord tones.
 * @param scaleName A key of {@link NAMED_SCALES}.
 * @param opts Set `use: 'melodic'` to judge a line rather than a voicing.
 * @returns The avoid-note pitch classes, sorted ascending in [0, 11].
 * @throws If `scaleName` is not a built-in scale. An empty result already
 *   means "this scale has no avoid notes over this chord"; answering a typo
 *   the same way would make the two indistinguishable.
 *
 * @example
 * ```ts
 * import { makeChord, avoidNotes } from '@libraz/libcantus';
 * avoidNotes(makeChord(0, 'maj7'), 'ionian'); // [5] — F clashes with the third
 * avoidNotes(makeChord(0, 'maj7'), 'ionian', { use: 'melodic' }); // [] — a line may pass through it
 * ```
 *
 * @category Scales
 */
export function avoidNotes(
  chord: Chord,
  scaleName: ScaleNameInput,
  opts: AvoidNotesOptions = {},
): number[] {
  const mask = requireScaleMask(scaleName);
  const rootPc = pitchClass(chord.rootPc);
  const chordPcs = chordPitchClasses(chord);
  const alteredDominant = isAlteredDominant(chord, scaleName);
  if (!scaleMatchesChord(chordPcs, mask, rootPc) && !alteredDominant) {
    return [];
  }
  const chordSet = new Set(chordPcs);
  const suspended = suspendedTone(chordPcs, rootPc);
  // The tone the suspension displaced sits a semitone below it, and sounding it
  // is what undoes the suspension.
  const displacedThird = suspended === undefined ? undefined : pitchClass(suspended - 1);
  const melodic = opts.use === 'melodic';
  const semitoneAboveRoot = pitchClass(rootPc + 1);
  const avoid: number[] = [];
  for (let pc = 0; pc < 12; pc += 1) {
    if (!maskHasPitchClass(mask, rootPc, pc) || chordSet.has(pc)) {
      continue;
    }
    if (melodic && pc !== semitoneAboveRoot) {
      continue;
    }
    if (!alteredDominant && (chordSet.has(pitchClass(pc - 1)) || pc === displacedThird)) {
      avoid.push(pc);
    }
  }
  return avoid.sort((a, b) => a - b);
}

/**
 * Semitones above the root of the colors a dominant takes when it resolves to a
 * minor tonic: the flat ninth, the sharp ninth, and the flat thirteenth.
 *
 * Over a dominant read on its own, each of them sits a semitone above a chord
 * tone and is an avoid note. Heard as the dominant of a minor key they are the
 * key's own tones, and standard practice, so the function the chord serves is
 * what decides.
 */
const MINOR_RESOLUTION_TENSIONS = [1, 3, 8] as const;

/** Whether this chord is a dominant seventh resolving down a fifth to minor. */
function resolvesToMinorTonic(
  chord: Chord,
  chordPcs: number[],
  target: Chord | undefined,
): boolean {
  if (target === undefined) {
    return false;
  }
  const rootPc = pitchClass(chord.rootPc);
  const sounds = (semitones: number): boolean => chordPcs.includes(pitchClass(rootPc + semitones));
  if (!sounds(4) || !sounds(10)) {
    return false;
  }
  const targetRootPc = pitchClass(target.rootPc);
  if (targetRootPc !== pitchClass(rootPc + 5)) {
    return false;
  }
  return chordPitchClasses(target).includes(pitchClass(targetRootPc + 3));
}

/**
 * Options for {@link availableTensions}.
 *
 * @category Scales
 */
export type AvailableTensionsOptions = {
  resolvesTo?: Chord;
};

/**
 * List a scale's available tensions over a chord.
 *
 * Available tensions are scale tones that are neither chord tones nor avoid
 * notes, i.e. the usable color tones (typically the 9/11/13 region). The scale
 * is rooted on the chord root. If the scale does not contain the chord, there
 * are no available tensions.
 *
 * A tension's availability also depends on what the chord is doing. Pass
 * `resolvesTo` to say which chord this one resolves to: a dominant seventh
 * resolving down a fifth to a minor tonic takes its flat ninth, sharp ninth and
 * flat thirteenth, which read on their own would each be an avoid note. Only
 * scale tones are ever added, so the result stays within the scale.
 *
 * @param chord The chord providing the chord tones.
 * @param scaleName A key of {@link NAMED_SCALES}.
 * @param opts Set `resolvesTo` to the chord this one resolves to.
 * @returns The available-tension pitch classes, sorted ascending in [0, 11].
 * @throws If `scaleName` is not a built-in scale, as {@link avoidNotes} does.
 *
 * @example
 * ```ts
 * import { makeChord, availableTensions } from '@libraz/libcantus';
 * availableTensions(makeChord(0, 'maj7'), 'ionian'); // [2, 9] — color tones over Cmaj7
 * availableTensions(makeChord(7, 'dom7'), 'phrygianDominant', { resolvesTo: makeChord(0, 'min') });
 * // [3, 8] — the b13 and b9 the resolution to C minor makes available
 * ```
 *
 * @category Scales
 */
export function availableTensions(
  chord: Chord,
  scaleName: ScaleNameInput,
  opts: AvailableTensionsOptions = {},
): number[] {
  const mask = requireScaleMask(scaleName);
  const rootPc = pitchClass(chord.rootPc);
  const chordPcs = chordPitchClasses(chord);
  const alteredDominant = isAlteredDominant(chord, scaleName);
  if (!scaleMatchesChord(chordPcs, mask, rootPc) && !alteredDominant) {
    return [];
  }
  const chordSet = new Set(chordPcs);
  const avoidSet = alteredDominant ? new Set<number>() : new Set(avoidNotes(chord, scaleName));
  const functional = resolvesToMinorTonic(chord, chordPcs, opts.resolvesTo)
    ? new Set(MINOR_RESOLUTION_TENSIONS.map((semitones) => pitchClass(rootPc + semitones)))
    : undefined;
  const tensions: number[] = [];
  for (let pc = 0; pc < 12; pc += 1) {
    if (!maskHasPitchClass(mask, rootPc, pc) || chordSet.has(pc)) {
      continue;
    }
    if (avoidSet.has(pc) && functional?.has(pc) !== true) {
      continue;
    }
    tensions.push(pc);
  }
  return tensions.sort((a, b) => a - b);
}

/**
 * A scale fit over a chord, with its non-chord tones sorted by what may be done
 * with them.
 *
 * `avoid`, `passing` and `tensions` partition the scale tones the chord does
 * not state: `avoid` may not be played at all, `passing` may be passed through
 * melodically but not sounded against the chord, and `tensions` may be added
 * freely as color. `avoid` is {@link avoidNotes} under `use: 'melodic'`, and
 * `avoid` together with `passing` is the harmonic reading.
 *
 * @category Scales
 */
export type ChordScaleReportEntry = {
  name: string;
  rootPc: number;
  avoid: number[];
  passing: number[];
  tensions: number[];
};

/**
 * Report the best-fitting scales for a chord with their avoid notes and tensions.
 *
 * Combines {@link chordScales}, {@link avoidNotes}, and {@link availableTensions}
 * into a single ergonomic result, ordered best fit first. The report is read as
 * playing advice, so the tones a line may pass through are reported apart from
 * the ones it may not touch; see {@link ChordScaleReportEntry}.
 *
 * @param chord The chord to analyze.
 * @param limit Optional maximum number of scales to report; all by default.
 * @returns One entry per reported scale, best fit first.
 *
 * @category Scales
 */
export function chordScaleReport(chord: Chord, limit?: number): ChordScaleReportEntry[] {
  if (limit !== undefined) {
    assertPositiveInt(limit, 'chord-scale report limit');
  }
  const matches = chordScales(chord);
  const chosen = limit === undefined ? matches : matches.slice(0, limit);
  return chosen.map((match) => {
    const harmonic = avoidNotes(chord, match.name);
    const melodic = new Set(avoidNotes(chord, match.name, { use: 'melodic' }));
    return {
      name: match.name,
      rootPc: match.rootPc,
      avoid: harmonic.filter((pc) => melodic.has(pc)),
      passing: harmonic.filter((pc) => !melodic.has(pc)),
      tensions: availableTensions(chord, match.name),
    };
  });
}

/**
 * A chord paired with the scale chosen for it by {@link scalesForChanges}.
 *
 * @category Scales
 */
export type ScaleChoice = {
  chord: Chord;
  scale: ChordScaleMatch;
};

/**
 * Small per-candidate penalty added in {@link scalesForChanges} so that, among
 * choices of otherwise-equal transition cost, the tighter best-fit scale wins.
 */
const RANK_PENALTY = 0.01;

/** Build the pitch-class set of a named scale rooted on `rootPc`. */
function scalePitchClassSet(name: string, rootPc: number): Set<number> {
  const mask = namedScaleMask(name);
  const pcs = new Set<number>();
  if (mask === undefined) {
    return pcs;
  }
  for (let n = 0; n < 12; n += 1) {
    if (((mask >> n) & 1) === 1) {
      pcs.add(pitchClass(rootPc + n));
    }
  }
  return pcs;
}

/** Count pitch classes that belong to exactly one of two sets. */
function symmetricDifferenceSize(a: Set<number>, b: Set<number>): number {
  let count = 0;
  for (const pc of a) {
    if (!b.has(pc)) {
      count += 1;
    }
  }
  for (const pc of b) {
    if (!a.has(pc)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Choose one scale per chord across a progression, favoring continuity.
 *
 * Each chord's {@link chordScales} candidates form a stage in a Viterbi-style
 * dynamic program. The transition cost between adjacent choices is the number
 * of pitch classes that differ between their pitch-class sets (the symmetric
 * difference), plus a small penalty for straying from a chord's best-fit scale
 * so that ties break toward the tighter fit. The minimum-total-cost path is
 * returned, one {@link ScaleChoice} per input chord in the original order.
 *
 * @param chords The chord sequence to choose scales for.
 * @returns One scale choice per chord, in input order.
 *
 * @category Scales
 */
export function scalesForChanges(chords: Chord[]): ScaleChoice[] {
  assertGenerationBudget(chords.length, 'chord-scale changes');
  if (chords.length === 0) {
    return [];
  }
  const candidateLists = chords.map((chord) => chordScales(chord));
  const pcSets = candidateLists.map((candidates) =>
    candidates.map((match) => scalePitchClassSet(match.name, match.rootPc)),
  );

  const first = candidateLists[0] ?? [];
  const dp: number[][] = [first.map((_, j) => j * RANK_PENALTY)];
  const back: number[][] = [first.map(() => -1)];

  for (let i = 1; i < candidateLists.length; i += 1) {
    const candidates = candidateLists[i] ?? [];
    const prevCosts = dp[i - 1] ?? [];
    const prevSets = pcSets[i - 1] ?? [];
    const curSets = pcSets[i] ?? [];
    const stageCosts: number[] = [];
    const stageBack: number[] = [];
    for (let j = 0; j < candidates.length; j += 1) {
      let bestCost = Number.POSITIVE_INFINITY;
      let bestPrev = -1;
      for (let k = 0; k < prevCosts.length; k += 1) {
        const transition = symmetricDifferenceSize(
          prevSets[k] ?? new Set(),
          curSets[j] ?? new Set(),
        );
        const cost = (prevCosts[k] ?? 0) + transition;
        if (cost < bestCost) {
          bestCost = cost;
          bestPrev = k;
        }
      }
      stageCosts.push(bestCost + j * RANK_PENALTY);
      stageBack.push(bestPrev);
    }
    dp.push(stageCosts);
    back.push(stageBack);
  }

  const lastCosts = dp[dp.length - 1] ?? [];
  let bestFinal = 0;
  for (let j = 1; j < lastCosts.length; j += 1) {
    if ((lastCosts[j] ?? Number.POSITIVE_INFINITY) < (lastCosts[bestFinal] ?? 0)) {
      bestFinal = j;
    }
  }

  const chosenIndices: number[] = new Array(candidateLists.length);
  let current = bestFinal;
  for (let i = candidateLists.length - 1; i >= 0; i -= 1) {
    chosenIndices[i] = current;
    current = back[i]?.[current] ?? -1;
  }

  return chords.map((chord, i) => {
    const candidates = candidateLists[i] ?? [];
    const scale = candidates[chosenIndices[i] ?? 0] ?? { name: 'chromatic', rootPc: chord.rootPc };
    return { chord, scale };
  });
}
