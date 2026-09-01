/**
 * Which scale form a key stands in.
 *
 * Kept in a module of its own, below both the masks that define the forms and
 * the coercion that accepts one from a caller: the mask table names it, the
 * accepted key shapes carry it, and neither can be the other's home without one
 * importing the other back.
 *
 * `'modal'` is the honest answer for a key standing in none of the four, and it
 * is an answer rather than an absence.
 *
 * @category Scales
 */
export type KeyVariant = 'major' | 'natural' | 'harmonic' | 'melodic' | 'modal';
