/**
 * Fluent, immutable object model over the functional core.
 *
 * Each class wraps one of the library's plain data types (spelled notes,
 * chords, key/scales) and delegates every operation to the existing pure
 * functions. All instances are immutable: fields are read-only, transforming
 * methods return new instances, and getters hand out defensive copies of any
 * mutable data.
 */

export { Chord } from './chord.js';
export { Interval } from './interval.js';
export { Key } from './key.js';
export { Note } from './note.js';
export { Progression } from './progression.js';
