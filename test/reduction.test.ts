import { describe, expect, it } from 'vitest';
import type { ReductionLevel } from '../src/analyze/reduction/index.js';
import { reduceProgression } from '../src/analyze/reduction/index.js';
import type { ChordTimeline } from '../src/analyze/timeline/index.js';
import { chordTimelineFromChords } from '../src/analyze/timeline/index.js';
import type { TheoryLabel } from '../src/analyze/voice/index.js';
import { analyzeVoice } from '../src/analyze/voice/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { substituteChord } from '../src/generate/reharmony/index.js';
import type { ChordSpan } from '../src/theory/chord/index.js';
import { makeChord, spanFromChord } from '../src/theory/chord/index.js';
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

  it('marks a chord that steps away and returns as a neighbor', () => {
    const timeline = progression([
      { rootPc: 0, quality: 'maj' },
      { rootPc: 2, quality: 'min' },
      { rootPc: 0, quality: 'maj' },
    ]);
    const reduced = reduceProgression(timeline, cMajor);
    expect(reduced.map((entry) => entry.level)).toEqual(['structural', 'neighbor', 'structural']);
    expect(reduced[1]?.rationale).toBe(
      'Neighbor: its root steps away from the surrounding harmony and returns to it',
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
      'Structural: it holds the harmony longer than the chords around it',
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

  it('carries the beat range of the segment it labels', () => {
    const timeline = progression([
      { rootPc: 0, quality: 'maj7' },
      { rootPc: 1, quality: 'dim7' },
      { rootPc: 2, quality: 'min7' },
    ]);
    expect(
      reduceProgression(timeline, cMajor).map((entry) => [entry.startBeat, entry.endBeat]),
    ).toEqual(timeline.segments.map((segment) => [segment.startBeat, segment.endBeat]));
  });

  it('keeps the frame where it sounded when a filtered reduction drives a rewrite', () => {
    // The workflow the module documents: filter to the frame, hold those chords
    // fixed, and rewrite the rest. Without a beat range on the entries the
    // filtered chords no longer say when they sound, and the rewrite has to
    // guess — which moves the harmony it was meant to preserve.
    const spans: Omit<ChordSpan, 'startBeat'>[] = [
      { rootPc: 0, quality: 'maj7' },
      { rootPc: 1, quality: 'dim7' },
      { rootPc: 2, quality: 'min7' },
      { rootPc: 7, quality: 'dom7' },
      { rootPc: 0, quality: 'maj7' },
    ];
    const timeline = progression(spans);
    const reduced = reduceProgression(timeline, cMajor);
    const structural = reduced.filter((entry) => entry.level === 'structural');
    expect(structural.length).toBeLessThan(reduced.length);

    const rewritten = reduced.map((entry) =>
      entry.level === 'structural'
        ? spanFromChord(entry.chord, entry.startBeat)
        : spanFromChord(
            substituteChord(entry.chord, cMajor)[0]?.chord ?? entry.chord,
            entry.startBeat,
          ),
    );
    const rebuilt = chordTimelineFromChords(rewritten, spans.length * 4);
    for (const entry of structural) {
      expect(rebuilt.at(entry.startBeat)?.rootPc).toBe(entry.chord.rootPc);
      expect(rebuilt.at(entry.endBeat - 1)?.rootPc).toBe(entry.chord.rootPc);
    }
  });

  it('names the neighbor figure the way the note level names it', () => {
    // One legend for both levels of analysis: a host that colours `'neighbor'`
    // reaches the chord-level figure and the note-level label with the same
    // string, and these two assignments only typecheck while it does.
    const figure = 'neighbor';
    const chordLevel: ReductionLevel = figure;
    const noteLevel: TheoryLabel['kind'] = figure;
    expect(chordLevel).toBe(noteLevel);

    const timeline = progression([
      { rootPc: 0, quality: 'maj' },
      { rootPc: 2, quality: 'min' },
      { rootPc: 0, quality: 'maj' },
    ]);
    const chords = reduceProgression(timeline, cMajor).filter((entry) => entry.level === figure);
    const notes = analyzeVoice(
      [60, 62, 60].map((pitch, index) => ({ pitch, startBeat: index, durationBeat: 1 })),
      () => makeChord(0, 'maj'),
      cMajor,
    ).filter((note) => note.labels.some((label) => label.kind === figure));
    expect(chords).toHaveLength(1);
    expect(notes).toHaveLength(1);
  });

  it('hears a cadential six-four as the dominant it stands on, not as the tonic', () => {
    // I - I64 - V - I: the six-four's bass has already arrived on the dominant,
    // so the tonic triad above it prolongs that dominant. Keeping it as the
    // key's own tonic reported the frame one chord too early.
    const timeline = progression([
      { rootPc: 0, quality: 'maj' },
      { rootPc: 0, quality: 'maj', bassPc: 7 },
      { rootPc: 7, quality: 'maj' },
      { rootPc: 0, quality: 'maj' },
    ]);
    const sixFour = reduceProgression(timeline, cMajor)[1];
    expect(sixFour?.rationale).toBe(
      'Structural: a tonic six-four on the bass of the dominant that follows, which prolongs that dominant rather than framing the tonic',
    );
  });

  it('keeps reading a six-four the bass leaves as the inverted tonic it is', () => {
    // IV - I64 - IV: the bass steps away and back, so nothing has arrived on
    // the dominant and the six-four is an ordinary inverted tonic.
    const timeline = progression([
      { rootPc: 5, quality: 'maj' },
      { rootPc: 0, quality: 'maj', bassPc: 7 },
      { rootPc: 5, quality: 'maj' },
    ]);
    expect(reduceProgression(timeline, cMajor)[1]?.rationale).toBe(
      'Structural: the tonic of the key, which the progression is heard against',
    );
  });

  it('still demotes a figure when every chord is the same length', () => {
    // C | C | C#dim7 | C. An even harmonic rhythm is the loop, the vamp and the
    // cue — the repertoire the salience reading exists for — so a reading that
    // protects every chord because none outlasts the median reduces nothing
    // exactly where it is wanted.
    const spans: Omit<ChordSpan, 'startBeat'>[] = [
      { rootPc: 0, quality: 'maj' },
      { rootPc: 0, quality: 'maj' },
      { rootPc: 1, quality: 'dim7' },
      { rootPc: 0, quality: 'maj' },
    ];
    const salient = reduceProgression(progression(spans), cMajor, { basis: 'duration' });
    expect(salient[2]?.level).toBe('neighbor');
    expect(frame(salient)).toEqual([0, 0, 0]);
    // The functional reading demotes it too: the chromatic chord frames nothing.
    const functional = reduceProgression(progression(spans), cMajor);
    expect(functional[2]?.level).toBe('neighbor');
  });

  it('demotes an even-length passing chord under either reading', () => {
    // C | C#dim7 | D: the root steps through in one direction rather than away
    // and back, so the figure is a passing one under both bases.
    const spans: Omit<ChordSpan, 'startBeat'>[] = [
      { rootPc: 0, quality: 'maj' },
      { rootPc: 1, quality: 'dim7' },
      { rootPc: 2, quality: 'min7' },
      { rootPc: 0, quality: 'maj' },
    ];
    expect(reduceProgression(progression(spans), cMajor, { basis: 'duration' })[1]?.level).toBe(
      'passing',
    );
  });

  it('keeps the chord that outlasts its neighbours in the frame', () => {
    // Four beats against one: the long chord is salient, the short ones are not,
    // and the figure between them is free to demote the middle one.
    const timeline = chordTimelineFromChords(
      [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 1, quality: 'dim7', startBeat: 4 },
        { rootPc: 2, quality: 'min7', startBeat: 5 },
        { rootPc: 7, quality: 'dom7', startBeat: 6 },
      ],
      10,
    );
    const salient = reduceProgression(timeline, cMajor, { basis: 'duration' });
    expect(salient[0]?.level).toBe('structural');
    expect(salient[0]?.rationale).toBe(
      'Structural: it holds the harmony longer than the chords around it',
    );
    expect(salient[1]?.level).toBe('passing');
  });

  it('rejects a reading it does not have', () => {
    const timeline = progression([{ rootPc: 0, quality: 'maj' }]);
    expect(() => reduceProgression(timeline, cMajor, { basis: 'salience' as 'duration' })).toThrow(
      InvalidInputError,
    );
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
