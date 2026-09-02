import {
  isDiatonic,
  parallelKey,
  type TonicizableDegree,
  tonicizableDegrees,
} from '../../analyze/functional/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordQuality } from '../../theory/chord/index.js';
import { chordPitchClasses, diatonicTriad, makeChord } from '../../theory/chord/index.js';
import { scaleTonesInDegreeOrder } from '../../theory/scale/index.js';
import { heptatonicFrameOf } from '../../theory/tendency/index.js';
import type { Candidate, HarmonizeOptions } from './internal.js';
import { cadencesThroughRaisedSeventh } from './internal.js';

/**
 * What a root costs to build a chord on, by the semitones it sits above the
 * tonic: the tonic is free, the other primary triads are nearly so, and the
 * further a root sits from them the more evidence the melody has to supply.
 * Without it every triad sharing a melody note is equally good and the search
 * wanders through the ones that chain by fifths.
 *
 * It is read by interval rather than by the ordinal a degree occupies in the
 * scale, so a root carries the tonal weight of the function it actually has:
 * the subdominant costs what a subdominant costs whether the key spells it IV
 * or iv, and the subtonic a minor key closes plagally through is not charged
 * what a major key's leading-tone triad is charged for standing seventh in the
 * list. Roots no diatonic degree of a common mode reaches — the flat
 * supertonic, the tritone, the raised leading tone — are remote, and cost what
 * a chord the melody has to spell outright costs.
 */
const ROOT_WEIGHT_BY_SEMITONE = [0, 0.9, 0.3, 0.45, 0.45, 0.15, 0.9, 0.1, 0.3, 0.3, 0.3, 0.9];
/**
 * What a triad costs for its own instability, wherever in the key it sits. A
 * diminished or augmented triad in root position is unstable as a harmony, not
 * because of the degree it happens to fall on, so the melody has to sound the
 * note only that chord explains before the search will spend it — and the same
 * triad costs the same in every key that holds it.
 */
const UNSTABLE_TRIAD = 0.9;
/** The triad qualities {@link UNSTABLE_TRIAD} is charged for. */
const UNSTABLE_QUALITIES: ReadonlySet<ChordQuality> = new Set<ChordQuality>([
  'dim',
  'aug',
  'dim7',
  'm7b5',
  'aug7',
]);
/**
 * What using one of the key's own chords costs, standing for how much tonal
 * weight it carries.
 *
 * The price is a function of what the chord *is* in the key — where its root
 * sits above the tonic, and what the chord itself is — and never of the ordinal
 * position its degree occupies in the scale. A mode that spells its second
 * degree as a diminished triad therefore pays for a diminished triad rather
 * than inheriting what a minor supertonic costs, and one whose seventh degree
 * is a major triad pays for a subtonic rather than for a leading-tone triad.
 */
function vocabularyBase(rootPc: number, quality: ChordQuality, tonicPc: number): number {
  const above = (pitchClass(rootPc) - tonicPc + 12) % 12;
  const root = ROOT_WEIGHT_BY_SEMITONE[above] ?? UNSTABLE_TRIAD;
  return UNSTABLE_QUALITIES.has(quality) ? Math.max(root, UNSTABLE_TRIAD) : root;
}
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
 * The degrees a secondary dominant conventionally tonicizes, in the order the
 * candidate list has always held them.
 */
const SECONDARY_DOMINANT_TARGETS = [2, 4, 5, 6];
/**
 * Those degrees the key at hand can actually make a local tonic.
 *
 * Nothing tonicizes a diminished triad, so a degree whose own triad spans no
 * perfect fifth is no target: the supertonic of a minor key is diminished, and
 * a dominant seventh placed in front of it is a chord the analysis layer refuses
 * to read as applied. The degrees come from the same predicate that layer names
 * its targets with, so what the generator marks as a secondary dominant is what
 * the numeral can be written for.
 */
function secondaryDominantTargets(key: KeyScale): TonicizableDegree[] {
  const tonicizable = new Map(
    tonicizableDegrees(key).map((degree) => [degree.degreeNumber, degree] as const),
  );
  return SECONDARY_DOMINANT_TARGETS.map((degree) => tonicizable.get(degree)).filter(
    (degree): degree is TonicizableDegree => degree !== undefined,
  );
}
/**
 * The order those dominants open up in as the harmonic dial rises, by the
 * degree each tonicizes: the dominant's own dominant is the one an arranger
 * reaches for first, then the relative minor's, and the subdominant's last.
 * Kept apart from {@link SECONDARY_DOMINANT_TARGETS} so that widening the
 * vocabulary adds to the candidate list without reordering it.
 */
const SECONDARY_DOMINANT_ENTRY_ORDER = [5, 6, 2, 4];
/**
 * The order the parallel mode's chords open up in as the dial rises, keyed by
 * the semitone each root stands above the tonic: the minor subdominant first,
 * then the flat-side major triads a pop arranger reaches for, and the chords
 * that displace the tonic itself — the minor tonic and the diminished
 * supertonic — last. Kept apart from the vocabulary for the reason
 * {@link SECONDARY_DOMINANT_ENTRY_ORDER} is, and read as a preference rather
 * than a filter, so an offset it does not name still opens, behind the ones it
 * does.
 */
