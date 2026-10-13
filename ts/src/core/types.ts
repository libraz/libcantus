import type { Articulation } from './instrument/articulation.js';

/**
 * A key/scale definition anchored on a root pitch class.
 *
 * `modeMask12` is a 12-bit mask where bit `n` set means the pitch class
 * `(rootPc + n) % 12` belongs to the scale. Bit 0 (the root) is always set;
 * {@link maskFromOffsets} enforces this so the root is always a scale tone.
 *
 * @category Core
 */
export type KeyScale = {
  rootPc: number;
  modeMask12: number;
};

/**
 * A single sounding note on a beat-indexed timeline: an absolute MIDI pitch, an
 * onset and duration measured in quarter-note beats, and an optional MIDI
 * velocity. This is the library-wide interchange shape for note events read
 * from or written to a DAW/MIDI track; the harmonizer's `MelodyNote` and the
 * analysis `VoiceNote` are specializations of it.
 *
 * @category Core
 */
export type NoteEvent = {
  /** MIDI pitch in [0, 127] (middle C = 60). */
  pitch: number;
  /**
   * Onset in quarter-note beats, absolute from the start of the timeline, and
   * unbounded below: beat 0 is the first downbeat, so a pickup sounds before it
   * and is written at a negative onset, in the bar numbered -1. Shifting the
   * whole timeline a bar later instead would move every strong beat with it,
   * and the upbeat would then be analyzed as a downbeat. A caller that knows
   * how long its pickup is narrows the bound with
   * {@link NoteEventAssertOptions.minStartBeat}.
   */
  startBeat: number;
  /** Duration in quarter-note beats. */
  durationBeat: number;
  /** MIDI velocity in [0, 127], when known. */
  velocity?: number;
  /**
   * How the note is played, when the writer had an intent to record. The
   * library carries the intent only: turning `slide` into pitch bend or `ghost`
   * into a velocity floor depends on the instrument and controller layout at
   * the far end, so it is the reader's decision. Optional, so a reader that
   * knows nothing of articulation reads the note exactly as before.
   */
  articulation?: Articulation;
};
