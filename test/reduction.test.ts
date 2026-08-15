import { describe, expect, it } from 'vitest';
import { reduceProgression } from '../src/analyze/reduction/index.js';
import type { ChordTimeline } from '../src/analyze/timeline/index.js';
import { chordTimelineFromChords } from '../src/analyze/timeline/index.js';
import type { ChordSpan } from '../src/theory/chord/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** Lay chords out one per bar of 4/4, in the order given. */
function progression(spans: readonly Omit<ChordSpan, 'startBeat'>[]) {
  const placed = spans.map((span, index) => ({ ...span, startBeat: index * 4 }));
  return chordTimelineFromChords(placed, spans.length * 4);
}

/** The roots of the chords a reduction keeps in the frame. */
function frame(entries: readonly { chord: { rootPc: number }; level: string }[]): number[] {
  return entries.filter((entry) => entry.level === 'structural').map((entry) => entry.chord.rootPc);
}

describe('reduceProgression', () => {
  it('hears the diminished chord in Cmaj7 - C#dim7 - Dm7 as passing', () => {
    const timeline = progression([
      { rootPc: 0, quality: 'maj7' },
      { rootPc: 1, quality: 'dim7' },
      { rootPc: 2, quality: 'min7' },
    ]);
    const reduced = reduceProgression(timeline, cMajor);
    expect(reduced.map((entry) => entry.level)).toEqual(['structural', 'passing', 'structural']);
    expect(reduced[1]?.rationale).toBe(
      'Passing: its root steps in from the previous chord and on to the next in the same direction',
    );
  });

  it('reduces I - IV - #ivo7 - V - I back to I - IV - V - I', () => {
    const timeline = progression([
      { rootPc: 0, quality: 'maj' },
      { rootPc: 5, quality: 'maj' },
      { rootPc: 6, quality: 'dim7' },
      { rootPc: 7, quality: 'maj' },
      { rootPc: 0, quality: 'maj' },
    ]);
    const reduced = reduceProgression(timeline, cMajor);
    expect(frame(reduced)).toEqual([0, 5, 7, 0]);
    expect(reduced[2]?.level).toBe('passing');
  });

  it('keeps the dominant a half cadence arrives on out of the reduction', () => {
    // The passing #ivo7 drives that half cadence, so the rule protecting a
    // cadence's agent has to stop short of it while still protecting the V.
    const timeline = progression([
      { rootPc: 0, quality: 'maj' },
      { rootPc: 5, quality: 'maj' },
      { rootPc: 6, quality: 'dim7' },
      { rootPc: 7, quality: 'maj' },
      { rootPc: 0, quality: 'maj' },
    ]);
    const reduced = reduceProgression(timeline, cMajor);
    expect(reduced[3]?.rationale).toBe(
      'Structural: the dominant of the key, the chord its tonic is approached from',
    );
  });

  it('marks a chord that steps away and returns as auxiliary', () => {
    const timeline = progression([
      { rootPc: 0, quality: 'maj' },
      { rootPc: 2, quality: 'min' },
      { rootPc: 0, quality: 'maj' },
    ]);
    const reduced = reduceProgression(timeline, cMajor);
    expect(reduced.map((entry) => entry.level)).toEqual(['structural', 'auxiliary', 'structural']);
    expect(reduced[1]?.rationale).toBe(
      'Auxiliary: its root steps away from the surrounding harmony and returns to it',
    );
  });

  it('never demotes the tonic or the dominant of the key', () => {
    // vi - V - IV walks down by step through the dominant, which a figure test
    // alone would read as passing.
    const timeline = progression([
      { rootPc: 9, quality: 'min' },
      { rootPc: 7, quality: 'maj' },
      { rootPc: 5, quality: 'maj' },
    ]);
    expect(reduceProgression(timeline, cMajor).map((entry) => entry.level)).toEqual([
      'structural',
      'structural',
      'structural',
    ]);
  });

  it('forms no figure across a rest', () => {
    // A rest between the tonic and the diminished chord: nothing steps into it,
    // so the figure that would make it passing never forms.
    const segments = [
      { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj7') },
      { startBeat: 8, endBeat: 12, chord: makeChord(1, 'dim7') },
      { startBeat: 12, endBeat: 16, chord: makeChord(2, 'min7') },
    ];
    const timeline: ChordTimeline = {
      segments,
      at: (beat) =>
        segments.find((seg) => beat >= seg.startBeat && beat < seg.endBeat)?.chord ?? null,
    };
    const reduced = reduceProgression(timeline, cMajor);
    expect(reduced[1]?.level).toBe('structural');
    expect(reduced[1]?.rationale).toContain('embellishes nothing');
  });

  it('reads the same progression by salience when asked to', () => {
    const timeline = chordTimelineFromChords(
      [
        { rootPc: 0, quality: 'maj7', startBeat: 0 },
        { rootPc: 1, quality: 'dim7', startBeat: 2 },
        { rootPc: 2, quality: 'min7', startBeat: 10 },
      ],
      12,
    );
    // The passing chord is the longest one here, so the salience reading keeps
    // it and the functional reading still does not.
    expect(reduceProgression(timeline, cMajor)[1]?.level).toBe('passing');
    const salient = reduceProgression(timeline, cMajor, { basis: 'duration' });
    expect(salient.map((entry) => entry.level)).toEqual(['structural', 'structural', 'structural']);
    expect(salient[1]?.rationale).toBe(
      'Structural: it holds the harmony at least as long as the median chord',
    );
  });

  it('follows the key over a modulation', () => {
    // The same D minor triad is a supertonic in C and a tonic in D minor; only
    // the second reading keeps it in the frame on its own account.
    const timeline = progression([
      { rootPc: 0, quality: 'maj' },
      { rootPc: 2, quality: 'min' },
      { rootPc: 0, quality: 'maj' },
    ]);
    expect(reduceProgression(timeline, (beat) => (beat < 4 ? cMajor : majorKey(2)))[1]?.level).toBe(
      'structural',
    );
  });

  it('labels every segment, in timeline order', () => {
    const timeline = progression([
      { rootPc: 0, quality: 'maj' },
      { rootPc: 5, quality: 'maj' },
      { rootPc: 7, quality: 'maj' },
    ]);
    const reduced = reduceProgression(timeline, cMajor);
    expect(reduced).toHaveLength(timeline.segments.length);
    for (let index = 0; index < reduced.length; index += 1) {
      expect(reduced[index]?.chord).toEqual(timeline.segments[index]?.chord);
      expect(reduced[index]?.rationale.startsWith('Structural')).toBe(true);
    }
  });

  it('reduces the same input the same way every time', () => {
    const spans: Omit<ChordSpan, 'startBeat'>[] = [
      { rootPc: 0, quality: 'maj7' },
      { rootPc: 1, quality: 'dim7' },
      { rootPc: 2, quality: 'min7' },
      { rootPc: 7, quality: 'dom7' },
      { rootPc: 0, quality: 'maj7' },
    ];
    const first = reduceProgression(progression(spans), cMajor);
    for (let run = 0; run < 3; run += 1) {
      expect(reduceProgression(progression(spans), cMajor)).toEqual(first);
    }
  });
});
