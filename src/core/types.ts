/**
 * A key/scale definition anchored on a root pitch class.
 *
 * `modeMask12` is a 12-bit mask where bit `n` set means the pitch class
 * `(rootPc + n) % 12` belongs to the scale. Bit 0 (the root) is always set;
 * {@link maskFromOffsets} enforces this so the root is always a scale tone.
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
 */
export type NoteEvent = {
  /** MIDI pitch (middle C = 60). */
  pitch: number;
  /** Onset in quarter-note beats, absolute from the start of the timeline. */
  startBeat: number;
  /** Duration in quarter-note beats. */
  durationBeat: number;
  /** MIDI velocity in [0, 127], when known. */
  velocity?: number;
};
