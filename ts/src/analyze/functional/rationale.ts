/**
 * The vocabulary the analyze layer explains itself in.
 *
 * `analyzeVoice` has always returned a short `rationale` beside the labels it
 * assigns; the chord, numeral, cadence and key readings say the same kind of
 * thing about a larger unit. One vocabulary keeps a rationale readable wherever
 * it comes from: the conclusion first, a colon, then the fact it rests on, as a
 * phrase rather than a sentence.
 *
 * The reading that was turned down is worth as much to a reader arguing with the
 * result as the one that was kept, so every entry point that ranks readings can
 * report them in the one shape below.
 */

/**
 * A reading that was considered and rejected, and why it lost.
 *
 * @category Arrangement & Analysis
 */
export type RejectedCandidate = {
  /** The rejected reading, named the way the accepted one is named. */
  label: string;
  /** Why the accepted reading was preferred over this one. */
  reason: string;
};

/**
 * Sentence-case a lower-case term standing at the head of a rationale.
 *
 * The vocabulary the labels come in — `'tonic'`, `'authentic'` — is lower case
 * because it is machine-readable; the same word opening a rationale is prose.
 */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
