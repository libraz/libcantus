import { describe, expect, it } from 'vitest';
import {
  type ArrangementTrack,
  analyzeArrangement,
  createArrangementSession,
  tensionCurve,
  tensionCurveFrom,
} from '../src/analyze/arrange/index.js';
import { analyzePolyphony as fromAnalyzeBarrel } from '../src/analyze/index.js';
import { chordTimelineFromChords, chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { humanize } from '../src/generate/groove/index.js';
import { analyzePolyphony as fromRoot } from '../src/index.js';
import { Arrangement, Meter, Score } from '../src/model/index.js';
import { evaluateSafety, NoteSafety, ReasonFlag } from '../src/theory/safety/index.js';
import { majorKey } from '../src/theory/scale/index.js';

/** Build a block chord: every pitch sounding for the same span. */
function blockChord(pitches: number[], startBeat: number, durationBeat = 4): NoteEvent[] {
  return pitches.map((pitch) => ({ pitch, startBeat, durationBeat }));
}

/** A conflict as the reading of the music it is, with the beat left out. */
function verdicts(conflicts: readonly { pitch: number; reasons: number; safety: number }[]) {
  return conflicts.map((c) => `${c.pitch}:${c.reasons}:${c.safety}`).sort();
}

describe('one tolerance for "does this note follow that one"', () => {
  /** One chord for the whole excerpt, so no note is re-read at a chord change. */
  const oneChord = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 8);

  /** A leap of a nineteenth, which no profile admits as a melodic interval. */
  function wideLeap(): ArrangementTrack[] {
    return [
      {
        name: 'lead',
        role: 'melody',
        // Away from beat 0, so the jitter cannot carry a note out of the span
        // the chord covers and change what it is read against.
        notes: [
          { pitch: 60, startBeat: 2, durationBeat: 1 },
          { pitch: 79, startBeat: 3, durationBeat: 1 },
        ],
      },
    ];
  }

  it('still hears the melodic line of a part that was played rather than quantized', () => {
    // Humanization moves an onset by a few hundredths of a beat. Compared under
    // the tolerance a beat boundary is compared under, the note before is no
    // longer adjacent, every note loses its predecessor, and the melodic checks
    // fall silent — a warning panel that empties itself the moment the part
    // sounds human, while the same notes are still labelled as a line elsewhere.
    const options = { key: 'C major', timeline: oneChord, profile: 'strict' } as const;
    const played = wideLeap().map((track) => ({
      ...track,
      notes: humanize(track.notes, { timing: 0.02, velocity: 0, accent: 0, ctx: { seed: 7 } }),
    }));
    // The fixture is only worth reading if the jitter actually moved the notes
    // off the grid they would otherwise be tested on.
    const onsets = played.flatMap((track) => track.notes.map((note) => note.startBeat));
    expect(onsets.some((beat) => !Number.isInteger(beat))).toBe(true);

    const quantized = analyzeArrangement(wideLeap(), options);
    const humanized = analyzeArrangement(played, options);
    expect(verdicts(humanized.conflicts)).toEqual(verdicts(quantized.conflicts));
    const leap = humanized.conflicts.find((c) => c.pitch === 79);
    expect((leap?.reasons ?? 0) & ReasonFlag.LargeLeap).toBeTruthy();
  });

  /** A stepwise line whose notes are held `durationBeat` beats each. */
  function legato(durationBeat: number): ArrangementTrack[] {
    return [
      {
        name: 'line',
        role: 'melody',
        notes: [60, 62, 64, 65].map((pitch, index) => ({
          pitch,
          startBeat: index,
          durationBeat,
        })),
      },
    ];
  }

  it('reads a line held past its next onset as one line, not as two sounding at once', () => {
    // A legato line overlapping itself by a hundredth of a beat is one melody.
    // Split into two sub-voices it becomes its own accompaniment, and each of
    // its steps is reported as a dissonance against the note it steps from.
    const options = { key: 'C major', timeline: oneChord } as const;
    const detached = analyzeArrangement(legato(1), options);
    const held = analyzeArrangement(legato(1.02), options);
    expect(verdicts(held.conflicts)).toEqual(verdicts(detached.conflicts));
    expect(held.conflicts.some((c) => c.reasons & ReasonFlag.VerticalDissonance)).toBe(false);
    expect(held.tracks[0]?.notes).toHaveLength(4);
  });
});

