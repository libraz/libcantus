/**
 * Melody as a shape, rather than as a run of notes.
 *
 * A motif is held here as an interval contour plus a rhythmic profile, which is
 * what makes a restatement at another pitch level the same motif; the absolute
 * pitches only ever describe one statement of it. On that footing two statements
 * can be compared and the transformation between them named — repetition,
 * transposition, inversion, retrograde, augmentation — and phrases that stand in
 * no such relation can still be scored for similarity.
 *
 * Each of those is a question of its own and is answered in its own module:
 * {@link melodicContour} reads a line's shape, {@link extractMotifs} finds the
 * cells a melody is built from, {@link relateMotifs} names the device between
 * two statements, and {@link melodicSimilarity} scores two phrases standing in
 * no named relation. What all four read a melody through — its sounding notes
 * in order, its intervals, its onset gaps — is `internal.ts`.
 */

export type { ContourDirection, MelodicContour, MelodicContourShape } from './contour.js';
export { melodicContour } from './contour.js';
export type { MelodicPhrase } from './internal.js';
export type { ExtractMotifsOptions, MotifData, MotifOccurrence } from './motifs.js';
export { extractMotifs, motifFromNotes } from './motifs.js';
export type { MotifRelation, MotifRelationKind } from './relation.js';
export { relateMotifs } from './relation.js';
export type { MelodicComparison } from './similarity.js';
export { compareMelodies, melodicSimilarity } from './similarity.js';
