import { describe, expect, it } from 'vitest';
import {
  type ArrangementTrack,
  analyzeArrangement,
  tensionCurve,
} from '../src/analyze/arrange/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { evaluateSafety, NoteSafety, ReasonFlag } from '../src/theory/safety/index.js';
import { majorKey } from '../src/theory/scale/index.js';

/** Build a block chord: every pitch sounding for the same span. */
function blockChord(pitches: number[], startBeat: number, durationBeat = 4): NoteEvent[] {
  return pitches.map((pitch) => ({ pitch, startBeat, durationBeat }));
}

/** Harmony track spelling C, F, G7, C as block chords, one per bar (4/4). */
function harmonyTrack(): NoteEvent[] {
  return [
    ...blockChord([48, 52, 55], 0), // C E G
    ...blockChord([53, 57, 60], 4), // F A C
    ...blockChord([55, 59, 62, 65], 8), // G B D F (dominant seventh)
    ...blockChord([48, 52, 55], 12), // C E G
  ];
}

/** Mostly-consonant quarter-note melody over the C-F-G7-C harmony. */
function melodyTrack(): NoteEvent[] {
  return [
    { pitch: 72, startBeat: 0, durationBeat: 1 }, // C over C
    { pitch: 76, startBeat: 1, durationBeat: 1 }, // E over C
    { pitch: 79, startBeat: 2, durationBeat: 1 }, // G over C
    { pitch: 76, startBeat: 3, durationBeat: 1 }, // E over C
    { pitch: 77, startBeat: 4, durationBeat: 1 }, // F over F
    { pitch: 81, startBeat: 5, durationBeat: 1 }, // A over F
    { pitch: 84, startBeat: 6, durationBeat: 1 }, // C over F
    { pitch: 81, startBeat: 7, durationBeat: 1 }, // A over F
    { pitch: 74, startBeat: 8, durationBeat: 1 }, // D over G7
    { pitch: 79, startBeat: 9, durationBeat: 1 }, // G over G7
    { pitch: 77, startBeat: 10, durationBeat: 1 }, // F over G7
    { pitch: 74, startBeat: 11, durationBeat: 1 }, // D over G7
    { pitch: 72, startBeat: 12, durationBeat: 4 }, // C over C
  ];
}

/** Root-note bass under the C-F-G7-C harmony. */
function bassTrack(): NoteEvent[] {
  return [
    { pitch: 36, startBeat: 0, durationBeat: 4 }, // C
    { pitch: 41, startBeat: 4, durationBeat: 4 }, // F
    { pitch: 43, startBeat: 8, durationBeat: 4 }, // G
    { pitch: 36, startBeat: 12, durationBeat: 4 }, // C
  ];
}

function baseArrangement(): ArrangementTrack[] {
  return [
    { name: 'melody', role: 'melody', notes: melodyTrack() },
    { name: 'harmony', role: 'harmony', notes: harmonyTrack() },
    { name: 'bass', role: 'bass', notes: bassTrack() },
  ];
}

