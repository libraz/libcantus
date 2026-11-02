import { InvalidInputError } from '../../core/errors/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import {
  assertArray,
  assertGenerationBudget,
  assertOneOf,
  assertOptions,
  assertPitchClass,
  assertPositiveInt,
} from '../../core/validation/index.js';
import type { Chord } from '../chord/index.js';
import { chordPitchClasses, displacedThirds } from '../chord/index.js';
import type { ScaleNameInput } from '../scale/index.js';
import {
  assertModeMask,
  NAMED_SCALES,
  namedScaleMask,
  requireScaleMask,
  resolveScaleName,
} from '../scale/index.js';
import { type ChordLike, toChordData } from '../symbol/index.js';
import { soundsDominantSeventh } from '../tendency/index.js';

/**
 * The mask of a scale a chord-scale question may be asked about.
 *
 * Chord-scale theory is a Western practice, so the register of world scales is
 * not a vocabulary these functions answer from: a raga offered as the scale
 * over an altered dominant would read as an answer while being a category
 * error. {@link chordScales} proposes {@link NAMED_SCALES} and nothing else,
 * and the questions asked about one chosen scale accept exactly what it can
 * propose — an alias of a Western scale included, a world scale not.
 *
 * @param name The scale name or alias.
 * @param label What the name is, for the error message.
 * @returns The 12-bit mask.
 * @throws If the name is not a built-in scale, or names a world scale.
 */
