/**
 * What a reading of the melody costs.
 *
 * Three terms, one per kind of evidence: what the melody's own notes say about
 * the chord under them, what the move from the chord before says about the
 * pair, and what a phrase ending asks of the chord that closes it. The search
 * adds them up; nothing here knows how the search runs.
 */

import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Candidate, MelodyNote, Segment } from './internal.js';
import { isKeyTone } from './internal.js';
import { classifyMelodyTones } from './nct.js';

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
 *   root above the tonic, by tonal weight: tonic 0,
 *   dominant 0.1, subdominant 0.15, supertonic,
 *   submediant and subtonic 0.3, mediant 0.45,
 *   a remote root 0.9
 *   diminished or augmented triad, wherever it sits    0.9
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
export const OUT_OF_KEY_PER_BEAT = 3;
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
export function emissionCost(
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
/** Whether a candidate is the key's dominant, in a quality that can act as one. */
function isDominantOf(cand: Candidate, tonicPc: number): boolean {
  return cand.rootPc === (tonicPc + 7) % 12 && (cand.quality === 'maj' || cand.quality === 'dom7');
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
export function transitionCost(prev: Candidate, cur: Candidate, tonicPc: number): number {
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
export function phraseEndBonus(
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