describe('sub-voice lanes when a chord thins out', () => {
  it('gives a repeated note its own pitch as its predecessor, not the lane below it', () => {
    // C3-E4-G4 thinning to E4-G4: the E4 is a literal repetition. Pairing the
    // block with the free lanes by position hands it the C3's lane instead, and
    // the leap that follows from that is one the evaluator refuses outright —
    // so the mis-assignment is reported as a fault in the music.
    const asOrdinalPairing = evaluateSafety({
      profile: 'strict',
      candidatePitch: 64,
      prevPitch: 48,
      chord: null,
      key: majorKey(0),
      otherVoices: [],
      strongBeat: false,
    });
    expect(asOrdinalPairing.reasons & ReasonFlag.LargeLeap).toBeTruthy();

    const notes: NoteEvent[] = [...blockChord([48, 64, 67], 0, 1), ...blockChord([64, 67], 1, 1)];
    const analysis = analyzeArrangement([{ name: 'piano', notes }], {
      key: 'C major',
      profile: 'strict',
      timeline: chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 2),
    });
    for (const conflict of analysis.conflicts) {
      expect(conflict.reasons & ReasonFlag.LargeLeap, `beat ${conflict.beat}`).toBeFalsy();
    }
    // What is left is the voicing change itself, if anything: no note of the
    // second chord is reported as having leapt into it.
    expect(analysis.conflicts.filter((c) => c.beat === 1 && c.pitch === 64)).toEqual([]);
  });
});

describe('the span a caller-supplied timeline is read over', () => {
  /** Eight bars of C major triad, then eight of E major. */
  function modulatingNotes(): NoteEvent[] {
    const notes: NoteEvent[] = [];
    for (let bar = 0; bar < 8; bar += 1) {
      notes.push(...blockChord([60, 64, 67], bar * 4));
    }
    for (let bar = 8; bar < 16; bar += 1) {
      notes.push(...blockChord([64, 68, 71], bar * 4));
    }
    return notes;
  }

  it('searches the key over every beat that sounds, not up to the last chord given', () => {
    // A chord chart for the opening is a partial answer about the harmony and no
    // answer about where the piece ends. Cut off there, every later note is read
    // against the opening key and clashes with it from one end to the other.
    const tracks: ArrangementTrack[] = [{ role: 'harmony', notes: modulatingNotes() }];
    const chart = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 32);
    const analysis = analyzeArrangement(tracks, { timeline: chart });
    expect(analysis.keys.length).toBeGreaterThan(1);
    expect(analysis.keys[0]?.startBeat).toBe(0);
    expect(analysis.keys[analysis.keys.length - 1]?.endBeat).toBe(64);
    const late = analysis.keys.find((region) => region.startBeat >= 32);
    expect(late?.key.scale.rootPc).toBe(4);
  });

  it('starts the region a named key holds where the music starts', () => {
    // An excerpt lifted from bar 9 holds no key over the eight bars of silence
    // before it, and the answer cannot depend on whether the caller also had the
    // chords in hand.
    const notes = [60, 64, 67, 65].flatMap((pitch, index) =>
      blockChord([pitch, pitch + 4, pitch + 7], 32 + index * 4),
    );
    const tracks: ArrangementTrack[] = [{ role: 'harmony', notes }];
    const chart = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 32 }], 48);
    const supplied = analyzeArrangement(tracks, { key: 'C major', timeline: chart });
    const inferred = analyzeArrangement(tracks, { key: 'C major' });
    expect(supplied.keys[0]?.startBeat).toBe(32);
    expect(supplied.keys[0]?.startBeat).toBe(inferred.keys[0]?.startBeat);
    expect(tensionCurve(tracks, { key: 'C major', step: 4 })[0]?.beat).toBe(32);
  });
});

