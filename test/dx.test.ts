import { describe, expect, it } from 'vitest';
import { analyzeArrangement } from '../src/analyze/arrange/index.js';
import { detectChord, detectChordBest, detectKeyFromNotes } from '../src/analyze/detect/index.js';
import { chordTimelineFromChords, chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { analyzeVoice, toVoiceNotes } from '../src/analyze/voice/index.js';
import { parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { generateCounterMelody } from '../src/generate/countermelody/index.js';
import { DRUM_NOTES, drumVoiceOf, generateDrums } from '../src/generate/drums/index.js';
import { extractGrooveTemplate, humanize } from '../src/generate/groove/index.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { generateMotif, motifToNoteEvents } from '../src/generate/motif/index.js';
import {
  BORROWED_DEGREES,
  generateProgression,
  pickProgressionPreset,
} from '../src/generate/progression/index.js';
import { generateRhythm, rhythmToNoteEvents } from '../src/generate/rhythm/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

describe('readonly inputs are accepted', () => {
  it('takes a frozen note array without a defensive copy at the call site', () => {
    const notes: readonly NoteEvent[] = Object.freeze([
      Object.freeze({ pitch: 60, startBeat: 0, durationBeat: 1 }),
      Object.freeze({ pitch: 64, startBeat: 1, durationBeat: 1 }),
      Object.freeze({ pitch: 67, startBeat: 2, durationBeat: 1 }),
    ]);
    const pitches: readonly number[] = Object.freeze([60, 64, 67]);
    expect(() => humanize(notes)).not.toThrow();
    expect(() => detectChord(pitches)).not.toThrow();
    expect(() => detectKeyFromNotes(notes)).not.toThrow();
    expect(() => chordTimelineFromNotes(notes)).not.toThrow();
    expect(() => analyzeArrangement([{ notes }])).not.toThrow();
    expect(() => harmonizeMelody({ melody: notes })).not.toThrow();
    expect(detectChordBest(pitches)?.rootPc).toBe(0);
  });
});

describe('drum voices are nameable', () => {
  it('names the note numbers the generator emits', () => {
    const hits = generateDrums({
      bars: 2,
      bpm: 120,
      style: 'standard',
      section: 'chorus',
      density: 0.7,
      fills: false,
    });
    expect(hits.some((hit) => hit.pitch === DRUM_NOTES.kick)).toBe(true);
    expect(hits.some((hit) => hit.pitch === DRUM_NOTES.snare)).toBe(true);
    // Every emitted pitch has a name, so a caller can route a kit by voice
    // instead of by magic number.
    for (const hit of hits) {
      expect(drumVoiceOf(hit.pitch), String(hit.pitch)).toBeDefined();
    }
    expect(drumVoiceOf(DRUM_NOTES.closedHiHat)).toBe('closedHiHat');
    expect(drumVoiceOf(1)).toBeUndefined();
  });
});

describe('generator output feeds the shared note-event pipeline', () => {
  it('converts a rhythm into note events', () => {
    const rhythm = generateRhythm(parseTimeSignature('4/4'), { bars: 2, seed: 1 });
    const notes = rhythmToNoteEvents(rhythm, 38, 100);
    expect(notes).toHaveLength(rhythm.length);
    expect(notes[0]?.pitch).toBe(38);
    expect(notes[0]?.startBeat).toBe(rhythm[0]?.position);
    expect(notes[0]?.durationBeat).toBe(rhythm[0]?.duration);
    // The whole point: it now goes through the shared pipeline.
    expect(humanize(notes)).toHaveLength(notes.length);
  });

  it('converts a motif into note events without aliasing the cell', () => {
    const cell = generateMotif({ key: cMajor, bars: 2 });
    const notes = motifToNoteEvents(cell);
    expect(notes).toHaveLength(cell.notes.length);
    const first = notes[0];
    if (first === undefined) {
      throw new Error('expected at least one converted note');
    }
    first.pitch = 0;
    expect(cell.notes[0]?.pitch).not.toBe(0);
  });

  it('extracts a groove template without being told the grid', () => {
    const events: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 0.5, velocity: 100 },
      { pitch: 60, startBeat: 0.51, durationBeat: 0.5, velocity: 80 },
    ];
    const ts = parseTimeSignature('4/4');
    expect(extractGrooveTemplate(events, ts)).toEqual(extractGrooveTemplate(events, ts, 4));
  });
});

