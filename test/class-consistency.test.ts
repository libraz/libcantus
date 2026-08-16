import { describe, expect, it } from 'vitest';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { BASS_4_STRING, playability } from '../src/core/index.js';
import { toInstrumentProfile, toStringedProfile } from '../src/core/instrument/index.js';
import { DRUM_KIT } from '../src/generate/index.js';
import {
  Chord,
  Composer,
  Instrument,
  Key,
  Motif,
  Progression,
  Score,
  Timeline,
} from '../src/model/index.js';

/**
 * Places where one class contradicted another, or itself: an instance refused
 * where its own data was taken, two sibling methods disagreeing about how
 * harmony is handed over, a class with no `of` where every sibling has one, and
 * an analysis result the class dropped on the way out. Each case is checked
 * both ways — the instance form and the data form must agree — so a widening
 * that quietly stopped accepting the older form would be caught here too.
 */

/** Notes that spell one chord, so a reading of them is unambiguous. */
const TRIAD = [
  { pitch: 60, startBeat: 0, durationBeat: 4 },
  { pitch: 64, startBeat: 0, durationBeat: 4 },
  { pitch: 67, startBeat: 0, durationBeat: 4 },
];

/** Notes that change chord halfway, so a timeline of them holds two segments. */
const TWO_CHORDS = [
  ...TRIAD,
  { pitch: 67, startBeat: 4, durationBeat: 4 },
  { pitch: 71, startBeat: 4, durationBeat: 4 },
  { pitch: 74, startBeat: 4, durationBeat: 4 },
];

describe('an instrument is accepted wherever its profile is', () => {
  it('reads the same profile out of the class and out of the plain data', () => {
    expect(toInstrumentProfile(Instrument.bass4())).toEqual(BASS_4_STRING);
    expect(toInstrumentProfile(BASS_4_STRING)).toEqual(BASS_4_STRING);
  });

  it('rejects a value that names no instrument', () => {
    expect(() => toInstrumentProfile({ name: 'nothing' } as never)).toThrow(InvalidInputError);
    expect(() => toInstrumentProfile(null as never)).toThrow(InvalidInputError);
    expect(() => toInstrumentProfile('bass' as never)).toThrow(InvalidInputError);
  });

  it('names the instrument the caller called it in the error', () => {
    expect(() => toInstrumentProfile({} as never, 'lead instrument')).toThrow(/lead instrument/);
  });

  it('Score#playability answers the same for the instrument and for its data', () => {
    const score = Score.of([{ pitch: 27, startBeat: 0, durationBeat: 1 }]);
    const instrument = Instrument.bass4();
    expect(score.playability(instrument)).toEqual(score.playability(instrument.data));
    expect(score.playability(instrument)).toEqual(score.playability(BASS_4_STRING));
    expect(score.playability(instrument).issues[0]?.type).toBe('noteOutOfRange');
  });

  it('Score#playability reads the score tempo, as the function does', () => {
    const score = Score.of(TRIAD, { tempo: 90 });
    expect(score.playability(Instrument.guitar())).toEqual(
      playability(score.notes, Instrument.guitar().data, 90),
    );
  });

  it('Instrument.of takes an instrument and gives back an equal one', () => {
    const bass = Instrument.bass4();
    expect(Instrument.of(bass).equals(bass)).toBe(true);
    expect(Instrument.of(bass).data).toEqual(bass.data);
  });

  it('a composer takes the instrument each part is written for as either form', () => {
    const fromClass = Composer.of({ seed: 1, instruments: { bass: Instrument.bass4() } });
    const fromData = Composer.of({ seed: 1, instruments: { bass: BASS_4_STRING } });
    expect(fromClass.equals(fromData)).toBe(true);
    expect(fromClass.data.instruments?.bass).toEqual(BASS_4_STRING);
    expect(fromClass.context.instruments?.bass).toEqual(BASS_4_STRING);
  });

  it('Composer#bass takes the instrument as either form', () => {
    const composer = Composer.of({ key: 'C major', seed: 3 });
    const plan = composer.progression({ style: 'dance', bars: 2 });
    const fromClass = composer.bass(plan, { style: 'pop', instrument: Instrument.bass4() });
    const fromData = composer.bass(plan, { style: 'pop', instrument: BASS_4_STRING });
    expect(fromClass.notes.length).toBeGreaterThan(0);
    expect(fromClass.equals(fromData)).toBe(true);
  });

  it('Composer#bass refuses an instrument with no strings to place the line on', () => {
    const composer = Composer.of({ key: 'C major', seed: 3 });
    const plan = composer.progression({ style: 'dance', bars: 2 });
    expect(() => composer.bass(plan, { instrument: Instrument.of(DRUM_KIT) })).toThrow(
      InvalidInputError,
    );
    expect(() => composer.bass(plan, { instrument: DRUM_KIT as never })).toThrow(/no strings/);
  });

  it('narrows to the stringed family, from either form', () => {
    expect(toStringedProfile(Instrument.bass4())).toEqual(BASS_4_STRING);
    expect(toStringedProfile(BASS_4_STRING).tuning).toEqual(BASS_4_STRING.tuning);
    expect(() => toStringedProfile(DRUM_KIT)).toThrow(InvalidInputError);
  });
});

