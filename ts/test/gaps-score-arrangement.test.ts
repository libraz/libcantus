import { describe, expect, it } from 'vitest';
import {
  Arrangement,
  analyzeArrangement,
  chordTimelineFromNotes,
  detectKeyFromNotes,
  extractGrooveTemplate,
  Instrument,
  InvalidInputError,
  type NoteEvent,
  NoteSafety,
  parseNote,
  phrasesFromTimeline,
  Score,
  structuralCadences,
  toSoundingPitch,
  toVoiceNotes,
} from '../src/index.js';

/**
 * The timed and physical classes answer everything their functional
 * counterparts answer. Each case here holds a method against the function it
 * delegates to on the same input, passes an option through it, and names the
 * input it refuses, so a method that quietly stops delegating — or stops
 * offering an option — is caught rather than merely being present.
 */

/** A phrase of tonic, dominant, tonic, long enough to close on a cadence. */
const CADENTIAL: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 2, velocity: 96 },
  { pitch: 64, startBeat: 2, durationBeat: 2, velocity: 80 },
  { pitch: 67, startBeat: 4, durationBeat: 2, velocity: 88 },
  { pitch: 71, startBeat: 6, durationBeat: 2, velocity: 72 },
  { pitch: 62, startBeat: 8, durationBeat: 4, velocity: 90 },
  { pitch: 60, startBeat: 12, durationBeat: 4, velocity: 100 },
];

/** A take played off the grid, so a groove reading has deviations to record. */
const PLAYED: NoteEvent[] = [
  { pitch: 36, startBeat: 0.02, durationBeat: 1, velocity: 104 },
  { pitch: 42, startBeat: 0.53, durationBeat: 0.5, velocity: 68 },
  { pitch: 38, startBeat: 1.06, durationBeat: 1, velocity: 92 },
  { pitch: 42, startBeat: 1.48, durationBeat: 0.5, velocity: 64 },
];

/** The two tracks the arrangement cases are read over. */
const TRACKS = [
  {
    name: 'lead',
    role: 'melody' as const,
    notes: [
      { pitch: 72, startBeat: 0, durationBeat: 2 },
      { pitch: 76, startBeat: 2, durationBeat: 2 },
      { pitch: 79, startBeat: 4, durationBeat: 4 },
    ],
  },
  {
    name: 'bass',
    role: 'bass' as const,
    notes: [
      { pitch: 36, startBeat: 0, durationBeat: 4 },
      { pitch: 43, startBeat: 4, durationBeat: 4 },
    ],
  },
];

/**
 * An analysis with its chord lookup replaced by the segments behind it.
 *
 * The timeline carries a function, and two readings of the same notes build
 * two closures over the same data; comparing the segments compares what the
 * lookup would answer without comparing identities that can never match.
 */
function comparable(analysis: ReturnType<typeof analyzeArrangement>): unknown {
  return { ...analysis, timeline: analysis.timeline.segments };
}

describe('Arrangement.analyze', () => {
  it('answers what analyzeArrangement answers over the same tracks', () => {
    const arrangement = Arrangement.of(TRACKS);
    expect(comparable(arrangement.analyze())).toEqual(comparable(analyzeArrangement([...TRACKS])));
  });

  it('lays the caller options over the arrangement own settings', () => {
    const arrangement = Arrangement.of(TRACKS, { key: 'C major' });
    // The narrower severity is the caller's, while the key stays the one the
    // arrangement was built with.
    const narrowed = arrangement.analyze({ minSeverity: NoteSafety.Dissonant });
    expect(narrowed.prevailingKey).toEqual(arrangement.analyze().prevailingKey);
    expect(narrowed.conflicts.length).toBeLessThan(arrangement.analyze().conflicts.length);
    // Every option reaches the function, so restricting the harmony to one
    // track answers what the function answers when it is restricted the same way.
    const bare = Arrangement.of(TRACKS);
    expect(comparable(bare.analyze({ harmonyTracks: [0] }))).toEqual(
      comparable(analyzeArrangement([...TRACKS], { harmonyTracks: [0] })),
    );
    expect(comparable(bare.analyze({ harmonicRhythm: 2 }))).toEqual(
      comparable(analyzeArrangement([...TRACKS], { harmonicRhythm: 2 })),
    );
    expect(comparable(bare.analyze({ profile: 'strict' }))).toEqual(
      comparable(analyzeArrangement([...TRACKS], { profile: 'strict' })),
    );
    expect(bare.analyze({ profile: 'strict' }).conflicts).not.toEqual(bare.analyze().conflicts);
  });

  it('reads a meter named by the caller instead of the arrangement own', () => {
    const arrangement = Arrangement.of(TRACKS, { meters: '4/4' });
    expect(() => arrangement.analyze({ meters: '3/4' })).not.toThrow();
    expect(arrangement.analyze({ ts: { numerator: 3, denominator: 4 } }).timeline.segments).toEqual(
      analyzeArrangement([...TRACKS], { ts: { numerator: 3, denominator: 4 } }).timeline.segments,
    );
  });

  it('refuses an option that names no track of the arrangement', () => {
    expect(() => Arrangement.of(TRACKS).analyze({ harmonyTracks: [7] })).toThrow(RangeError);
  });
});

