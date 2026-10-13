/**
 * Form: the analysis units larger than the chord — phrases, hypermeter, and
 * sections.
 *
 * Everything else in the library reads music locally: a chord against the next
 * chord, a note against the chord under it. That is why a cadence detected from
 * a chord pair cannot say how much it closes — a cadence is a cadence because
 * it falls at the end of a phrase. This layer supplies the missing unit, and
 * with it the answer to which cadence carries the structure.
 */

export type { Hypermeter, HypermeterOptions } from './hypermeter.js';
export { hypermeter } from './hypermeter.js';
export type { Phrase, PhraseOptions, PhraseSignal, StructuralCadence } from './phrase.js';
export { phrasesFromTimeline, structuralCadences } from './phrase.js';
export type { FormSection, FormSectionOptions } from './section.js';
export { sectionsFromNotes } from './section.js';
