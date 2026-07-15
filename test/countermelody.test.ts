import { describe, expect, it } from 'vitest';
import { isStrongBeat } from '../src/core/meter/index.js';
import type { KeyScale, NoteEvent } from '../src/core/types.js';
import type { CounterMelodyOptions } from '../src/generate/countermelody/index.js';
import { generateCounterMelody } from '../src/generate/countermelody/index.js';
import type { Chord } from '../src/theory/chord/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { createsParallelOctave, createsParallelPerfect } from '../src/theory/counterpoint/index.js';
import { evaluateSafety, NoteSafety } from '../src/theory/safety/index.js';
import { MAJOR_MASK } from '../src/theory/scale/index.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

/** One chord per 4/4 bar: C, Am, F, G, repeating. */
const progression: Chord[] = [
  makeChord(0, 'maj'),
  makeChord(9, 'min'),
  makeChord(5, 'maj'),
  makeChord(7, 'maj'),
];
const chordAt = (beat: number): Chord | null =>
  progression[Math.floor(beat / 4) % progression.length] ?? null;

/** Quarter-note melody starting at beat 0, chord tones on the strong beats. */
const melody: NoteEvent[] = [72, 71, 67, 64, 69, 67, 64, 60].map((pitch, i) => ({
  pitch,
  startBeat: i,
  durationBeat: 1,
  velocity: 100,
}));

/** The melody note sounding at a beat (latest onset wins on overlaps). */
function soundingAt(notes: NoteEvent[], beat: number): NoteEvent | undefined {
  let found: NoteEvent | undefined;
  for (const n of notes) {
    if (n.startBeat - 1e-9 <= beat && beat < n.startBeat + n.durationBeat - 1e-9) {
      if (!found || n.startBeat > found.startBeat) {
        found = n;
      }
    }
  }
  return found;
}

function generate(over: Partial<CounterMelodyOptions> = {}): NoteEvent[] {
  return generateCounterMelody({ melody, chordAt, key: cMajor, ...over });
}