describe('the two Composer parts take harmony the same way', () => {
  const composer = Composer.of({ key: 'C major', seed: 11 });
  const plan = composer.progression({ style: 'dance', bars: 2 });
  const melody = Score.of([
    { pitch: 72, startBeat: 0, durationBeat: 2 },
    { pitch: 74, startBeat: 2, durationBeat: 2 },
    { pitch: 76, startBeat: 4, durationBeat: 2 },
    { pitch: 72, startBeat: 6, durationBeat: 2 },
  ]);

  it('counterMelody writes the same line for the timeline and for its plain form', () => {
    const fromClass = composer.counterMelody(melody, { timeline: plan });
    const fromData = composer.counterMelody(melody, { timeline: plan.chordTimeline });
    expect(fromClass.equals(fromData)).toBe(true);
  });

  it('counterMelody hears the harmony it is given', () => {
    const withHarmony = composer.counterMelody(melody, { timeline: plan });
    expect(withHarmony.notes.length).toBeGreaterThan(0);
    // The class form reaches the generator, rather than being dropped on the
    // way and leaving the line written against no harmony at all.
    expect(() => composer.counterMelody(melody)).toThrow(InvalidInputError);
  });

  it('bass follows the same timeline in either form', () => {
    const fromClass = composer.bass(plan);
    const fromSegments = composer.bass(plan.segments);
    expect(fromClass.equals(fromSegments)).toBe(true);
  });
});

describe('Progression.of matches the constructor', () => {
  const chords = [Chord.parse('C'), Chord.parse('G7')];
  const key = Key.major('C');

  it('builds what the constructor builds, key and all', () => {
    expect(Progression.of(chords, key).equals(new Progression(chords, key))).toBe(true);
    expect(Progression.of(chords, key).data).toEqual(new Progression(chords, key).data);
    expect(Progression.of(chords, key).key?.toString()).toBe('C major');
  });

  it('builds what the constructor builds without a key', () => {
    expect(Progression.of(chords).data).toEqual(new Progression(chords).data);
    expect(Progression.of(chords).key).toBeUndefined();
  });

  it('attaches the key to the members the way the constructor does', () => {
    expect(Progression.of(chords, key).roman()).toEqual(new Progression(chords, key).roman());
    expect(Progression.of(chords, key).roman()).toEqual(['I', 'V7']);
  });

  it('reads like the of factory on the sibling classes that have one', () => {
    // Timeline is left out on purpose: it is built from chords, from notes, or
    // from a progression, and a bare `of` would not say which.
    for (const cls of [Chord, Composer, Instrument, Key, Progression, Score]) {
      expect(typeof (cls as { of?: unknown }).of, cls.name).toBe('function');
    }
  });
});

