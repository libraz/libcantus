import type { MeterLike } from '../../src/core/meter/index.js';
import type { NoteEvent } from '../../src/core/types.js';
import type { KeyLike } from '../../src/theory/scale/index.js';

/**
 * A hand-written tune whose phrase boundaries are known in advance, so a
 * caller can check a form analysis against ground truth rather than against
 * its own output.
 */
export type ReferenceFixture = {
  /** What the fixture is for; used only in test titles. */
  readonly name: string;
  readonly notes: readonly NoteEvent[];
  /** The melody line alone: the subset of `notes` that is not accompaniment. */
  readonly melody: readonly NoteEvent[];
  readonly meters: MeterLike;
  readonly key: KeyLike;
  /**
   * The beats bounding each phrase, first to last: `[0, 32, 64]` is two
   * phrases, `[0, 32)` and `[32, 64)`.
   */
  readonly phraseBoundaries: readonly number[];
};

/** One note. */
function note(pitch: number, startBeat: number, durationBeat = 1): NoteEvent {
  return { pitch, startBeat, durationBeat };
}

/** A run of notes of the given duration, one after another from `startBeat`. */
function run(pitches: readonly number[], startBeat: number, durationBeat = 1): NoteEvent[] {
  return pitches.map((pitch, i) => note(pitch, startBeat + i * durationBeat, durationBeat));
}

/** A block chord: every pitch sounding for the same span. */
function chord(pitches: readonly number[], startBeat: number, durationBeat: number): NoteEvent[] {
  return pitches.map((pitch) => note(pitch, startBeat, durationBeat));
}

// Diatonic triads in C major, voiced so their bass pitch class carries the
// inversion `chordTimelineFromNotes` reads: root position everywhere except
// `V6`, whose bass is the third.
const I = [48, 60, 64, 67];
const ii = [50, 62, 65, 69];
const IV = [53, 60, 65, 69];
const V = [55, 59, 62, 67];
const V6 = [59, 62, 67, 71];
const vi = [57, 60, 64, 69];

/**
 * Eight bars of harmony in C major: `I-V6-vi-IV`, then `ii-IV-V-I`. No chord
 * next to a phrase-final `I` is `IV` or `V`, so the only authentic cadence in
 * the unit is the one that closes it.
 */
function eightBarHarmony(at: number): NoteEvent[] {
  return [
    ...chord(I, at, 4),
    ...chord(V6, at + 4, 4),
    ...chord(vi, at + 8, 4),
    ...chord(IV, at + 12, 4),
    ...chord(ii, at + 16, 4),
    ...chord(IV, at + 20, 4),
    ...chord(V, at + 24, 4),
    ...chord(I, at + 28, 4),
  ];
}

/**
 * Eight bars of melody over {@link eightBarHarmony}: `hook` stated and
 * restated in bars one and five, connecting figures in between, closing on a
 * held tonic in the last bar.
 */
function eightBarMelody(at: number, hook: readonly number[]): NoteEvent[] {
  return [
    ...run(hook, at),
    ...run([79, 77, 76, 74], at + 4),
    ...run([72, 76, 79, 77], at + 8),
    ...run([76, 74, 72, 74], at + 12),
    ...run(hook, at + 16),
    ...run([79, 77, 76, 74], at + 20),
    ...run([72, 74, 76, 79], at + 24),
    note(72, at + 28, 4),
  ];
}

/** The hook `A`: a rising stepwise figure over the tonic. */
const HOOK_A = [72, 74, 76, 77];
/** `A` transposed down a fourth. */
const HOOK_A_TRANSPOSED = HOOK_A.map((pitch) => pitch - 5);
/** `A` inverted around its own first note. */
const HOOK_A_INVERTED = HOOK_A.map((pitch) => 2 * (HOOK_A[0] ?? 0) - pitch);

/** One eight-bar unit: harmony plus a melody built on the given hook. */
function unit(at: number, hook: readonly number[]): NoteEvent[] {
  return [...eightBarHarmony(at), ...eightBarMelody(at, hook)];
}

/**
 * Eight bars of harmony for the bridge: `vi-IV-ii` twice, then `IV-V`. `I`
 * never sounds, so nothing before the closing bar rests on the tonic, and the
 * only cadence in the unit is the half cadence its last bar arrives on.
 */