describe('where the tension curve starts', () => {
  it('takes no sample before the first note sounds', () => {
    const notes: NoteEvent[] = [
      { pitch: 60, startBeat: 34, durationBeat: 4 },
      { pitch: 64, startBeat: 38, durationBeat: 4 },
    ];
    const tracks: ArrangementTrack[] = [{ notes }];
    const perBeat = tensionCurve(tracks, { key: 'C major', step: 1 });
    expect(perBeat[0]?.beat).toBeGreaterThanOrEqual(34);
    // The grid slot holding the first note begins at 32; the sample taken in it
    // is taken where the music is, and the samples after it stay on the grid.
    const perBar = tensionCurve(tracks, { key: 'C major', step: 4 });
    expect(perBar[0]?.beat).toBe(34);
    expect(perBar.slice(1).map((point) => point.beat)).toEqual([36, 40]);
    for (const point of [...perBeat, ...perBar]) {
      expect(point.beat).toBeGreaterThanOrEqual(34);
      expect(point.beat).toBeLessThan(42);
    }
  });

  it('leaves a curve whose first note falls on a slot boundary where it was', () => {
    const tracks: ArrangementTrack[] = [{ notes: blockChord([60, 64, 67], 32, 8) }];
    expect(tensionCurve(tracks, { key: 'C major', step: 4 })[0]?.beat).toBe(32);
  });
});

describe('the tracks a harmony may be read from', () => {
  const melody: NoteEvent[] = [{ pitch: 70, startBeat: 0, durationBeat: 4 }];
  const kit: NoteEvent[] = [
    { pitch: 36, startBeat: 0, durationBeat: 0.25 },
    { pitch: 42, startBeat: 1, durationBeat: 0.25 },
  ];

  function tracks(): ArrangementTrack[] {
    return [
      { name: 'lead', role: 'melody', notes: melody },
      { name: 'kit', role: 'drums', notes: kit },
    ];
  }

  it('refuses an index naming a percussion track, at every entry point', () => {
    // The pooling drops percussion, so naming it names no harmony at all: the
    // timeline comes back empty, the key defaults to C major, and every note of
    // the tracks that do state a harmony is reported as clashing with it.
    for (const run of [
      () => analyzeArrangement(tracks(), { harmonyTracks: [1] }),
      () => tensionCurve(tracks(), { harmonyTracks: [1] }),
      () => createArrangementSession(tracks(), { harmonyTracks: [1] }),
    ]) {
      expect(run).toThrow(InvalidInputError);
      expect(run).toThrow(/harmonyTracks\[0\] 1 names a percussion track/);
    }
  });

  it('honours an index naming a track that does state harmony', () => {
    const analysis = analyzeArrangement(tracks(), { harmonyTracks: [0] });
    expect(analysis.timeline.segments.length).toBeGreaterThan(0);
    expect(() => tensionCurve(tracks(), { harmonyTracks: [0] })).not.toThrow();
  });
});

describe('the role a track is given', () => {
  const kit: NoteEvent[] = [
    { pitch: 36, startBeat: 0, durationBeat: 0.25 },
    { pitch: 42, startBeat: 1, durationBeat: 0.25 },
    { pitch: 49, startBeat: 2, durationBeat: 0.25 },
  ];
  const pad = blockChord([60, 64, 67], 0);

  function withRole(role: string): ArrangementTrack[] {
    return [
      { name: 'pad', role: 'harmony', notes: pad },
      { name: 'kit', role: role as ArrangementTrack['role'], notes: kit },
    ];
  }

  it('refuses a role outside the table, at both entrances', () => {
    // `percussion` is the label a MIDI importer writes for a drum track. Read as
    // an unlabelled pitched track, its instrument-selection pitches enter the
    // key and the chords, and the role comes back as a value the role type says
    // cannot occur.
    for (const run of [
      () => analyzeArrangement(withRole('percussion')),
      () => tensionCurve(withRole('percussion')),
      () => createArrangementSession(withRole('percussion')),
      () => Arrangement.of(withRole('percussion')),
      () => new Arrangement({ tracks: withRole('percussion') }),
    ]) {
      expect(run).toThrow(InvalidInputError);
      expect(run).toThrow(/tracks\[1\]\.role must be one of/);
    }
  });

  it('reads the same music under the role that names the same thing', () => {
    const drums = analyzeArrangement(withRole('drums'));
    const alone = analyzeArrangement([{ name: 'pad', role: 'harmony', notes: pad }]);
    expect(drums.timeline.segments).toEqual(alone.timeline.segments);
    expect(verdicts(drums.conflicts)).toEqual(verdicts(alone.conflicts));
  });
});