describe('Score.detectKeys', () => {
  it('answers what detectKeyFromNotes answers over the same notes', () => {
    const score = Score.of(CADENTIAL);
    // The class member hands back the class's own Key, and the plain match the
    // function reports is what is left once the key is read as data.
    expect(score.detectKeys().map((match) => ({ ...match, key: match.key.scale }))).toEqual(
      detectKeyFromNotes(score.notes),
    );
    expect(score.detectKeys()[0]?.key.toString()).toBe(`${score.detectKeys()[0]?.key.tonic} major`);
  });

  it('weights by duration times velocity rather than counting pitches', () => {
    // A long quiet tonic against a flurry of loud ornaments: the ranking has to
    // follow the weight, which is what makes the score the right receiver.
    const score = Score.of([
      { pitch: 60, startBeat: 0, durationBeat: 16, velocity: 100 },
      { pitch: 64, startBeat: 0, durationBeat: 16, velocity: 100 },
      { pitch: 67, startBeat: 0, durationBeat: 16, velocity: 100 },
      { pitch: 61, startBeat: 0, durationBeat: 0.125, velocity: 40 },
      { pitch: 66, startBeat: 0.125, durationBeat: 0.125, velocity: 40 },
    ]);
    expect(score.detectKeys()[0]?.key.rootPc).toBe(0);
  });

  it('passes the ranking options through', () => {
    const score = Score.of(CADENTIAL);
    expect(score.detectKeys()[0]?.rationale).toBeUndefined();
    expect(score.detectKeys({ explain: true })[0]?.rationale).toBeTypeOf('string');
    expect(
      score.detectKeys({ explain: true }).map((match) => ({ ...match, key: match.key.scale })),
    ).toEqual(detectKeyFromNotes(score.notes, { explain: true }));
    expect(score.detectKeys({ modes: true }).length).toBeGreaterThan(score.detectKeys().length);
    expect(
      score.detectKeys({ profile: 'flat' }).map((match) => ({ ...match, key: match.key.scale })),
    ).toEqual(detectKeyFromNotes(score.notes, { profile: 'flat' }));
  });

  it('refuses a profile that names no ranking', () => {
    expect(() =>
      // @ts-expect-error the profile names no ranking the detector holds.
      Score.of(CADENTIAL).detectKeys({ profile: 'nonesuch' }),
    ).toThrow(InvalidInputError);
  });
});