function requireChordScaleMask(name: ScaleNameInput, label = 'scale'): number {
  const canonical = resolveScaleName(name);
  if (canonical !== undefined && !Object.hasOwn(NAMED_SCALES, canonical)) {
    throw new InvalidInputError(
      `${label} must name a scale chord-scale theory ranks; ${String(name)} is a world scale`,
    );
  }
  return requireScaleMask(name, label);
}

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
  // The mask is read with bit operations and a pitch class shifts it, so both
  // coerce: an entry that is not a pitch class would silently be read as one.
  assertModeMask(scaleMask, 'scaleMask');
  assertPitchClass(scaleRootPc, 'scaleRootPc');
  const pcs = assertArray<number>(chordPcs, 'chord pitch classes');
  for (let index = 0; index < pcs.length; index += 1) {
    const pc = assertPitchClass(pcs[index] ?? Number.NaN, `chord pitch classes[${index}]`);
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
export const ALIASED_SCALE_NAME_LIST: readonly string[] = ['major', 'naturalMinor'];

const ALIASED_SCALE_NAMES = new Set(ALIASED_SCALE_NAME_LIST);

/** Number of tones in a heptatonic (seven-note) scale. */
export const HEPTATONIC_SIZE = 7;

/**
 * Conventional preference among equally-fitting scales, brightest first.
 *
 * Several modes fit a chord that states no third or sixth — a power chord, a
 * suspension — equally well. Alphabetical order made `aeolian` the answer for
 * those, naming a minor mode as the best fit for a mode-neutral chord.
 */
export const SCALE_PREFERENCE = [
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
export const IDIOMATIC_SCALES: Partial<Record<Chord['quality'], readonly string[]>> = {
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
 * A dominant seventh may use altered colors while retaining its perfect fifth
 * in the voicing. It is read from the tones, as every dominant is: a major
 * third with a minor seventh whose only tones outside the altered scale are the
 * fifth, so `7`, `7alt`, `7b9`, `7#9` and `7b13` all take it while `9` and `13`
 * do not. Lead sheets commonly write the shorter `7` here.
 */
function isAlteredDominant(chord: Chord, scaleName: string): boolean {
  if (scaleName !== 'altered' || !soundsDominantSeventh(chord)) {
    return false;
  }
  const mask = namedScaleMask(scaleName);
  const rootPc = pitchClass(chord.rootPc);
  const fifthPc = pitchClass(rootPc + 7);
  return (
    mask !== undefined &&
    chordPitchClasses(chord).every((pc) => pc === fifthPc || maskHasPitchClass(mask, rootPc, pc))
  );
}

/**
 * List the scales that fit over a chord, best fit first.
 *
 * Only the chord root is considered as the scale root, matching the
 * conventional chord-scale relationship. Every entry of {@link NAMED_SCALES}
 * whose pitch-class set is a superset of the chord's is returned once per
 * distinct pitch-class set (aliased masks such as major/ionian report only the
 * modal name). The chromatic scale is only returned as a fallback when no other
 * scale contains the chord.
 *
 * The ranking applies these keys in order:
 *
 * 1. The idiomatic scales for the chord quality, in the order they are named
 *    there, ahead of every scale that is not one of them.
 * 2. For bare triads and smaller chords, heptatonic scales ahead of pentatonics
 *    and other sizes: a pentatonic adds no modal color over a triad, so the
 *    seven-note modes are the more useful answer.
 * 3. Fewest extra scale tones beyond the chord.
 * 4. Conventional modal preference.
 * 5. Fewest avoid notes, which separates the symmetric and melodic-minor
 *    scales the modal preference does not name.
 * 6. Alphabetical order, so the list is stable.
 *
 * The idiomatic key comes first, so the head of the list is the scale a player
 * would name rather than the tightest fit: over `Cm7b5` the locrian mode leads
 * even though the blues scale adds fewer tones, because locrian is what a
 * half-diminished chord is read as. Read further down the list, or pick by name,
 * when the closest fit is what is wanted; {@link scalesForChanges} makes the
 * choice for a whole progression.
 *
 * @param chord The chord to fit scales over, as a chord symbol, chord data, or
 *   a `Chord`.
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
export function chordScales(chord: ChordLike): ChordScaleMatch[] {
  const data = toChordData(chord);
  const chordPcs = chordPitchClasses(data);
  const rootPc = pitchClass(data.rootPc);
  const ranked: {
    name: string;
    extra: number;
    size: number;
    avoid: number;
    borrowed: boolean;
    idiomatic: number;
    conventional: number;
  }[] = [];
  // A tone beyond the plain seventh chord is a written alteration or extension.
  const writesTension = chordPcs.some((pc) => ![0, 4, 7, 10].includes(pitchClass(pc - rootPc)));
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
    const fits = scaleMatchesChord(chordPcs, mask, rootPc);
    if (fits || isAlteredDominant(data, name)) {
      const size = popcount12(mask);
      ranked.push({
        name,
        extra: size - chordPcs.length,
        size,
        avoid: fits ? clashingTones(data, mask, false, chordPcs).length : 0,
        // Eligible only through the fifth exemption: a scale that holds every
        // written tone is the better answer for a chord that writes a tension.
        borrowed: writesTension && !fits,
        idiomatic: idiomaticRank(data, name),
        conventional: conventionalRank(name),
      });
    }
  }
  if (ranked.length === 0) {
    // No diatonic-style scale contains the chord; fall back to the chromatic
    // scale, which trivially contains every pitch class.
    return [{ name: 'chromatic', rootPc }];
  }
  const preferHeptatonic = chordPcs.length <= 3;
  ranked.sort((a, b) => {
    if (a.idiomatic !== b.idiomatic) {
      return a.idiomatic - b.idiomatic;
    }
    if (preferHeptatonic && (a.size === HEPTATONIC_SIZE) !== (b.size === HEPTATONIC_SIZE)) {
      return a.size === HEPTATONIC_SIZE ? -1 : 1;
    }
    if (a.borrowed !== b.borrowed) {
      return a.borrowed ? 1 : -1;
    }
    if (a.extra !== b.extra) {
      return a.extra - b.extra;
    }
    if (a.conventional !== b.conventional) {
      return a.conventional - b.conventional;
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
 * Which use an avoid note is judged for: sounding it, or passing through it.
 *
 * `'harmonic'` is the Berklee-style rule — a tone that must not be
 * sounded against the chord. `'melodic'` keeps only what a line cannot pass
 * through either, which is the semitone above the root; every other clash
 * resolves as the line moves on. Over a chord that sounds a dominant seventh
 * the semitone above the root is the flat ninth, a tension under either use
 * whichever scale supplies it; the flat thirteenth stays a harmonic avoid note.
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
 * @param chord The chord providing the chord tones, as a chord symbol, chord
 *   data, or a `Chord`.
 * @param scaleName A key of {@link NAMED_SCALES}, or an alias of one. A world
 *   scale is not one: chord-scale theory is a Western practice, so a raga named
 *   here is rejected rather than answered with a number.
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
  chord: ChordLike,
  scaleName: ScaleNameInput,
  opts: AvoidNotesOptions = {},
): number[] {
  const asked = assertOptions(opts, 'opts');
  const mask = requireChordScaleMask(scaleName);
  const data = toChordData(chord);
  const use = assertOneOf(asked.use ?? 'harmonic', ['harmonic', 'melodic'], 'avoid-note use');
  if (isAlteredDominant(data, scaleName)) {
    return [];
  }
  return clashingNotes(data, mask, use === 'melodic');
}

/**
 * The scale tones that clash with the chord by the avoid-note rule, whatever
 * function the chord serves: {@link avoidNotes} before the altered dominant's
 * exemption. Empty when the scale does not contain the chord.
 */
function clashingNotes(data: Chord, mask: number, melodic: boolean): number[] {
  const chordPcs = chordPitchClasses(data);
  if (!scaleMatchesChord(chordPcs, mask, pitchClass(data.rootPc))) {
    return [];
  }
  return clashingTones(data, mask, melodic, chordPcs);
}

/** {@link clashingNotes} for a scale already known to contain the chord. */
function clashingTones(data: Chord, mask: number, melodic: boolean, chordPcs: number[]): number[] {
  const rootPc = pitchClass(data.rootPc);
  const chordSet = new Set(chordPcs);
  // Sounding the third a suspension stands in for is what undoes the
  // suspension, so it is an avoid note however consonant it is against the
  // scale. Both thirds are named: a suspension does not say which one it
  // displaced — that is what suspending is — so meeting either one ends it.
  const displaced = new Set(displacedThirds(data));
  const semitoneAboveRoot = pitchClass(rootPc + 1);
  // The flat ninth is a dominant's own tension, whichever scale supplies it.
  const dominantNinth = soundsDominantSeventh(data) ? semitoneAboveRoot : undefined;
  const avoid: number[] = [];
  for (let pc = 0; pc < 12; pc += 1) {
    if (!maskHasPitchClass(mask, rootPc, pc) || chordSet.has(pc) || pc === dominantNinth) {
      continue;
    }
    if (melodic && pc !== semitoneAboveRoot) {
      continue;
    }
    if (chordSet.has(pitchClass(pc - 1)) || displaced.has(pc)) {
      avoid.push(pc);
    }
  }
  return avoid.sort((a, b) => a - b);
}

/**
 * Semitones above the root of the colors a dominant takes when it resolves to a
 * minor tonic: the flat ninth, the sharp ninth, and the flat thirteenth.
 *
 * Over a dominant read on its own, the flat ninth is already a tension and the
 * others sit a semitone above a chord tone. Heard as the dominant of a minor key
 * they are the key's own tones, and standard practice, so the function the
 * chord serves is what decides.
 */
export const MINOR_RESOLUTION_TENSIONS = [1, 3, 8] as const;

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
  /**
   * The chord this one resolves to, as a chord symbol, chord data, or a
   * `Chord`.
   */
  resolvesTo?: ChordLike;
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
 * resolving down a fifth to a minor tonic takes its sharp ninth and flat
 * thirteenth as well as the flat ninth every dominant takes. Only
 * scale tones are ever added, so the result stays within the scale.
 *
 * @param chord The chord providing the chord tones, as a chord symbol, chord
 *   data, or a `Chord`.
 * @param scaleName A key of {@link NAMED_SCALES}, or an alias of one; a world
 *   scale is outside chord-scale theory, as in {@link avoidNotes}.
 * @param opts Set `resolvesTo` to the chord this one resolves to.
 * @returns The available-tension pitch classes, sorted ascending in [0, 11].
 * @throws If `scaleName` is not a built-in scale, as {@link avoidNotes} does.
 *
 * @example
 * ```ts
 * import { makeChord, availableTensions } from '@libraz/libcantus';
 * availableTensions(makeChord(0, 'maj7'), 'ionian'); // [2, 9] — color tones over Cmaj7
 * availableTensions(makeChord(7, 'dom7'), 'phrygianDominant', { resolvesTo: makeChord(0, 'min') });
 * // [3, 8] — the b9, and the b13 the resolution to C minor makes available
 * ```
 *
 * @category Scales
 */
export function availableTensions(
  chord: ChordLike,
  scaleName: ScaleNameInput,
  opts: AvailableTensionsOptions = {},
): number[] {
  const asked = assertOptions(opts, 'opts');
  const mask = requireChordScaleMask(scaleName);
  const data = toChordData(chord);
  return tensionsOver(data, mask, isAlteredDominant(data, scaleName), asked.resolvesTo);
}

/**
 * The tensions of a normalized chord over a scale mask, past the coercions of
 * {@link availableTensions}. `avoid` is the harmonic avoid-note list when the
 * caller already holds it.
 */
function tensionsOver(
  data: Chord,
  mask: number,
  alteredDominant: boolean,
  resolvesTo: ChordLike | undefined,
  avoid?: readonly number[],
): number[] {
  const rootPc = pitchClass(data.rootPc);
  const chordPcs = chordPitchClasses(data);
  if (!scaleMatchesChord(chordPcs, mask, rootPc) && !alteredDominant) {
    return [];
  }
  const chordSet = new Set(chordPcs);
  const avoidSet = new Set<number>(
    alteredDominant ? [] : (avoid ?? clashingTones(data, mask, false, chordPcs)),
  );
  const functional = resolvesToMinorTonic(
    data,
    chordPcs,
    resolvesTo === undefined ? undefined : toChordData(resolvesTo),
  )
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
 * @param chord The chord to analyze, as a chord symbol, chord data, or a
 *   `Chord`.
 * @param limit Optional maximum number of scales to report; all by default.
 * @returns One entry per reported scale, best fit first.
 *
 * @category Scales
 */
export function chordScaleReport(chord: ChordLike, limit?: number): ChordScaleReportEntry[] {
  if (limit !== undefined) {
    assertPositiveInt(limit, 'chord-scale report limit');
  }
  const data = toChordData(chord);
  const matches = chordScales(data);
  const chosen = limit === undefined ? matches : matches.slice(0, limit);
  return chosen.map((match) => {
    const mask = requireChordScaleMask(match.name);
    const alteredDominant = isAlteredDominant(data, match.name);
    const harmonic = alteredDominant ? [] : clashingNotes(data, mask, false);
    const melodic = new Set(alteredDominant ? [] : clashingNotes(data, mask, true));
    return {
      name: match.name,
      rootPc: match.rootPc,
      avoid: harmonic.filter((pc) => melodic.has(pc)),
      passing: harmonic.filter((pc) => !melodic.has(pc)),
      tensions: tensionsOver(data, mask, alteredDominant, undefined, harmonic),
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
export const RANK_PENALTY = 0.01;

/** Build the pitch-class set of a named scale rooted on `rootPc`, as a 12-bit mask. */
function scalePitchClassSet(name: string, rootPc: number): number {
  const mask = namedScaleMask(name);
  let set = 0;
  if (mask === undefined) {
    return set;
  }
  for (let n = 0; n < 12; n += 1) {
    if (((mask >> n) & 1) === 1) {
      set |= 1 << pitchClass(rootPc + n);
    }
  }
  return set;
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
 * Each choice pairs its scale with the chord exactly as it was handed in, so
 * this takes plain chord data rather than the wider forms the entry points
 * above accept.
 *
 * @param chords The chord sequence to choose scales for.
 * @returns One scale choice per chord, in input order.
 *
 * @category Scales
 */
export function scalesForChanges(chords: readonly Chord[]): ScaleChoice[] {
  assertArray(chords, 'chord-scale changes');
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
        const transition = popcount12((prevSets[k] ?? 0) ^ (curSets[j] ?? 0));
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