const BORROWED_ENTRY_ORDER = [5, 10, 8, 3, 7, 2, 0];
/**
 * The dial position at which the last secondary dominant has entered. Above it
 * the parallel mode's chords start arriving, so the two families open one after
 * the other rather than at once.
 */
const SECONDARY_DOMINANT_BAND = 0.5;
/** Every named reharmonization strength, in dial order. */
export const REHARMONIZE_STRENGTHS = ['diatonic', 'secondaryDominant', 'borrowed'] as const;
/** Where each named reharmonization strength sits on the harmonic dial. */
export const REHARMONIZE_DIAL: Record<NonNullable<HarmonizeOptions['reharmonize']>, number> = {
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
  const tonicPc = pitchClass(key.rootPc);
  // A degree is one of seven, so a key with some other number of tones — a
  // pentatonic or a blues scale, which pops writes tunes in — is read against
  // its parallel major, which is the frame the numerals and the tonicization
  // targets below are already measured in. Harmonizing a five-tone melody with
  // the triads of the major it lives in is what a player does; refusing it
  // because the scale has five tones is not.
  const frame = heptatonicFrameOf(key);
  const tones = scaleTonesInDegreeOrder(frame);
  const candidates: Candidate[] = tones.map((rootPc, index) => {
    // Scale degrees are 1-based across the library, while the array index is
    // not; the candidate records the degree, which is what reaches the caller.
    const degree = index + 1;
    const quality = diatonicTriad(degree, frame).quality;
    return {
      rootPc,
      quality,
      degree,
      secondaryDominant: false,
      base: vocabularyBase(rootPc, quality, tonicPc),
      pcs: chordPitchClasses(makeChord(rootPc, quality)),
    };
  });

  // A minor key cadences through the harmonic-minor dominant, so the major triad
  // a fifth above the tonic belongs to the key's own vocabulary rather than to
  // any widening of it. Without it the dominant-to-tonic and cadence terms are
  // unreachable in minor, and a minor melody can be harmonized but never closed.
  // The natural-minor `v` stays alongside it and carries the same degree, so the
  // search chooses between them on the melody. `generateProgression` has no
  // melody to choose on and settles the same question once, from the preset it
  // is writing: it raises the third of the fifth degree only under a preset
  // labelled `functional: 'cadenceStrong'`, and writes the natural-minor `v`
  // under every other one. A major key already holds this chord as its diatonic V, and
  // the duplicate filter below drops the repeat. A mode is left alone: the
  // diatonic tier promises the key's own triads, and the raised seventh this
  // adds is not one of dorian's, phrygian's or locrian's.
  if (cadencesThroughRaisedSeventh(key)) {
    const rootPc = (tonicPc + 7) % 12;
    candidates.push({
      rootPc,
      quality: 'maj',
      degree: 5,
      secondaryDominant: false,
      base: vocabularyBase(rootPc, 'maj', tonicPc),
      pcs: chordPitchClasses(makeChord(rootPc, 'maj')),
    });
  }

  // The degrees are kept in the same 1-based space as `Candidate.degree`, which
  // the voice-leading cost compares them against.
  const targets = secondaryDominantTargets(key);
  const entryOrder = SECONDARY_DOMINANT_ENTRY_ORDER.filter((degree) =>
    targets.some((target) => target.degreeNumber === degree),
  );
  const secondaryOpen = admittedCount(harmonic / SECONDARY_DOMINANT_BAND, targets.length);
  for (const target of targets) {
    if (entryOrder.indexOf(target.degreeNumber) >= secondaryOpen) {
      continue;
    }
    // The root comes from the target itself rather than from a second lookup by
    // degree number: the targets are numbered in the key's heptatonic frame, so
    // indexing any other list of tones by that number reads a different degree.
    const rootPc = (target.rootPc + 7) % 12;
    candidates.push({
      rootPc,
      quality: 'dom7',
      secondaryDominant: true,
      targetDegree: target.degreeNumber,
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
  // Usefulness, not degree order, decides which borrowing the next notch of the
  // dial buys: bVII is the borrowed chord pop writing reaches for most often and
  // the minor tonic the least, and taking them in degree order opened them the
  // other way round.
  const borrowedRank = (chord: Chord): number => {
    const offset = BORROWED_ENTRY_ORDER.indexOf(pitchClass(chord.rootPc - tonicPc));
    return offset < 0 ? BORROWED_ENTRY_ORDER.length : offset;
  };
  borrowed.sort((a, b) => borrowedRank(a) - borrowedRank(b));
  const borrowedOpen = admittedCount(
    (harmonic - SECONDARY_DOMINANT_BAND) / (1 - SECONDARY_DOMINANT_BAND),
    borrowed.length,
  );
  for (const chord of borrowed.slice(0, borrowedOpen)) {
    candidates.push({
      rootPc: chord.rootPc,
      quality: chord.quality,
      secondaryDominant: false,
      // A diminished or augmented triad is charged for what it is wherever it
      // comes from: priced at the flat borrowing rate, the ii dim borrowed from
      // the parallel minor came out cheaper than the key's own vii dim, and
      // which of the two a phrase took was decided by the tie-break jitter
      // rather than by the melody.
      base: UNSTABLE_QUALITIES.has(chord.quality)
        ? Math.max(BORROWED_BASE, UNSTABLE_TRIAD)
        : BORROWED_BASE,
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