describe('analyzeArrangement', () => {
  it('infers C major and the right chord per bar', () => {
    const analysis = analyzeArrangement(baseArrangement(), { key: majorKey(0) });
    expect(analysis.key.rootPc).toBe(0);
    const roots = analysis.timeline.segments.map((seg) => seg.chord.rootPc);
    expect(roots).toEqual([0, 5, 7, 0]);
    expect(analysis.timeline.at(0)?.rootPc).toBe(0);
    expect(analysis.timeline.at(4)?.rootPc).toBe(5);
    expect(analysis.timeline.at(8)?.rootPc).toBe(7);
    expect(analysis.timeline.at(12)?.rootPc).toBe(0);
  });

  it('labels the melody chord tones as chordTone', () => {
    const analysis = analyzeArrangement(baseArrangement(), { key: majorKey(0) });
    const melody = analysis.tracks.find((t) => t.name === 'melody');
    expect(melody).toBeDefined();
    const first = melody?.notes[0];
    expect(first?.labels.some((l) => l.kind === 'chordTone')).toBe(true);
    // Every diatonic chord tone of the consonant melody is a chord tone.
    const chordToneCount = (melody?.notes ?? []).filter((n) =>
      n.labels.some((l) => l.kind === 'chordTone'),
    ).length;
    expect(chordToneCount).toBeGreaterThanOrEqual(8);
  });

  it('reports the closing authentic cadence', () => {
    const analysis = analyzeArrangement(baseArrangement(), { key: majorKey(0) });
    const authentic = analysis.cadences.find((c) => c.type === 'authentic');
    expect(authentic).toBeDefined();
    expect(authentic?.atBeat).toBe(12);
  });

  it('flags a sustained dissonant melody note as a conflict', () => {
    const tracks = baseArrangement();
    // A held C# over the tonic C major chord on the downbeat: outside the key.
    const clashing: NoteEvent[] = [
      { pitch: 73, startBeat: 0, durationBeat: 4 },
      ...melodyTrack().filter((n) => n.startBeat >= 4),
    ];
    tracks[0] = { name: 'melody', role: 'melody', notes: clashing };
    const analysis = analyzeArrangement(tracks, { key: majorKey(0) });
    const conflict = analysis.conflicts.find(
      (c) => c.trackName === 'melody' && c.beat === 0 && c.pitch === 73,
    );
    expect(conflict).toBeDefined();
    expect(conflict?.safety).toBeGreaterThanOrEqual(NoteSafety.Warning);
    expect(conflict?.suggestions?.length).toBeGreaterThan(0);
    // Conflicts are ordered worst severity first.
    for (let i = 1; i < analysis.conflicts.length; i += 1) {
      const prev = analysis.conflicts[i - 1];
      const cur = analysis.conflicts[i];
      if (prev && cur) {
        expect(
          prev.safety > cur.safety || (prev.safety === cur.safety && prev.beat <= cur.beat),
        ).toBe(true);
      }
    }
  });

  it('re-checks a sustained note against each chord change it spans', () => {
    // A whole-note pedal C held from the I bar into the V bar: consonant over
    // C major at its onset, clashing with G major from beat 4. The low velocity
    // keeps the pedal out of the inferred chords.
    const tracks: ArrangementTrack[] = [
      {
        name: 'pedal',
        role: 'melody',
        notes: [{ pitch: 60, startBeat: 0, durationBeat: 8, velocity: 20 }],
      },
      {
        name: 'harmony',
        role: 'harmony',
        notes: [...blockChord([48, 52, 55], 0), ...blockChord([43, 47, 50, 55], 4)],
      },
    ];
    const analysis = analyzeArrangement(tracks, { key: majorKey(0) });
    expect(analysis.timeline.segments.map((seg) => seg.chord.rootPc)).toEqual([0, 7]);
    // No clash at the onset over the tonic chord...
    expect(analysis.conflicts.find((c) => c.trackName === 'pedal' && c.beat === 0)).toBeUndefined();
    // ...but the held C is re-evaluated at the chord change and flagged there.
    const held = analysis.conflicts.find((c) => c.trackName === 'pedal' && c.beat === 4);
    expect(held).toBeDefined();
    expect(held?.pitch).toBe(60);
    expect(held?.safety).toBe(NoteSafety.Dissonant);
  });

  it('does not give a struck cluster note a passing label', () => {
    // A pad striking C-D-E together over the tonic chord: the D sounds with its
    // cluster, it does not travel between C and E, so it is a ninth tension.
    const tracks: ArrangementTrack[] = [
      { name: 'harmony', role: 'harmony', notes: blockChord([48, 52, 55], 0) },
      {
        name: 'pad',
        role: 'harmony',
        notes: [
          { pitch: 72, startBeat: 0, durationBeat: 4, velocity: 20 },
          { pitch: 74, startBeat: 0, durationBeat: 4, velocity: 20 },
          { pitch: 76, startBeat: 0, durationBeat: 4, velocity: 20 },
        ],
      },
    ];
    const analysis = analyzeArrangement(tracks, { key: majorKey(0) });
    expect(analysis.timeline.segments[0]?.chord.rootPc).toBe(0);
    const pad = analysis.tracks.find((t) => t.name === 'pad');
    expect(pad?.notes).toHaveLength(3);
    // Notes are reported in onset-then-pitch order, so index 1 is the D.
    const dLabels = pad?.notes[1]?.labels ?? [];
    expect(dLabels.some((l) => l.kind === 'passing')).toBe(false);
    expect(dLabels.some((l) => l.kind === 'suspension')).toBe(false);
    expect(dLabels).toContainEqual({ kind: 'tension', degree: 9 });
  });

  it('detects a dissonant cluster inside a single track', () => {
    // The pad is alone in bar two, so only its own simultaneous notes can make
    // the D dissonant: intra-track clusters must be heard.
    const tracks: ArrangementTrack[] = [
      { name: 'harmony', role: 'harmony', notes: blockChord([48, 52, 55], 0) },
      {
        name: 'pad',
        role: 'harmony',
        notes: [
          { pitch: 72, startBeat: 4, durationBeat: 4, velocity: 20 },
          { pitch: 74, startBeat: 4, durationBeat: 4, velocity: 20 },
          { pitch: 76, startBeat: 4, durationBeat: 4, velocity: 20 },
        ],
      },
    ];
    const analysis = analyzeArrangement(tracks, { key: majorKey(0) });
    const clash = analysis.conflicts.find(
      (c) => c.trackName === 'pad' && c.beat === 4 && c.pitch === 74,
    );
    expect(clash).toBeDefined();
    expect((clash?.reasons ?? 0) & ReasonFlag.VerticalDissonance).toBeTruthy();
    expect(clash?.safety).toBe(NoteSafety.Dissonant);
  });

  it.each([
    {
      name: 'parallel fifth',
      upper: [67, 69],
      lower: [60, 62],
      reason: ReasonFlag.ParallelPerfect,
    },
    {
      name: 'hidden perfect',
      upper: [67, 72],
      lower: [64, 65],
      reason: ReasonFlag.HiddenParallel,
    },
    {
      name: 'voice crossing',
      upper: [64, 59],
      lower: [60, 62],
      reason: ReasonFlag.VoiceCrossing,
    },
  ])('reports $name motion through the public arrangement analyzer', ({ upper, lower, reason }) => {
    const unit = evaluateSafety({
      profile: 'strict',
      candidatePitch: upper[1] ?? 0,
      prevPitch: upper[0],
      chord: null,
      key: majorKey(0),
      otherVoices: [{ pitch: lower[1] ?? 0, prevPitch: lower[0] }],
      strongBeat: false,
    });
    expect(unit.reasons & reason).toBeTruthy();

    const tracks: ArrangementTrack[] = [
      {
        name: 'upper',
        role: 'melody',
        notes: upper.map((pitch, startBeat) => ({ pitch, startBeat, durationBeat: 1 })),
      },
      {
        name: 'lower',
        role: 'bass',
        notes: lower.map((pitch, startBeat) => ({ pitch, startBeat, durationBeat: 1 })),
      },
    ];
    const analysis = analyzeArrangement(tracks, {
      key: majorKey(0),
      harmonicRhythm: 1,
      profile: 'strict',
    });
    const conflict = analysis.conflicts.find(
      (candidate) => candidate.trackName === 'upper' && candidate.beat === 1,
    );
    expect(conflict).toBeDefined();
    expect((conflict?.reasons ?? 0) & reason).toBeTruthy();
  });

  it('does not fabricate motion when a held note is rechecked at a chord boundary', () => {
    const tracks: ArrangementTrack[] = [
      {
        name: 'held',
        role: 'melody',
        notes: [{ pitch: 67, startBeat: 0, durationBeat: 2 }],
      },
      {
        name: 'moving',
        role: 'bass',
        notes: [
          { pitch: 60, startBeat: 0, durationBeat: 1 },
          { pitch: 62, startBeat: 1, durationBeat: 1 },
        ],
      },
    ];
    const analysis = analyzeArrangement(tracks, {
      key: majorKey(0),
      harmonicRhythm: 1,
      profile: 'strict',
    });
    const heldAtBoundary = analysis.conflicts.find(
      (candidate) => candidate.trackName === 'held' && candidate.beat === 1,
    );
    expect((heldAtBoundary?.reasons ?? 0) & ReasonFlag.ParallelPerfect).toBeFalsy();
    expect((heldAtBoundary?.reasons ?? 0) & ReasonFlag.HiddenParallel).toBeFalsy();
  });

  it('ignores zero- and negative-length notes in labels and conflicts', () => {
    const tracks = baseArrangement();
    const melody = melodyTrack();
    tracks[0] = {
      name: 'melody',
      role: 'melody',
      notes: [
        ...melody,
        { pitch: 73, startBeat: 0, durationBeat: 0 },
        { pitch: 73, startBeat: 8, durationBeat: -1 },
      ],
    };
    const analysis = analyzeArrangement(tracks, { key: majorKey(0) });
    const track = analysis.tracks.find((t) => t.name === 'melody');
    expect(track?.notes).toHaveLength(melody.length);
    expect(analysis.conflicts.find((c) => c.pitch === 73)).toBeUndefined();
  });

  it('defaults missing name and role', () => {
    const analysis = analyzeArrangement([{ notes: harmonyTrack() }], { key: majorKey(0) });
    expect(analysis.tracks[0]?.name).toBe('track 1');
    expect(analysis.tracks[0]?.role).toBe('other');
  });
});

describe('tensionCurve', () => {
  it('returns one point per sampled beat with values in [0, 1]', () => {
    const points = tensionCurve(baseArrangement(), { key: majorKey(0) });
    expect(points).toHaveLength(16);
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      expect(point?.beat).toBe(i);
      expect(point?.tension).toBeGreaterThanOrEqual(0);
      expect(point?.tension).toBeLessThanOrEqual(1);
    }
  });

  it('reads higher on the dominant bar than on the tonic bar', () => {
    const points = tensionCurve(baseArrangement(), { key: majorKey(0) });
    const tonic = points.find((p) => p.beat === 0);
    const dominant = points.find((p) => p.beat === 8);
    expect(tonic).toBeDefined();
    expect(dominant).toBeDefined();
    expect(dominant?.tension ?? 0).toBeGreaterThan(tonic?.tension ?? 0);
  });

  it('honours a custom sampling step', () => {
    const points = tensionCurve(baseArrangement(), { key: majorKey(0), step: 4 });
    expect(points.map((p) => p.beat)).toEqual([0, 4, 8, 12]);
  });
});