describe('a tension curve taken over an analysis', () => {
  /** A Bb melody over a C-E-G pad: the Bb is harmony only if it is pooled in. */
  function tracks(): ArrangementTrack[] {
    return [
      { name: 'lead', role: 'melody', notes: [{ pitch: 70, startBeat: 0, durationBeat: 2 }] },
      { name: 'pad', role: 'harmony', notes: blockChord([60, 64, 67], 0, 4) },
    ];
  }

  it('reads the harmony from the tracks the caller names', () => {
    const arrangement = Arrangement.of(tracks());
    const own = arrangement.tension({ step: 1 });
    const padOnly = arrangement.tension({ step: 1, harmonyTracks: [1] });
    expect(padOnly).toHaveLength(own.length);
    expect(padOnly).not.toEqual(own);
    // The Bb is a non-chord tone against the pad alone and stops sounding at
    // beat 2, so the reading has to move over the curve.
    expect(new Set(padOnly.map((point) => point.tension)).size).toBeGreaterThan(1);
    expect(padOnly).toEqual(
      tensionCurveFrom(tracks(), arrangement.analysis, {
        step: 1,
        harmonyTracks: [1],
      }),
    );
  });

  it('reads the tension against the key the caller names', () => {
    // Harmonic tension is measured against a tonic: the same C major chord is
    // the home chord of one key and the dominant of another.
    const pad: ArrangementTrack[] = [
      { name: 'pad', role: 'harmony', notes: blockChord([60, 64, 67], 0, 4) },
    ];
    const analysis = analyzeArrangement(pad);
    const home = tensionCurveFrom(pad, analysis, { step: 1, key: 'C major' });
    const dominant = tensionCurveFrom(pad, analysis, { step: 1, key: 'F major' });
    expect(dominant).not.toEqual(home);
    expect(dominant[0]?.tension ?? 0).toBeGreaterThan(home[0]?.tension ?? 0);
  });

  it('still reuses the analysis when the caller names no harmony of their own', () => {
    const analysis = analyzeArrangement(tracks());
    expect(tensionCurveFrom(tracks(), analysis, { step: 1 })).toEqual(
      tensionCurve(tracks(), { step: 1 }),
    );
  });
});

describe('the severity floor the report is narrowed to', () => {
  const tracks: ArrangementTrack[] = [{ notes: blockChord([60, 61, 62], 0) }];

  it('refuses a value outside the scale at every entrance', () => {
    // A stale numeric constant narrows the report to nothing, which reads as a
    // clean arrangement rather than as the mistake it is.
    const bad = { minSeverity: 99 as NoteSafety };
    for (const run of [
      () => analyzeArrangement(tracks, bad),
      () => tensionCurve(tracks, bad),
      () => createArrangementSession(tracks, bad),
      () => Arrangement.of(tracks, bad),
    ]) {
      expect(run).toThrow(InvalidInputError);
      expect(run).toThrow(/arrangement minSeverity must be an integer in \[0, 2\]/);
    }
  });

  it('takes every value the scale has', () => {
    for (const minSeverity of [NoteSafety.Safe, NoteSafety.Warning, NoteSafety.Dissonant]) {
      expect(() => analyzeArrangement(tracks, { minSeverity })).not.toThrow();
      expect(() => tensionCurve(tracks, { minSeverity })).not.toThrow();
    }
  });
});

describe('an arrangement holding a meter it was handed as a class', () => {
  const tracks: ArrangementTrack[] = [{ notes: blockChord([60, 64, 67], 0, 3) }];

  it('stores the signature the meter stands for', () => {
    // A `Meter` keeps its signature behind a method, so copying it as it arrived
    // stores an empty record: the arrangement builds, serializes to `{"ts":{}}`,
    // and fails on the first reading that asks what meter it is in.
    const arrangement = Arrangement.of(tracks, { ts: Meter.parse('6/8') });
    expect(arrangement.data.settings?.ts).toEqual(Meter.parse('6/8').toJSON());
    const reopened = Arrangement.fromJSON(JSON.parse(JSON.stringify(arrangement)));
    expect(reopened.equals(arrangement)).toBe(true);
    expect(reopened.analysis.timeline.segments.length).toBeGreaterThan(0);
  });
});

describe('reading polyphony through the function the class is a skin over', () => {
  const notes: NoteEvent[] = [...blockChord([60, 64, 67], 0, 2), ...blockChord([59, 62, 67], 2, 2)];

  it('is reachable from the analyze subpath and from the package root', () => {
    expect(fromAnalyzeBarrel).toBe(fromRoot);
    const score = Score.of(notes, { key: 'C major' });
    const timeline = chordTimelineFromNotes(notes, { key: 'C major' }).timeline;
    expect(fromAnalyzeBarrel(notes, timeline.at, 'C major')).toEqual(score.voices());
  });
});
