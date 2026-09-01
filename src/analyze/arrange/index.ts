/**
 * Arrangement analysis: the capstone that ties the timeline, per-voice analysis,
 * functional harmony, and safety modules together for a whole multi-track piece.
 *
 * A chord timeline and key are inferred once from every track's notes pooled
 * together; each track is then analysed against that shared harmony, notes that
 * clash with the sounding chord are collected as conflicts, and a coarse tension
 * curve is sampled across the piece.
 */

// The role check the class API applies at its own entrance, so both entrances
// take the same set of names rather than each holding a list of its own.
export { trackRoleOf } from './internal.js';
export type { ArrangementSession, TrackEdit } from './session.js';
export { createArrangementSession } from './session.js';
export type { TensionPoint } from './tension.js';
export { tensionCurve, tensionCurveFrom } from './tension.js';
export type {
  ArrangementAnalysis,
  ArrangementOptions,
  ArrangementTrack,
  Conflict,
  TrackAnalysis,
  TrackRole,
} from './tracks.js';
export { analyzeArrangement, analyzePolyphony } from './tracks.js';