describe('generateCounterMelody', () => {
  it('returns [] for an empty melody', () => {
    expect(generateCounterMelody({ melody: [], chordAt, key: cMajor })).toEqual([]);
  });

  it('returns an explicit rest instead of an unchecked fallback when no pitch is safe', () => {
    const impossible: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 2 }];
    expect(
      generateCounterMelody({
        melody: impossible,
        chordAt: () => makeChord(0, 'maj'),
        key: cMajor,
        rhythm: 'follow',
        register: 'below',
        pitchLow: 59,
        pitchHigh: 59,
      }),
    ).toEqual([]);
  });

  it('produces no dissonant notes when re-evaluated in context', () => {
    for (const rhythm of ['complement', 'follow'] as const) {
      const counter = generate({ rhythm });
      expect(counter.length).toBeGreaterThan(0);
      for (let i = 0; i < counter.length; i += 1) {
        const note = counter[i];
        if (!note) continue;
        const end = note.startBeat + note.durationBeat;
        const boundaries = new Set<number>([note.startBeat]);
        for (const melodyNote of melody) {
          if (melodyNote.startBeat > note.startBeat && melodyNote.startBeat < end) {
            boundaries.add(melodyNote.startBeat);
          }
        }
        for (let beat = Math.ceil(note.startBeat / 4) * 4; beat < end; beat += 4) {
          if (beat > note.startBeat) boundaries.add(beat);
        }
        for (const beat of [...boundaries].sort((a, b) => a - b)) {
          const mel = soundingAt(melody, beat);
          const melodyAttacked = mel !== undefined && Math.abs(mel.startBeat - beat) < 1e-9;
          const melPrev = melodyAttacked ? soundingAt(melody, beat - 2e-9)?.pitch : mel?.pitch;
          const previousCounter = i > 0 ? counter[i - 1] : undefined;
          const contiguous =
            previousCounter !== undefined &&
            Math.abs(previousCounter.startBeat + previousCounter.durationBeat - note.startBeat) <
              1e-9;
          const result = evaluateSafety({
            profile: 'pop',
            candidatePitch: note.pitch,
            prevPitch:
              beat === note.startBeat
                ? contiguous
                  ? previousCounter?.pitch
                  : undefined
                : note.pitch,
            chord: chordAt(beat),
            key: cMajor,
            otherVoices: mel ? [{ pitch: mel.pitch, prevPitch: melPrev }] : [],
            strongBeat: isStrongBeat(beat, { numerator: 4, denominator: 4 }),
          });
          expect(result.safety).not.toBe(NoteSafety.Dissonant);
        }
      }
    }
  });

  it('keeps a held counter note safe when the melody attacks inside it', () => {
    const changingMelody: NoteEvent[] = [
      { pitch: 72, startBeat: 0, durationBeat: 4 },
      { pitch: 63, startBeat: 2, durationBeat: 1 },
    ];
    const counter = generateCounterMelody({
      melody: changingMelody,
      chordAt: () => makeChord(0, 'maj'),
      key: cMajor,
      rhythm: 'complement',
      pitchLow: 55,
      pitchHigh: 67,
      seed: 7,
    });
    const held = counter.find(
      (note) => note.startBeat <= 2 && 2 < note.startBeat + note.durationBeat,
    );
    expect(held).toBeDefined();
    const result = evaluateSafety({
      profile: 'pop',
      candidatePitch: held?.pitch ?? 0,
      prevPitch: held?.pitch,
      chord: makeChord(0, 'maj'),
      key: cMajor,
      otherVoices: [{ pitch: 63, prevPitch: 72 }],
      strongBeat: true,
    });
    expect(result.safety).toBe(NoteSafety.Safe);
  });

  it('keeps a held counter note safe across an explicit chord boundary', () => {
    const sustained: NoteEvent[] = [{ pitch: 72, startBeat: 0, durationBeat: 4 }];
    const changingChord = (beat: number): Chord =>
      beat < 1.75 ? makeChord(0, 'maj') : makeChord(5, 'maj');
    const counter = generateCounterMelody({
      melody: sustained,
      chordAt: changingChord,
      chordChangeBeats: [1.75],
      key: cMajor,
      rhythm: 'complement',
      pitchLow: 55,
      pitchHigh: 67,
      seed: 7,
    });
    const held = counter.find(
      (note) => note.startBeat <= 1.75 && 1.75 < note.startBeat + note.durationBeat,
    );
    expect(held).toBeDefined();
    const result = evaluateSafety({
      profile: 'pop',
      candidatePitch: held?.pitch ?? 0,
      prevPitch: held?.pitch,
      chord: changingChord(1.75),
      key: cMajor,
      otherVoices: [{ pitch: 72, prevPitch: 72 }],
      strongBeat: false,
    });
    expect(result.safety).toBe(NoteSafety.Safe);
  });

  it('avoids parallel perfect intervals with the melody', () => {
    for (const rhythm of ['complement', 'follow'] as const) {
      const counter = generate({ rhythm });
      for (let i = 1; i < counter.length; i += 1) {
        const prev = counter[i - 1];
        const cur = counter[i];
        if (!prev || !cur) {
          continue;
        }
        const melPrev = soundingAt(melody, cur.startBeat - 2e-9);
        const melCur = soundingAt(melody, cur.startBeat);
        if (!melPrev || !melCur) {
          continue;
        }
        expect(createsParallelPerfect(prev.pitch, cur.pitch, melPrev.pitch, melCur.pitch)).toBe(
          false,
        );
        expect(createsParallelOctave(prev.pitch, cur.pitch, melPrev.pitch, melCur.pitch)).toBe(
          false,
        );
      }
    }
  });

  it('keeps the counter line below the melody by default', () => {
    const counter = generate({ rhythm: 'follow' });
    for (const note of counter) {
      const mel = soundingAt(melody, note.startBeat);
      if (mel) {
        expect(note.pitch).toBeLessThan(mel.pitch);
      }
    }
  });

  it('keeps the counter line above the melody when requested', () => {
    const counter = generate({ rhythm: 'follow', register: 'above' });
    expect(counter.length).toBeGreaterThan(0);
    for (const note of counter) {
      const mel = soundingAt(melody, note.startBeat);
      if (mel) {
        expect(note.pitch).toBeGreaterThan(mel.pitch);
      }
    }
  });

  it('mirrors melody onsets in follow mode', () => {
    const counter = generate({ rhythm: 'follow' });
    expect(counter.map((n) => n.startBeat)).toEqual(melody.map((n) => n.startBeat));
    // Each note extends to the next counter onset.
    for (let i = 1; i < counter.length; i += 1) {
      const prev = counter[i - 1];
      const cur = counter[i];
      if (prev && cur) {
        expect(prev.startBeat + prev.durationBeat).toBeCloseTo(cur.startBeat);
      }
    }
  });

  it('fills melody gaps in complement mode', () => {
    // A rest from beat 1 to beat 3 between two melody notes.
    const gapped: NoteEvent[] = [
      { pitch: 72, startBeat: 0, durationBeat: 1 },
      { pitch: 67, startBeat: 3, durationBeat: 1 },
    ];
    const counter = generateCounterMelody({ melody: gapped, chordAt, key: cMajor });
    const inGap = counter.filter((n) => n.startBeat >= 1 && n.startBeat < 3);
    expect(inGap.length).toBeGreaterThan(0);
    for (const note of counter) {
      expect(note.startBeat).toBeGreaterThanOrEqual(0);
      expect(note.startBeat).toBeLessThan(4);
    }
  });

  it('sets a velocity slightly under the melody', () => {
    const counter = generate({ rhythm: 'follow' });
    for (const note of counter) {
      expect(note.velocity).toBeDefined();
      expect(note.velocity ?? 0).toBeLessThan(100);
      expect(note.velocity ?? 0).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = generate({ seed: 7 });
    const b = generate({ seed: 7 });
    expect(a).toEqual(b);
    // A different seed still yields a valid, safe line (it may or may not differ).
    const c = generate({ seed: 8 });
    expect(Array.isArray(c)).toBe(true);
    for (let i = 1; i < c.length; i += 1) {
      expect(c[i]?.startBeat ?? 0).toBeGreaterThan(c[i - 1]?.startBeat ?? 0);
    }
  });
});