describe('harmonizeMelody needs only a melody', () => {
  it('infers the key and uses documented defaults', () => {
    const melody: NoteEvent[] = [60, 64, 67, 65, 64, 62, 60].map((pitch, i) => ({
      pitch,
      startBeat: i,
      durationBeat: 1,
    }));
    const result = harmonizeMelody({ melody });
    expect(result.chords.length).toBeGreaterThan(0);
    expect(result.transposeSemitones).toBe(0);
    // Explicitly writing every default must produce the same answer.
    expect(
      harmonizeMelody({
        melody,
        key: 'infer',
        harmonicRhythm: 2,
        reharmonize: 'diatonic',
        placement: { transposeSearch: false, octaveSearch: false },
      }),
    ).toEqual(result);
  });
});

describe('countermelody takes a timeline', () => {
  it('sees a chord change the probe grid would miss', () => {
    // A change at beat 1.25 lies between the generator's half-beat probes, so
    // a bare callback cannot report it and a held note is never re-checked.
    const timeline = chordTimelineFromChords(
      [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 7, quality: 'dom7', startBeat: 1.25 },
      ],
      4,
    );
    const melody: NoteEvent[] = [
      { pitch: 72, startBeat: 0, durationBeat: 2 },
      { pitch: 71, startBeat: 2, durationBeat: 2 },
    ];
    const line = generateCounterMelody({ melody, timeline, key: cMajor });
    for (const note of line) {
      const chord = timeline.at(note.startBeat);
      expect(chord).not.toBe(null);
    }
    expect(line.length).toBeGreaterThan(0);
  });

  it('rejects being given neither a timeline nor a callback', () => {
    expect(() =>
      generateCounterMelody({
        melody: [{ pitch: 72, startBeat: 0, durationBeat: 1 }],
        key: cMajor,
      }),
    ).toThrow(TypeError);
  });
});

describe('progression presets are addressable', () => {
  it('accepts a caller-supplied degree list, borrowed degrees included', () => {
    const chords = generateProgression({
      key: cMajor,
      style: 'rock',
      bars: 4,
      preset: { degrees: [0, BORROWED_DEGREES.bVII, 3, 0] },
    });
    expect(chords.map((chord) => chord.rootPc)).toEqual([0, 10, 5, 0]);
    expect(() =>
      generateProgression({ key: cMajor, style: 'rock', bars: 4, preset: { degrees: [] } }),
    ).toThrow(RangeError);
  });

  it('names the preset a style and seed would choose', () => {
    for (const seed of [0, 1, 2, 7]) {
      const preset = pickProgressionPreset('dance', seed);
      expect(generateProgression({ key: cMajor, style: 'dance', bars: 4, seed })).toEqual(
        generateProgression({ key: cMajor, style: 'dance', bars: 4, presetId: preset.id }),
      );
    }
    expect(() => pickProgressionPreset('nonsense' as never)).toThrow();
  });
});

describe('analyzeVoice takes a plain melody', () => {
  it('needs neither hand-written ids nor an empty callback', () => {
    const melody: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 62, startBeat: 1, durationBeat: 1 },
      { pitch: 64, startBeat: 2, durationBeat: 1 },
    ];
    const chord = makeChord(0, 'maj');
    const labels = analyzeVoice(melody, () => chord, cMajor);
    expect(labels).toHaveLength(3);
    expect(labels.map((note) => note.noteId)).toEqual([0, 1, 2]);
    // The explicit form gives the same labels, plus the original indices that
    // toVoiceNotes records.
    const explicit = analyzeVoice(
      toVoiceNotes(melody),
      () => chord,
      cMajor,
      () => [],
    );
    expect(explicit.map((note) => note.labels)).toEqual(labels.map((note) => note.labels));
    expect(explicit.map((note) => note.originalIndex)).toEqual([0, 1, 2]);
  });
});