function bridgeHarmony(at: number): NoteEvent[] {
  return [
    ...chord(vi, at, 4),
    ...chord(IV, at + 4, 4),
    ...chord(ii, at + 8, 4),
    ...chord(vi, at + 12, 4),
    ...chord(IV, at + 16, 4),
    ...chord(ii, at + 20, 4),
    ...chord(IV, at + 24, 4),
    ...chord(V, at + 28, 4),
  ];
}

/**
 * Eight bars of melody for the bridge: the inverted hook stated in bars one
 * and five, each followed by its own filler rather than a shared one, so the
 * two statements never extend into a matching longer cell; a lower, falling
 * contour contrasts with {@link eightBarMelody}'s register; the close holds a
 * tone of the bridge's closing `V`.
 */
function bridgeMelody(at: number, invertedHook: readonly number[]): NoteEvent[] {
  return [
    ...run(invertedHook, at),
    ...run([65, 62, 59, 55], at + 4),
    ...run([57, 60, 64, 67], at + 8),
    ...run([64, 67, 71, 69], at + 12),
    ...run(invertedHook, at + 16),
    ...run([64, 60, 57, 53], at + 20),
    ...run([55, 59, 62, 65], at + 24),
    note(62, at + 28, 4),
  ];
}

/** One eight-bar bridge unit: contrasting harmony plus a melody on the inverted hook. */
function bridgeUnit(at: number, invertedHook: readonly number[]): NoteEvent[] {
  return [...bridgeHarmony(at), ...bridgeMelody(at, invertedHook)];
}

/**
 * The notes of an AABA song built from a hook: the first two eight-bar units
 * state it plain, then transposed; the third is the contrasting bridge, which
 * states it inverted; the fourth returns to it plain.
 */
function aabaNotes(
  hook: readonly number[],
  transposedHook: readonly number[],
  invertedHook: readonly number[],
): NoteEvent[] {
  return [
    ...unit(0, hook),
    ...unit(32, transposedHook),
    ...bridgeUnit(64, invertedHook),
    ...unit(96, hook),
  ];
}

/** The melody alone of {@link aabaNotes}. */
function aabaMelody(
  hook: readonly number[],
  transposedHook: readonly number[],
  invertedHook: readonly number[],
): NoteEvent[] {
  return [
    ...eightBarMelody(0, hook),
    ...eightBarMelody(32, transposedHook),
    ...bridgeMelody(64, invertedHook),
    ...eightBarMelody(96, hook),
  ];
}

/**
 * The "source song": four eight-bar phrases in AABA form, 4/4. The A units
 * are on `I-V6-vi-IV` moving to `ii-IV-V-I`; the second A restates the hook
 * transposed, the last A returns to it plain. The bridge contrasts them on a
 * `vi-IV-ii` progression that never touches the tonic, closing on a half
 * cadence, with the hook inverted over a lower, falling filler.
 */
export const SOURCE_SONG: ReferenceFixture = {
  name: 'source song (AABA, C major)',
  notes: aabaNotes(HOOK_A, HOOK_A_TRANSPOSED, HOOK_A_INVERTED),
  melody: aabaMelody(HOOK_A, HOOK_A_TRANSPOSED, HOOK_A_INVERTED),
  meters: '4/4',
  key: 'C major',
  phraseBoundaries: [0, 32, 64, 96, 128],
};

/**
 * The hook of {@link SAME_STRUCTURE_SONG}: the same rhythm as `HOOK_A`, an
 * unrelated interval sequence (a rising third and a falling second, where
 * `HOOK_A` is a stepwise rise).
 */
const HOOK_C = [72, 76, 79, 77];
const HOOK_C_TRANSPOSED = HOOK_C.map((pitch) => pitch - 5);
const HOOK_C_INVERTED = HOOK_C.map((pitch) => 2 * (HOOK_C[0] ?? 0) - pitch);

/**
 * "Same structure, different song": the identical form, rhythm, harmony and
 * motif relations as {@link SOURCE_SONG} — only the hook's own intervals
 * differ.
 */
export const SAME_STRUCTURE_SONG: ReferenceFixture = {
  name: 'same-structure song (AABA, C major, a different hook)',
  notes: aabaNotes(HOOK_C, HOOK_C_TRANSPOSED, HOOK_C_INVERTED),
  melody: aabaMelody(HOOK_C, HOOK_C_TRANSPOSED, HOOK_C_INVERTED),
  meters: '4/4',
  key: 'C major',
  phraseBoundaries: [0, 32, 64, 96, 128],
};

