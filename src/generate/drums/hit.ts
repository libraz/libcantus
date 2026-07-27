import { clampVel, GM } from './internal.js';

/**
 * The percussion voices the generator emits, as General MIDI note numbers.
 *
 * A {@link DrumHit} carries only its pitch, so splitting a kit across tracks —
 * kick to one, snare to another — means comparing against these numbers. They
 * are published so that comparison is a named constant covered by semver
 * rather than a hard-coded 36.
 *
 * @example
 * ```ts
 * import { DRUM_NOTES, generateDrums } from '@libraz/libcantus';
 * const hits = generateDrums({ bars: 1, bpm: 120, style: 'standard', section: 'verse', density: 0.5 });
 * const kick = hits.filter((hit) => hit.pitch === DRUM_NOTES.kick);
 * ```
 * @category Composition
 */
export const DRUM_NOTES = {
  kick: GM.BD,
  snare: GM.SD,
  sideStick: GM.SIDESTICK,
  handClap: GM.HANDCLAP,
  closedHiHat: GM.CHH,
  pedalHiHat: GM.FHH,
  openHiHat: GM.OHH,
  crash: GM.CRASH,
  ride: GM.RIDE,
  tambourine: GM.TAMBOURINE,
  highTom: GM.TOM_H,
  midTom: GM.TOM_M,
  lowTom: GM.TOM_L,
  shaker: GM.SHAKER,
} as const;

/**
 * A percussion voice name, one key of {@link DRUM_NOTES}.
 *
 * @category Composition
 */
export type DrumVoice = keyof typeof DRUM_NOTES;

/** Voice name for each emitted note number, for {@link drumVoiceOf}. */
const VOICE_BY_NOTE = new Map<number, DrumVoice>(
  (Object.entries(DRUM_NOTES) as [DrumVoice, number][]).map(([voice, note]) => [note, voice]),
);

/**
 * The voice a percussion note number names.
 *
 * @param pitch The General MIDI note number.
 * @returns The voice, or undefined for a note this generator never emits.
 * @category Composition
 */
export function drumVoiceOf(pitch: number): DrumVoice | undefined {
  return VOICE_BY_NOTE.get(pitch);
}

/**
 * A single percussion onset.
 *
 * @category Composition
 */
export type DrumHit = {
  /** General MIDI note number; {@link drumVoiceOf} names it. */
  pitch: number;
  startBeat: number;
  durationBeat: number;
  velocity: number;
};

/** Rounding used to key onsets by beat: a 128th note, finer than any grid used. */
const ONSET_KEY_SCALE = 128;

/**
 * Accumulator for drum onsets with velocity clamping and simple lookups.
 *
 * Onsets are indexed by (pitch, quantized beat) as they are added. The lookups
 * run inside the per-bar loop, so scanning the accumulated hits made the whole
 * generator quadratic in bar count — a few thousand bars took seconds.
 */
export class HitList {
  readonly hits: DrumHit[] = [];
  /** Onset keys already occupied, as `pitch:quantizedBeat`. */
  readonly #onsets = new Set<string>();

  /** Append a hit, clamping velocity and dropping non-positive positions. */
  add(pitch: number, startBeat: number, durationBeat: number, velocity: number): void {
    const beat = Math.max(0, startBeat);
    this.hits.push({
      pitch,
      startBeat: beat,
      durationBeat,
      velocity: clampVel(velocity),
    });
    this.#onsets.add(onsetKey(pitch, beat));
  }

  /** Whether a hit of this pitch already starts exactly at `startBeat`. */
  hasOnset(pitch: number, startBeat: number): boolean {
    return this.#onsets.has(onsetKey(pitch, startBeat));
  }

  /** True when a crash already sits within a 16th of `startBeat`. */
  hasCrashNear(startBeat: number): boolean {
    // The window is a 16th, and every grid in use is at least a 128th, so it is
    // enough to probe the quantized positions inside it.
    const steps = Math.round(0.25 * ONSET_KEY_SCALE);
    for (let step = 0; step < steps; step += 1) {
      if (this.#onsets.has(onsetKey(GM.CRASH, startBeat + step / ONSET_KEY_SCALE))) {
        return true;
      }
    }
    return false;
  }
}

/** Key an onset by pitch and quantized beat. */
function onsetKey(pitch: number, startBeat: number): string {
  return `${pitch}:${Math.round(startBeat * ONSET_KEY_SCALE)}`;
}