describe('a timeline carries how sure the analysis is of each segment', () => {
  it('hands out exactly what the function reported, in segment order', () => {
    const result = chordTimelineFromNotes(TWO_CHORDS);
    const timeline = Timeline.fromNotes(TWO_CHORDS);
    expect(timeline.segmentConfidence).toEqual(result.segmentConfidence);
    expect(timeline.segmentConfidence).toHaveLength(timeline.length);
  });

  it('reports the same readings through a score', () => {
    const score = Score.of(TWO_CHORDS);
    expect(score.timeline().segmentConfidence).toEqual(
      chordTimelineFromNotes(TWO_CHORDS, { meters: score.meters }).segmentConfidence,
    );
  });

  it('holds every value in [0, 1]', () => {
    for (const confidence of Timeline.fromNotes(TWO_CHORDS).segmentConfidence) {
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it('hands out a copy rather than its own list', () => {
    const timeline = Timeline.fromNotes(TWO_CHORDS);
    expect(timeline.segmentConfidence).not.toBe(timeline.segmentConfidence);
    expect(timeline.segmentConfidence).toEqual(timeline.segmentConfidence);
  });

  it('survives a round trip through the plain data', () => {
    const timeline = Timeline.fromNotes(TWO_CHORDS);
    expect(Timeline.fromData(timeline.data).segmentConfidence).toEqual(timeline.segmentConfidence);
    expect(Timeline.fromJSON(JSON.parse(JSON.stringify(timeline))).segmentConfidence).toEqual(
      timeline.segmentConfidence,
    );
  });

  it('reports nothing for chords that were placed rather than read', () => {
    const placed = Timeline.fromProgression(
      new Progression([Chord.parse('C'), Chord.parse('G7')], Key.major('C')),
      4,
    );
    expect(placed.segmentConfidence).toEqual([]);
    expect('segmentConfidence' in placed.data).toBe(false);
  });

  it('keeps each reading with the segment it describes through a slice', () => {
    const timeline = Timeline.fromNotes(TWO_CHORDS);
    expect(timeline.length).toBeGreaterThan(1);
    const tail = timeline.slice(4, timeline.totalBeats);
    expect(tail.segmentConfidence).toHaveLength(tail.length);
    expect(tail.segmentConfidence).toEqual(timeline.segmentConfidence.slice(-tail.length));
  });

  it('carries the readings through a transposition, which re-reads nothing', () => {
    const timeline = Timeline.fromNotes(TWO_CHORDS);
    expect(timeline.transpose(2).segmentConfidence).toEqual(timeline.segmentConfidence);
    expect(timeline.transposeBy('M2').segmentConfidence).toEqual(timeline.segmentConfidence);
  });

  it('refuses a list that does not run one value per segment', () => {
    const timeline = Timeline.fromNotes(TWO_CHORDS);
    expect(() => Timeline.fromData({ ...timeline.data, segmentConfidence: [1] })).toThrow(
      InvalidInputError,
    );
    expect(() =>
      Timeline.fromData({
        ...timeline.data,
        segmentConfidence: timeline.data.segments.map(() => 2),
      }),
    ).toThrow(RangeError);
  });
});

describe('Score#motifs hands back the analysis record it was asked for', () => {
  const REPEATED = [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 62, startBeat: 1, durationBeat: 1 },
    { pitch: 64, startBeat: 2, durationBeat: 1 },
    { pitch: 60, startBeat: 3, durationBeat: 1 },
    { pitch: 62, startBeat: 4, durationBeat: 1 },
    { pitch: 64, startBeat: 5, durationBeat: 1 },
  ];

  it('carries the findings a bare cell of notes could not', () => {
    const found = Score.of(REPEATED).motifs()[0];
    expect(found).toBeDefined();
    expect(found?.occurrences.length).toBeGreaterThan(1);
    expect(found?.intervals).toEqual([2, 2]);
    expect(found?.rationale.length).toBeGreaterThan(0);
  });

  it('is a cell already, so the class is one call away and nothing is rebuilt', () => {
    const found = Score.of(REPEATED).motifs()[0];
    const motif = Motif.fromData(found as never);
    expect(motif.notes).toEqual(
      found?.notes.map((note) => ({
        pitch: note.pitch,
        startBeat: note.startBeat,
        durationBeat: note.durationBeat,
      })),
    );
    expect(motif.relateTo(motif.transform('invert'))).not.toBeUndefined();
  });
});