/** {@link SOURCE_SONG}'s pitches, transposed up a perfect fourth into F major. */
export const TRANSPOSED_SONG: ReferenceFixture = {
  name: 'transposed song (AABA, F major, +5 semitones)',
  notes: SOURCE_SONG.notes.map((event) => ({ ...event, pitch: event.pitch + 5 })),
  melody: SOURCE_SONG.melody.map((event) => ({ ...event, pitch: event.pitch + 5 })),
  meters: SOURCE_SONG.meters,
  key: 'F major',
  phraseBoundaries: SOURCE_SONG.phraseBoundaries,
};

/**
 * The weak progression a phrase moves through before its own cadence. `I`
 * never appears here, so nothing before the phrase's own `V-I` ever arrives
 * on the tonic and reads as a cadence of its own.
 */
const WEAK_CYCLE = [vi, IV, ii];

/**
 * A phrase of `bars` bars in 3/4: the harmony moves through `vi-IV-ii` in
 * two-beat steps that drift across the bar lines rather than one chord per
 * bar, so nothing in it argues a metric grid the way {@link eightBarHarmony}'s
 * bar-aligned chords do. `V` sounds only for the single beat before the close,
 * and the tonic that follows holds the whole last bar — the only note in the
 * phrase long enough, or bar-aligned enough, to argue an arrival.
 */
function phraseHarmony(at: number, bars: number, cycleStart: number): NoteEvent[] {
  const weakBeats = bars * 3 - 4;
  const weak: NoteEvent[] = [];
  let pos = 0;
  let cycle = cycleStart;
  while (pos < weakBeats) {
    const dur = Math.min(2, weakBeats - pos);
    weak.push(...chord(WEAK_CYCLE[cycle % WEAK_CYCLE.length] ?? [], at + pos, dur));
    pos += dur;
    cycle += 1;
  }
  return [...weak, ...chord(V, at + weakBeats, 1), ...chord(I, at + weakBeats + 1, 3)];
}

/**
 * The melody over {@link phraseHarmony}: two-beat figures matching the
 * harmony's own drifting rhythm, seeded so consecutive phrases never restate
 * one another, a leading tone on the closing `V` beat, then the held tonic
 * close.
 */
function phraseMelody(at: number, bars: number, seed: number): NoteEvent[] {
  const weakBeats = bars * 3 - 4;
  const wander = Array.from({ length: weakBeats }, (_, i) => 65 + ((i * 2 + seed) % 9));
  const figures: NoteEvent[] = [];
  for (let i = 0; i < weakBeats; i += 2) {
    const dur = Math.min(2, weakBeats - i);
    figures.push(note(wander[i] ?? 0, at + i, dur));
  }
  return [...figures, note(71, at + weakBeats, 1), note(72, at + weakBeats + 1, 3)];
}

/**
 * "Unrelated song": through-composed in 3/4, two phrases of different
 * lengths (3 and 5 bars) rather than the repeating equal-length sections
 * {@link SOURCE_SONG} has. Each phrase's melody is seeded differently, so
 * neither restates the other the way a hook does.
 */
const UNRELATED_PHRASE_BARS = [3, 5];

function unrelatedPhrases(): { notes: NoteEvent[]; melody: NoteEvent[]; boundaries: number[] } {
  const notes: NoteEvent[] = [];
  const melody: NoteEvent[] = [];
  const boundaries = [0];
  let at = 0;
  UNRELATED_PHRASE_BARS.forEach((bars, i) => {
    const line = phraseMelody(at, bars, i * 3 + 1);
    notes.push(...phraseHarmony(at, bars, i + 1), ...line);
    melody.push(...line);
    at += bars * 3;
    boundaries.push(at);
  });
  return { notes, melody, boundaries };
}

const UNRELATED = unrelatedPhrases();

export const UNRELATED_SONG: ReferenceFixture = {
  name: 'unrelated song (through-composed, 3/4, irregular phrase lengths)',
  notes: UNRELATED.notes,
  melody: UNRELATED.melody,
  meters: '3/4',
  key: 'C major',
  phraseBoundaries: UNRELATED.boundaries,
};