describe('Score.structuralCadences', () => {
  it('ranks the cadences of the phrases the functional path finds', () => {
    const score = Score.of(CADENTIAL);
    const { timeline } = chordTimelineFromNotes(score.notes, { meters: score.meters });
    const phrases = phrasesFromTimeline(timeline, score.notes, { meters: score.meters });
    expect(score.structuralCadences()).toEqual(structuralCadences(phrases));
    expect(score.structuralCadences()).toEqual(structuralCadences(score.phrases()));
  });

  it('is ordered by structural weight, heaviest first', () => {
    const weights = Score.of(CADENTIAL)
      .structuralCadences()
      .map((hit) => hit.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });

  it('passes the phrasing options through', () => {
    const score = Score.of(CADENTIAL);
    const opts = { expectedPhraseBeats: 4 };
    expect(score.structuralCadences(opts)).toEqual(structuralCadences(score.phrases(opts)));
    // The phrasing the ranking reads is the caller's, not the default one.
    expect(score.phrases(opts).length).not.toBe(score.phrases().length);
  });

  it('refuses a span that ends before the music does', () => {
    expect(() => Score.of(CADENTIAL).structuralCadences({ totalBeats: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe('Score.voiceNotes', () => {
  it('answers what toVoiceNotes answers over the same notes', () => {
    const score = Score.of(CADENTIAL);
    expect(score.voiceNotes()).toEqual(toVoiceNotes(score.notes));
  });

  it('ids the notes in the score own time order', () => {
    // The score holds its notes in time order whatever order they arrived in,
    // so the id a voice note carries points at the note the analysis names.
    const score = Score.of([...CADENTIAL].reverse());
    expect(score.voiceNotes().map((note) => note.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(score.voiceNotes().map((note) => note.startBeat)).toEqual([0, 2, 4, 6, 8, 12]);
    expect(score.voiceNotes()).not.toBe(score.voiceNotes());
  });

  it('has nothing left to refuse, because the score refused it first', () => {
    // The method takes no argument, so its only rejection path is the boundary
    // the notes crossed to become a score at all.
    expect(() => Score.of([{ pitch: Number.NaN, startBeat: 0, durationBeat: 1 }])).toThrow(
      RangeError,
    );
  });
});

describe('Score.grooveTemplate', () => {
  it('answers what extractGrooveTemplate answers under the score meter', () => {
    const score = Score.of(PLAYED);
    expect(score.grooveTemplate()).toEqual(extractGrooveTemplate(score.notes, score.meterAt(0)));
  });

  it('reads the grid against the score own signature', () => {
    const score = Score.of(PLAYED, { meters: '6/8' });
    expect(score.grooveTemplate().ts).toEqual(score.meterAt(0));
    expect(score.grooveTemplate()).toEqual(extractGrooveTemplate(score.notes, score.meterAt(0)));
    // The template a score extracts is one its own notes can be placed on.
    expect(() => score.groove(score.grooveTemplate())).not.toThrow();
  });

  it('passes the subdivision through', () => {
    const score = Score.of(PLAYED);
    expect(score.grooveTemplate(8).subdivision).toBe(8);
    expect(score.grooveTemplate(8).slotsPerBar).toBe(32);
    expect(score.grooveTemplate(8)).toEqual(
      extractGrooveTemplate(score.notes, score.meterAt(0), 8),
    );
    expect(score.grooveTemplate(8).slots).not.toEqual(score.grooveTemplate().slots);
  });

  it('refuses a subdivision that is no grid', () => {
    expect(() => Score.of(PLAYED).grooveTemplate(0)).toThrow(RangeError);
    expect(() => Score.of(PLAYED).grooveTemplate(1.5)).toThrow(RangeError);
  });
});

describe('Instrument.soundingPitch', () => {
  it('answers what toSoundingPitch answers for the instrument own name', () => {
    const guitar = Instrument.guitar();
    expect(guitar.soundingPitch('C4').data).toEqual(toSoundingPitch(parseNote('C4'), 'guitar'));
    expect(guitar.soundingPitch('C4').name).toBe('C3');
  });

  it('takes a note in every form the class API takes one', () => {
    const guitar = Instrument.guitar();
    const written = guitar.soundingPitch('E4');
    expect(guitar.soundingPitch(64).equals(written)).toBe(true);
    expect(guitar.soundingPitch({ letter: 2, alter: 0, octave: 4 }).equals(written)).toBe(true);
    // A `Note` goes in as readily as its name, and the answer is another one.
    expect(guitar.soundingPitch(written).name).toBe('E2');
  });

  it('passes a named transposition through instead of the instrument name', () => {
    const bass = Instrument.bass4();
    expect(bass.soundingPitch('C4', '-P8').data).toEqual(toSoundingPitch(parseNote('C4'), '-P8'));
    expect(bass.soundingPitch('C4', '-P8').name).toBe('C3');
    // The interval decides the letter, so the spelling of the part survives.
    expect(bass.soundingPitch('D#4', 'clarinetA').name).toBe('B#3');
  });

  it('refuses an instrument the transposition table does not carry', () => {
    expect(() => Instrument.bass4().soundingPitch('C4')).toThrow(InvalidInputError);
    expect(() => Instrument.guitar().soundingPitch('C4', 'nonesuch')).toThrow(InvalidInputError);
  });
});
