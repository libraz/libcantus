import {
  BASS_4_STRING,
  GUITAR_STANDARD,
  type NoteEvent,
  type PlayabilityIssueType,
  playability,
} from '@libraz/libcantus/core';
import { DRUM_KIT, generateBassLine, humanize } from '@libraz/libcantus/generate';
import { majorKey, makeChord } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

function note(pitch: number, startBeat: number, durationBeat = 1): NoteEvent {
  return { pitch, startBeat, durationBeat };
}

function issuesOfType(report: ReturnType<typeof playability>, type: PlayabilityIssueType) {
  return report.issues.filter((issue) => issue.type === type);
}

describe('playability reads overlaps as a line, not as held notes', () => {
  it('plays a legato chromatic line on one string without a conflict', () => {
    const legato = [28, 29, 30, 31].map((pitch, i) => note(pitch, i, 1.05));
    const report = playability(legato, BASS_4_STRING);
    expect(issuesOfType(report, 'stringConflict')).toEqual([]);
    expect(report.issues).toEqual([]);
  });

  it('gives a humanized bass line the verdict of the line as written', () => {
    const segments = [4, 9, 11, 4].map((rootPc, bar) => ({
      startBeat: bar * 4,
      endBeat: bar * 4 + 4,
      chord: makeChord(rootPc, 'maj'),
    }));
    for (let seed = 0; seed < 20; seed += 1) {
      const line = generateBassLine({
        segments,
        key: majorKey(4),
        style: 'walking',
        ctx: { seed },
        instrument: BASS_4_STRING,
      });
      expect(playability(line, BASS_4_STRING).issues).toEqual([]);
      const played = humanize(line, { timing: 0.03, velocity: 0, accent: 0, ctx: { seed } });
      const structural = playability(played, BASS_4_STRING).issues.filter(
        (issue) => issue.layer < 3,
      );
      expect(structural, `seed ${seed}`).toEqual([]);
    }
  });
});

describe('playability measures the fretting hand between stopped notes', () => {
  it('does not move the hand for an open-string pedal', () => {
    const pedal = Array.from({ length: 8 }, (_, i) => note(i % 2 ? 76 : 64, i * 0.25, 0.25));
    const stopped = Array.from({ length: 8 }, (_, i) => note(76, i * 0.25, 0.25));
    const report = playability(pedal, GUITAR_STANDARD, 160);
    expect(issuesOfType(report, 'tooFast')).toEqual([]);
    expect(report.difficulty).toBe(playability(stopped, GUITAR_STANDARD, 160).difficulty);
  });

  it('reads a strummed chord as one hand shape', () => {
    // Each chord tone starts a little later and is released with the others.
    const chords = (stagger: number): NoteEvent[] =>
      [0, 4].flatMap((bar) =>
        [48, 52, 55].map((pitch, k) =>
          note(pitch + (bar > 0 ? 5 : 0), bar + k * stagger, 4 - k * stagger),
        ),
      );
    const strummed = playability(chords(0.0039), GUITAR_STANDARD, 120);
    const struck = playability(chords(0), GUITAR_STANDARD, 120);
    expect(issuesOfType(strummed, 'tooFast')).toEqual([]);
    expect(strummed.difficulty).toBe(struck.difficulty);
    expect(strummed.placements).toEqual(struck.placements);
  });
});

describe('playability ignores notes that never sound', () => {
  it('charges a neck no time for a zero-length note', () => {
    const withSilent = [note(29, 0, 0.1), note(67, 0.1, 0), note(29, 0.2, 0.1)];
    const without = [note(29, 0, 0.1), note(29, 0.2, 0.1)];
    const report = playability(withSilent, BASS_4_STRING, 200);
    expect(issuesOfType(report, 'tooFast')).toEqual([]);
    expect(report.difficulty).toBe(playability(without, BASS_4_STRING, 200).difficulty);
    expect(report.placements).toHaveLength(3);
    expect(report.placements[1]).toEqual({ note: 1 });
  });

  it('does not stretch the span difficulty is measured over', () => {
    const passage = [note(36, 0), note(38, 0.5)];
    expect(playability([...passage, note(36, 100, 0)], DRUM_KIT).difficulty).toBe(
      playability(passage, DRUM_KIT).difficulty,
    );
  });
});
