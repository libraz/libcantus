import { describe, expect, it } from 'vitest';
import {
  hypermeter,
  phrasesFromTimeline,
  sectionsFromNotes,
  structuralCadences,
} from '../src/analyze/form/index.js';
import { choosePhrasePath, PHRASE_CUT_COST } from '../src/analyze/form/phrase.js';
import { chordTimelineFromChords, chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import type { MeterMap } from '../src/core/meter/index.js';
import { barIndexAt, parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Score } from '../src/model/score.js';
import type { ChordQuality, ChordSpan } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

/** One chord placed at a beat, spelled the way `chordTimelineFromChords` reads it. */
function span(rootPc: number, quality: ChordQuality, startBeat: number): ChordSpan {
  return { rootPc, quality, startBeat };
}

/** A run of quarter notes starting at a beat. */
function quarters(pitches: number[], startBeat: number): NoteEvent[] {
  return pitches.map((pitch, i) => ({ pitch, startBeat: startBeat + i, durationBeat: 1 }));
}

/** A block chord: every pitch sounding for the same span. */
function blockChord(pitches: number[], startBeat: number, durationBeat: number): NoteEvent[] {
  return pitches.map((pitch) => ({ pitch, startBeat, durationBeat }));
}

/**
 * Four bars of I - ii - V - I in C, one chord per bar, starting at `bar`.
 * The dominant makes an authentic cadence onto the closing tonic.
 */
function cadentialUnit(bar: number): ChordSpan[] {
  const at = bar * 4;
  return [
    span(0, 'maj', at),
    span(2, 'min', at + 4),
    span(7, 'maj', at + 8),
    span(0, 'maj', at + 12),
  ];
}

/** A four-bar melodic figure ending in a whole note, starting at `bar`. */
function melodicUnit(bar: number): NoteEvent[] {
  const at = bar * 4;
  return [
    ...quarters([60, 62, 64, 65], at),
    ...quarters([67, 65, 64, 62], at + 4),
    ...quarters([60, 64, 67, 65], at + 8),
    { pitch: 64, startBeat: at + 12, durationBeat: 4 },
  ];
}

describe('phrasesFromTimeline', () => {
  const chords = [0, 1, 2, 3].flatMap((unit) => cadentialUnit(unit * 4));
  const melody = [0, 1, 2, 3].flatMap((unit) => melodicUnit(unit * 4));
  const timeline = chordTimelineFromChords(chords, 64);

  it('splits a sixteen-bar tune into its four four-bar phrases', () => {
    const phrases = phrasesFromTimeline(timeline, melody, { key: majorKey(0) });
    expect(phrases.map((phrase) => phrase.startBeat)).toEqual([0, 16, 32, 48]);
    expect(phrases.map((phrase) => phrase.endBeat)).toEqual([16, 32, 48, 64]);
  });

  it('names the cadence closing each phrase', () => {
    const phrases = phrasesFromTimeline(timeline, melody, { key: majorKey(0) });
    expect(phrases.map((phrase) => phrase.cadence?.cadence.type)).toEqual([
      'authentic',
      'authentic',
      'authentic',
      'authentic',
    ]);
    expect(phrases.map((phrase) => phrase.cadence?.atBeat)).toEqual([12, 28, 44, 60]);
  });

  it('reports the evidence and a confidence rather than certainty', () => {
    const phrases = phrasesFromTimeline(timeline, melody, { key: majorKey(0) });
    for (const phrase of phrases) {
      expect(phrase.signals).toContain('cadence');
      expect(phrase.confidence).toBeGreaterThan(0.5);
      expect(phrase.confidence).toBeLessThanOrEqual(1);
      expect(phrase.rationale).toMatch(/cadence/);
    }
  });

  it('covers the whole span with contiguous phrases', () => {
    const phrases = phrasesFromTimeline(timeline, melody, { key: majorKey(0) });
    expect(phrases[0]?.startBeat).toBe(0);
    expect(phrases[phrases.length - 1]?.endBeat).toBe(64);
    for (let i = 1; i < phrases.length; i += 1) {
      expect(phrases[i]?.startBeat).toBe(phrases[i - 1]?.endBeat);
    }
  });

  it('reads a span too short to divide as one phrase', () => {
    const short = chordTimelineFromChords([span(7, 'maj', 0), span(0, 'maj', 2)], 4);
    const phrases = phrasesFromTimeline(short, quarters([67, 65, 64, 60], 0), {
      key: majorKey(0),
      minPhraseBeats: 8,
    });
    expect(phrases).toHaveLength(1);
    expect(phrases[0]?.startBeat).toBe(0);
    expect(phrases[0]?.endBeat).toBe(4);
  });
});

describe('structuralCadences', () => {
  // An eight-bar period: the antecedent turns to the dominant and stops there,
  // the consequent restarts on the subdominant and closes on the tonic.
  const chords = [
    span(0, 'maj', 0),
    span(5, 'maj', 4),
    span(2, 'min', 8),
    span(7, 'maj', 12),
    span(5, 'maj', 16),
    span(2, 'min', 20),
    span(7, 'maj', 24),
    span(0, 'maj', 28),
  ];
  const melody = [
    ...quarters([60, 62, 64, 65], 0),
    ...quarters([67, 65, 64, 62], 4),
    ...quarters([64, 65, 67, 69], 8),
    { pitch: 71, startBeat: 12, durationBeat: 4 },
    ...quarters([69, 67, 65, 64], 16),
    ...quarters([62, 64, 65, 67], 20),
    ...quarters([65, 64, 62, 59], 24),
    { pitch: 60, startBeat: 28, durationBeat: 4 },
  ];
  const timeline = chordTimelineFromChords(chords, 32);
  const phrases = phrasesFromTimeline(timeline, melody, { key: majorKey(0) });

  it('finds the antecedent and the consequent', () => {
    expect(phrases.map((phrase) => phrase.startBeat)).toEqual([0, 16]);
    expect(phrases.map((phrase) => phrase.endBeat)).toEqual([16, 32]);
  });

  it('closes the antecedent on a half cadence and the consequent on an authentic one', () => {
    expect(phrases[0]?.cadence?.cadence.type).toBe('half');
    expect(phrases[1]?.cadence?.cadence.type).toBe('authentic');
  });

  it('ranks the authentic close above the half close', () => {
    const ranked = structuralCadences(phrases);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.cadence.type).toBe('authentic');
    expect(ranked[1]?.cadence.type).toBe('half');
    expect(ranked[0]?.weight).toBeGreaterThan(ranked[1]?.weight ?? 1);
    expect(ranked[0]?.phraseIndex).toBe(1);
  });

  it('gives the last phrase the hypermetric bonus only where it lands on a hyperbar', () => {
    // Two readings of the same eight bars, differing only in whether beat 32 is
    // a hyperbar head. Ending the piece and closing a hyperbar are two separate
    // things a cadence can do, so the phrase that only ends the piece must be
    // graded below the one that does both.
    const grouping = {
      groupBars: 4,
      downbeats: [0, 16],
      confidence: 1,
      rationale: 'four-bar groups',
    };
    const off = phrasesFromTimeline(timeline, melody, {
      key: majorKey(0),
      hypermeter: grouping,
    });
    const on = phrasesFromTimeline(timeline, melody, {
      key: majorKey(0),
      hypermeter: { ...grouping, downbeats: [0, 16, 32] },
    });
    const offLast = off[off.length - 1];
    const onLast = on[on.length - 1];
    expect(offLast?.endBeat).toBe(32);
    expect(onLast?.endBeat).toBe(32);
    expect(offLast?.structuralWeight ?? 1).toBeLessThan(onLast?.structuralWeight ?? 0);
    // The unaligned close is graded, not saturated, so an aligned cadence
    // elsewhere can still outrank it.
    expect(offLast?.structuralWeight ?? 1).toBeLessThan(1);
  });

  it('leaves out phrases no cadence closes', () => {
    const noCadence = chordTimelineFromChords([span(0, 'maj', 0), span(2, 'min', 8)], 16);
    const plain = phrasesFromTimeline(noCadence, quarters([60, 62, 64, 65], 0), {
      key: majorKey(0),
    });
    expect(structuralCadences(plain)).toEqual([]);
  });
});

describe('a cadence whose chord is held across the phrase seam', () => {
  // The tonic the cadence arrives on is still sounding when the next phrase
  // starts, which is how a period is normally written and how
  // `chordTimelineFromNotes` reads it: the held tonic is one segment running
  // from the arrival at beat 12 to the end of the piece.
  const harmony: NoteEvent[] = [
    ...blockChord([48, 60, 64, 67], 0, 4), // C
    ...blockChord([53, 57, 60, 65], 4, 4), // F
    ...blockChord([55, 59, 62, 67], 8, 4), // G
    ...blockChord([48, 60, 64, 67], 12, 20), // the tonic, held to the end
  ];
  const melody: NoteEvent[] = [
    ...quarters([72, 74, 76, 77], 0),
    ...quarters([79, 77, 76, 74], 4),
    ...quarters([72, 74, 76, 79], 8),
    { pitch: 72, startBeat: 12, durationBeat: 4 },
    ...quarters([72, 76, 79, 76], 16),
    ...quarters([72, 76, 79, 76], 20),
    ...quarters([72, 76, 79, 76], 24),
    { pitch: 72, startBeat: 28, durationBeat: 4 },
  ];
  const { timeline } = chordTimelineFromNotes([...harmony, ...melody], { key: majorKey(0) });
  const phrases = phrasesFromTimeline(timeline, melody, { key: majorKey(0) });

  it('names the cadence on the phrase it closes', () => {
    const closing = phrases.find((phrase) => phrase.startBeat <= 12 && phrase.endBeat > 12);
    expect(closing?.cadence?.cadence.type).toBe('authentic');
    expect(closing?.cadence?.atBeat).toBe(12);
  });

  it('reports no cadence for a phrase the held chord merely runs through', () => {
    for (const phrase of phrases) {
      const atBeat = phrase.cadence?.atBeat;
      if (atBeat === undefined) {
        continue;
      }
      expect(atBeat).toBeGreaterThanOrEqual(phrase.startBeat);
      expect(atBeat).toBeLessThan(phrase.endBeat);
    }
  });

  it('ranks the cadence against the phrase it actually closes', () => {
    const ranked = structuralCadences(phrases);
    const authentic = ranked.find((entry) => entry.atBeat === 12);
    expect(authentic?.cadence.type).toBe('authentic');
    const closing = phrases[authentic?.phraseIndex ?? -1];
    expect(closing?.startBeat).toBeLessThanOrEqual(12);
    expect(closing?.endBeat).toBeGreaterThan(12);
  });
});

describe('hypermeter', () => {
  it('finds four-bar groups when the harmony turns every four bars', () => {
    const notes = [
      ...blockChord([48, 60, 64, 67], 0, 16), // C
      ...blockChord([53, 57, 60, 65], 16, 16), // F
      ...blockChord([55, 59, 62, 67], 32, 16), // G
      ...blockChord([48, 60, 64, 67], 48, 16), // C
    ];
    const result = hypermeter(notes);
    expect(result.groupBars).toBe(4);
    expect(result.downbeats).toEqual([0, 16, 32, 48]);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('finds three-bar groups when the harmony turns every three bars', () => {
    const notes = [
      ...blockChord([48, 60, 64, 67], 0, 12), // C
      ...blockChord([53, 57, 60, 65], 12, 12), // F
      ...blockChord([55, 59, 62, 67], 24, 12), // G
      ...blockChord([48, 60, 64, 67], 36, 12), // C
    ];
    const result = hypermeter(notes);
    expect(result.groupBars).toBe(3);
    expect(result.downbeats).toEqual([0, 12, 24, 36]);
    expect(result.rationale).toMatch(/3-bar groups/);
  });

  it('does not claim a grouping a span is too short to establish', () => {
    const result = hypermeter(blockChord([60, 64, 67], 0, 4));
    expect(result.groupBars).toBe(1);
    expect(result.confidence).toBe(0);
    expect(result.rationale).toMatch(/too short/);
  });

  it('weighs the cadences it is given', () => {
    // Harmony alone says nothing here: every bar restates the same chord. The
    // cadence beats are the only evidence of where the groups end.
    const notes = Array.from({ length: 8 }, (_, bar) =>
      blockChord([48, 60, 64, 67], bar * 4, 4),
    ).flat();
    const result = hypermeter(notes, undefined, { cadenceBeats: [12, 28] });
    expect(result.groupBars).toBe(4);
    expect(result.downbeats).toEqual([0, 16]);
  });

  it('puts the group heads where the cadences close rather than between them', () => {
    // One chord per bar, I - IV - V - I four times over, with the cadences
    // arriving at the end of every four-bar group. The two signals disagree
    // outright: each group head restates the tonic the group before it closed
    // on, so bar-to-bar harmonic change is at its weakest exactly where the
    // grouping begins and at its strongest on the dominant in between.
    const roots: number[][] = [
      [48, 60, 64, 67], // C
      [53, 57, 60, 65], // F
      [55, 59, 62, 67], // G
      [48, 60, 64, 67], // C
    ];
    const notes = Array.from({ length: 16 }, (_, bar) =>
      blockChord(roots[bar % 4] ?? [], bar * 4, 4),
    ).flat();
    const cadenceBeats = [12, 28, 44, 60];
    const result = hypermeter(notes, undefined, { cadenceBeats });
    expect(result.groupBars).toBe(4);
    expect(result.downbeats).toEqual([0, 16, 32, 48]);
    // The cadences are what moved the phase: harmony alone reads these bars
    // differently, which is the disagreement the two shares exist to settle.
    expect(hypermeter(notes).downbeats).not.toEqual(result.downbeats);
    expect(result.rationale).toMatch(/100% of group ends/);
  });

  it('keeps a pickup bar out of the hypermetric downbeats', () => {
    const notes = [
      { pitch: 67, startBeat: -1, durationBeat: 1 },
      ...blockChord([48, 60, 64, 67], 0, 16),
      ...blockChord([53, 57, 60, 65], 16, 16),
      ...blockChord([55, 59, 62, 67], 32, 16),
      ...blockChord([48, 60, 64, 67], 48, 16),
    ];
    const result = hypermeter(notes);
    expect(result.groupBars).toBe(4);
    expect(result.downbeats).toEqual([0, 16, 32, 48]);
  });
});

describe('sectionsFromNotes', () => {
  /** Four bars of stepwise quarters, the A material. */
  function materialA(bar: number): NoteEvent[] {
    const at = bar * 4;
    return [
      ...quarters([60, 62, 64, 65], at),
      ...quarters([67, 65, 64, 62], at + 4),
      ...quarters([60, 62, 64, 67], at + 8),
      { pitch: 64, startBeat: at + 12, durationBeat: 4 },
    ];
  }

  /** Four bars of leaping half notes in another register, the B material. */
  function materialB(bar: number): NoteEvent[] {
    const at = bar * 4;
    return [
      { pitch: 69, startBeat: at, durationBeat: 2 },
      { pitch: 77, startBeat: at + 2, durationBeat: 2 },
      { pitch: 74, startBeat: at + 4, durationBeat: 2 },
      { pitch: 81, startBeat: at + 6, durationBeat: 2 },
      { pitch: 79, startBeat: at + 8, durationBeat: 2 },
      { pitch: 72, startBeat: at + 10, durationBeat: 2 },
      { pitch: 76, startBeat: at + 12, durationBeat: 4 },
    ];
  }

  const aba = [...materialA(0), ...materialB(4), ...materialA(8)];

  it('recovers an A B A form', () => {
    const sections = sectionsFromNotes(aba, { unitBars: 4 });
    expect(sections.map((section) => section.label)).toEqual(['A', 'B', 'A']);
    expect(sections.map((section) => section.startBeat)).toEqual([0, 16, 32]);
    expect(sections.map((section) => section.endBeat)).toEqual([16, 32, 48]);
    expect(sections.map((section) => section.bars)).toEqual([4, 4, 4]);
  });

  it('points a restatement back at the section it restates', () => {
    const sections = sectionsFromNotes(aba, { unitBars: 4 });
    expect(sections[2]?.firstOccurrence).toBe(0);
    expect(sections[2]?.similarity).toBeGreaterThan(0.9);
    expect(sections[0]?.firstOccurrence).toBe(0);
    expect(sections[0]?.similarity).toBe(1);
    expect(sections[1]?.firstOccurrence).toBe(1);
  });

  it('merges neighbouring units that restate each other', () => {
    const doubled = [...materialA(0), ...materialA(4), ...materialB(8)];
    const sections = sectionsFromNotes(doubled, { unitBars: 4 });
    expect(sections.map((section) => section.label)).toEqual(['A', 'B']);
    expect(sections[0]?.endBeat).toBe(32);
    expect(sections[0]?.bars).toBe(8);
  });

  it('infers the unit length when none is given', () => {
    const sections = sectionsFromNotes(aba);
    expect(sections.length).toBeGreaterThanOrEqual(1);
    expect(sections[0]?.startBeat).toBe(0);
    expect(sections[sections.length - 1]?.endBeat).toBe(48);
  });

  it('names no section over a stretch of silence', () => {
    // A figure, a long tacet, the same figure again: the pause is a break in the
    // form, not a statement of its own, so it takes no letter and the return is
    // heard as a restatement of the opening rather than as new material.
    const figure = (bar: number): NoteEvent[] => quarters([60, 62, 64, 65], bar * 4);
    const withSilence = [...figure(0), ...figure(8)];
    const sections = sectionsFromNotes(withSilence, { unitBars: 1 });
    expect(sections.map((section) => section.label)).toEqual(['A', 'A']);
    expect(sections[1]?.firstOccurrence).toBe(0);
    expect(sections[1]?.startBeat).toBe(32);
    // The silence belongs to the section it follows rather than to nothing.
    expect(sections[0]?.startBeat).toBe(0);
    expect(sections[0]?.endBeat).toBe(32);
  });

  it('keeps the letters running in order across a silence', () => {
    // A, silence, then new material: the pause consumes no letter, so what
    // follows is B rather than C.
    const figure = (bar: number): NoteEvent[] => quarters([60, 62, 64, 65], bar * 4);
    const withSilence = [...figure(0), ...materialB(8)];
    const sections = sectionsFromNotes(withSilence, { unitBars: 4 });
    expect(sections.map((section) => section.label)).toEqual(['A', 'B']);
    expect(sections[1]?.firstOccurrence).toBe(1);
  });

  it('names no section a chorus', () => {
    for (const section of sectionsFromNotes(aba, { unitBars: 4 })) {
      expect(section.label).toMatch(/^[A-Z]+$/);
    }
  });
});

describe('a pickup and a metre change', () => {
  // One beat of pickup, four bars of 4/4, then four bars of 3/4.
  const meters: MeterMap = [
    { startBeat: 0, ts: parseTimeSignature('4/4') },
    { startBeat: 16, ts: parseTimeSignature('3/4') },
  ];
  const notes: NoteEvent[] = [
    { pitch: 67, startBeat: -1, durationBeat: 1 },
    ...quarters([60, 62, 64, 65], 0),
    ...quarters([67, 65, 64, 62], 4),
    ...quarters([60, 62, 64, 67], 8),
    { pitch: 64, startBeat: 12, durationBeat: 4 },
    ...quarters([60, 62, 64], 16),
    ...quarters([65, 64, 62], 19),
    ...quarters([60, 64, 67], 22),
    { pitch: 60, startBeat: 25, durationBeat: 3 },
  ];

  it('reads the hypermeter without being broken by either', () => {
    const result = hypermeter(notes, meters);
    expect(result.groupBars).toBeGreaterThan(0);
    for (const downbeat of result.downbeats) {
      expect(downbeat).toBeGreaterThanOrEqual(0);
      expect(downbeat).toBeLessThan(28);
    }
  });

  it('starts the first phrase in the pickup and ends at the end of the music', () => {
    const timeline = chordTimelineFromChords(
      [
        span(0, 'maj', -1),
        span(5, 'maj', 4),
        span(7, 'maj', 8),
        span(0, 'maj', 12),
        span(5, 'maj', 16),
        span(2, 'min', 19),
        span(7, 'maj', 22),
        span(0, 'maj', 25),
      ],
      28,
    );
    const phrases = phrasesFromTimeline(timeline, notes, { meters, key: majorKey(0) });
    expect(phrases.length).toBeGreaterThanOrEqual(1);
    expect(phrases[0]?.startBeat).toBe(-1);
    expect(phrases[phrases.length - 1]?.endBeat).toBe(28);
    for (let i = 1; i < phrases.length; i += 1) {
      expect(phrases[i]?.startBeat).toBe(phrases[i - 1]?.endBeat);
    }
  });

  it('folds the pickup into the opening section', () => {
    const sections = sectionsFromNotes(notes, { meters, unitBars: 4 });
    expect(sections[0]?.startBeat).toBe(-1);
    expect(sections[sections.length - 1]?.endBeat).toBe(28);
  });
});

describe('the phrase search does not invent a break-even boundary', () => {
  // Three stops — the span's start, one candidate, and its end — with the
  // length term switched off (`expected` 0), so the only thing separating the
  // two readings is whether the candidate is cut at. A candidate worth exactly
  // what a cut costs pays for itself and no more, which is the tie the rule is
  // about.
  const BEATS = [0, 8, 16];
  const END_STRENGTH = 0.5;

  it('leaves a boundary that exactly pays for itself uncut', () => {
    const strengths = [0, PHRASE_CUT_COST, END_STRENGTH];
    // Both readings score the same to the last stop: cutting at beat 8 earns
    // exactly the cut's cost back, so the reading with the boundary and the one
    // without are worth the same. The longer phrase wins.
    expect(choosePhrasePath(BEATS, strengths, 1, 0)).toEqual([2]);
  });

  it('takes the boundary as soon as it is worth more than the cut', () => {
    // Nothing is being suppressed: a hair more evidence and the search cuts.
    const strengths = [0, PHRASE_CUT_COST + 0.01, END_STRENGTH];
    expect(choosePhrasePath(BEATS, strengths, 1, 0)).toEqual([1, 2]);
  });

  it('does not depend on how many equally scored readings there are', () => {
    // Four break-even candidates in a row: every reading that cuts at any
    // subset of them scores the same, and the answer is still the one with no
    // boundaries at all.
    const beats = [0, 4, 8, 12, 16, 20];
    const strengths = [0, PHRASE_CUT_COST, PHRASE_CUT_COST, PHRASE_CUT_COST, PHRASE_CUT_COST, 0.5];
    expect(choosePhrasePath(beats, strengths, 1, 0)).toEqual([5]);
  });

  it('still reports the whole span when no reading reaches the end', () => {
    // Every phrase would be shorter than the minimum, so the span is one phrase.
    expect(choosePhrasePath([0, 4], [0, 0.5], 100, 0)).toEqual([1]);
  });
});

describe('a boundary the evidence gives nothing for', () => {
  /** A drone: one chord sounding through the whole span, arguing nowhere. */
  const drone: NoteEvent[] = [48, 55, 60].map((pitch) => ({
    pitch,
    startBeat: 0,
    durationBeat: 64,
  }));

  it('is not cut at, however well the lengths would fit', () => {
    // A hypermeter read with no confidence registers its downbeats at strength
    // zero. The search weighs a cut by the two lengths it makes as well as by
    // the evidence, so over music that argues nowhere the length term alone put
    // boundaries in the reading — reported with a confidence a caller cannot
    // tell from an evidenced one.
    const { timeline } = chordTimelineFromNotes(drone, { key: majorKey(0) });
    const phrases = phrasesFromTimeline(timeline, drone, {
      key: majorKey(0),
      hypermeter: {
        groupBars: 4,
        downbeats: [0, 16, 32, 48],
        confidence: 0,
        rationale: 'a grouping with nothing behind it',
      },
      expectedPhraseBeats: 16,
    });
    expect(phrases).toHaveLength(1);
    expect(phrases[0]?.startBeat).toBe(0);
    expect(phrases[0]?.endBeat).toBe(64);
  });

  it('still cuts where the same grouping is read with confidence', () => {
    // Nothing is being suppressed: the same downbeats with evidence behind them
    // are boundaries.
    const { timeline } = chordTimelineFromNotes(drone, { key: majorKey(0) });
    const phrases = phrasesFromTimeline(timeline, drone, {
      key: majorKey(0),
      hypermeter: {
        groupBars: 4,
        downbeats: [0, 16, 32, 48],
        confidence: 1,
        rationale: 'a grouping the search is sure of',
      },
      expectedPhraseBeats: 16,
    });
    expect(phrases.length).toBeGreaterThan(1);
  });
});

describe('a phrase says the same thing twice about its cadence', () => {
  it('names cadence among its signals exactly when it closes on one', () => {
    // One cadence hit can register at two boundary positions — the chord's end
    // and the bar line it is held over — and the later phrase drops the hit as
    // having arrived before it began. The signals were taken from the boundary
    // as read, so such a phrase reported `closing on no cadence; boundary from
    // cadence`, which states both halves of one fact and contradicts itself.
    const harmony: NoteEvent[] = [
      ...blockChord([48, 60, 64, 67], 0, 4),
      ...blockChord([53, 57, 60, 65], 4, 4),
      ...blockChord([55, 59, 62, 67], 8, 4),
      ...blockChord([48, 60, 64, 67], 12, 20),
    ];
    const melody: NoteEvent[] = [
      ...quarters([72, 74, 76, 77], 0),
      ...quarters([79, 77, 76, 74], 4),
      ...quarters([72, 74, 76, 79], 8),
      { pitch: 72, startBeat: 12, durationBeat: 4 },
      ...quarters([72, 76, 79, 76], 16),
      ...quarters([72, 76, 79, 76], 20),
      ...quarters([72, 76, 79, 76], 24),
      { pitch: 72, startBeat: 28, durationBeat: 4 },
    ];
    const { timeline } = chordTimelineFromNotes([...harmony, ...melody], { key: majorKey(0) });
    const phrases = phrasesFromTimeline(timeline, melody, { key: majorKey(0) });
    expect(phrases.length).toBeGreaterThan(1);
    for (const phrase of phrases) {
      expect(phrase.signals.includes('cadence'), `${phrase.startBeat}`).toBe(
        phrase.cadence !== null,
      );
    }
  });
});

describe('an upbeat is never a hypermetric downbeat', () => {
  // A one-beat pickup, then harmony that turns at bars 3, 7 and 11 — a four-bar
  // grouping in phase 3. Bar -1 sits on that phase too, which is exactly the
  // reading that would put a hypermetric downbeat before the music starts.
  const notes: NoteEvent[] = [
    { pitch: 67, startBeat: -1, durationBeat: 1 },
    ...[0, 4, 8].flatMap((at) => blockChord([60, 64, 67], at, 4)),
    ...[12, 16, 20, 24].flatMap((at) => blockChord([65, 69, 72], at, 4)),
    ...[28, 32, 36, 40].flatMap((at) => blockChord([67, 71, 74], at, 4)),
    ...[44, 48, 52, 56].flatMap((at) => blockChord([60, 64, 67], at, 4)),
  ];

  it('leaves the pickup bar out of the downbeats', () => {
    const result = hypermeter(notes);
    expect(result.groupBars).toBe(4);
    expect(result.downbeats).toEqual([12, 28, 44]);
    expect(result.downbeats).not.toContain(-4);
    for (const downbeat of result.downbeats) {
      expect(downbeat).toBeGreaterThanOrEqual(-1);
    }
  });
});

describe('the analysis starts where the music does', () => {
  /** Two four-bar statements, the second a restatement, lifted from bar 5. */
  function excerpt(): NoteEvent[] {
    return [
      ...quarters([60, 62, 64, 65], 20),
      ...quarters([67, 65, 64, 62], 24),
      ...quarters([60, 62, 64, 65], 28),
      ...quarters([67, 65, 64, 62], 32),
    ];
  }

  it('does not invent bars in front of an excerpt', () => {
    // Every note is at beat 20 or later. A span anchored at bar 0 would report
    // five bars of silence as the opening section, and say the material was
    // first heard at beat 0.
    const sections = sectionsFromNotes(excerpt(), { unitBars: 4 });
    expect(sections[0]?.startBeat).toBe(20);
    expect(sections[sections.length - 1]?.endBeat).toBe(36);
    for (const section of sections) {
      expect(section.startBeat).toBeGreaterThanOrEqual(20);
      expect(section.rationale).not.toContain('beat 0');
    }
  });

  it('phases the hypermeter on the bars the excerpt has', () => {
    const result = hypermeter(excerpt());
    for (const downbeat of result.downbeats) {
      expect(downbeat).toBeGreaterThanOrEqual(20);
      expect(downbeat).toBeLessThan(36);
    }
  });

  it('still lets a pickup pull the span below beat 0', () => {
    // The span reaches back only for music that actually sounds there.
    const withPickup: NoteEvent[] = [
      { pitch: 67, startBeat: -1, durationBeat: 1 },
      ...quarters([60, 62, 64, 65], 0),
      ...quarters([67, 65, 64, 62], 4),
    ];
    expect(sectionsFromNotes(withPickup, { unitBars: 4 })[0]?.startBeat).toBe(-1);
  });

  it('reports no form for a span with nothing in it', () => {
    expect(sectionsFromNotes([])).toEqual([]);
    // Notes that never sound are dropped before the span is measured, so an
    // array of artefacts is an empty span rather than one starting at beat 0.
    expect(sectionsFromNotes([{ pitch: 60, startBeat: 8, durationBeat: 0 }])).toEqual([]);
  });

  it('gives the same first beat whichever form function is asked', () => {
    // Sections, hyperbars and phrases read the same material three ways, and a
    // host draws all three on one ruler: an answer of beat 20 next to one of
    // beat 0 is not two opinions, it is one of them being wrong.
    const chords = [span(0, 'maj', 20), span(7, 'maj', 24), span(2, 'min', 28), span(0, 'maj', 32)];
    const notes = excerpt();
    const phrases = phrasesFromTimeline(chordTimelineFromChords(chords, 36), notes, {
      key: majorKey(0),
    });
    expect(sectionsFromNotes(notes, { unitBars: 4 })[0]?.startBeat).toBe(20);
    expect(phrases[0]?.startBeat).toBe(20);
    expect(Math.min(...hypermeter(notes).downbeats)).toBeGreaterThanOrEqual(20);
  });

  it('lets all three reach back for the same pickup', () => {
    const pickupChords = [span(0, 'maj', 0), span(7, 'maj', 4), span(2, 'min', 8)];
    const notes: NoteEvent[] = [
      { pitch: 67, startBeat: -1, durationBeat: 1 },
      ...quarters([60, 62, 64, 65], 0),
      ...quarters([67, 65, 64, 62], 4),
      ...quarters([60, 62, 64, 65], 8),
    ];
    const phrases = phrasesFromTimeline(chordTimelineFromChords(pickupChords, 12), notes, {
      key: majorKey(0),
    });
    expect(sectionsFromNotes(notes, { unitBars: 4 })[0]?.startBeat).toBe(-1);
    expect(phrases[0]?.startBeat).toBe(-1);
    // The upbeat leads into the first hyperbar rather than starting one.
    expect(hypermeter(notes).downbeats).not.toContain(-1);
  });
});

describe('determinism', () => {
  const chords = [0, 1, 2, 3].flatMap((unit) => cadentialUnit(unit * 4));
  const melody = [0, 1, 2, 3].flatMap((unit) => melodicUnit(unit * 4));

  it('returns the same phrases for the same input', () => {
    const timeline = chordTimelineFromChords(chords, 64);
    const first = phrasesFromTimeline(timeline, melody, { key: majorKey(0) });
    const second = phrasesFromTimeline(timeline, melody, { key: majorKey(0) });
    expect(second).toEqual(first);
    expect(structuralCadences(second)).toEqual(structuralCadences(first));
  });

  it('returns the same hypermeter and sections for the same input', () => {
    expect(hypermeter(melody)).toEqual(hypermeter(melody));
    expect(sectionsFromNotes(melody, { unitBars: 4 })).toEqual(
      sectionsFromNotes(melody, { unitBars: 4 }),
    );
  });

  it('does not depend on the order the notes arrive in', () => {
    const shuffled = [...melody].reverse();
    expect(sectionsFromNotes(shuffled, { unitBars: 4 })).toEqual(
      sectionsFromNotes(melody, { unitBars: 4 }),
    );
    expect(hypermeter(shuffled)).toEqual(hypermeter(melody));
  });
});

describe('the same music read from a later bar', () => {
  /** Four harmonies, four bars each, written from `fromBar`. */
  function harmonies(fromBar: number): NoteEvent[] {
    const at = fromBar * 4;
    return [
      ...blockChord([48, 60, 64, 67], at, 16),
      ...blockChord([53, 57, 60, 65], at + 16, 16),
      ...blockChord([55, 59, 62, 67], at + 32, 16),
      ...blockChord([48, 60, 64, 67], at + 48, 16),
    ];
  }

  it('is the same reading, moved along', () => {
    // A DAW selection or a cut-out chorus is the same music as the passage it
    // was cut from. Reading it as weaker, or in another phase, would make the
    // answer depend on where the caller happened to start looking.
    const opening = hypermeter(harmonies(0));
    const later = hypermeter(harmonies(5));
    expect(later.groupBars).toBe(opening.groupBars);
    expect(later.confidence).toBeCloseTo(opening.confidence, 12);
    expect(later.downbeats).toEqual(opening.downbeats.map((beat) => beat + 20));
  });
});

describe('a note a millibeat before the downbeat', () => {
  // A performance exported from a DAW puts the first note a hair early. That is
  // the downbeat being played, not an upbeat, and all three form analyses have
  // to say so or a host drawing them together gets a bar that does not line up.
  const notes: NoteEvent[] = [
    { pitch: 60, startBeat: -0.02, durationBeat: 1.02 },
    ...quarters([62, 64, 65], 1),
    ...quarters([67, 65, 64, 62], 4),
    ...quarters([60, 62, 64, 65], 8),
    ...quarters([67, 65, 64, 62], 12),
  ];
  const chords = [span(0, 'maj', 0), span(7, 'maj', 4), span(2, 'min', 8), span(0, 'maj', 12)];

  it('starts all three form analyses on beat 0', () => {
    const phrases = phrasesFromTimeline(chordTimelineFromChords(chords, 16), notes, {
      key: majorKey(0),
    });
    expect(phrases[0]?.startBeat).toBe(0);
    expect(sectionsFromNotes(notes, { unitBars: 4 })[0]?.startBeat).toBe(0);
    expect(Math.min(...hypermeter(notes).downbeats)).toBe(0);
  });
});

describe('a pickup does not make a span long enough to group', () => {
  const threeBars = [0, 1, 2].flatMap((bar) => blockChord([60, 64, 67], bar * 4, 4));

  it('answers the same with an upbeat in front of it as without', () => {
    // Three bars cannot hold two groups of anything. A beat of upbeat leads
    // into the first hyperbar rather than filling one, so it cannot be what
    // makes the span long enough.
    const plain = hypermeter(threeBars);
    const withPickup = hypermeter([{ pitch: 67, startBeat: -1, durationBeat: 1 }, ...threeBars]);
    expect(plain.rationale).toMatch(/too short/);
    expect(withPickup.rationale).toMatch(/too short/);
    expect(withPickup.groupBars).toBe(plain.groupBars);
    expect(withPickup.confidence).toBe(plain.confidence);
    expect(withPickup.downbeats).toEqual(plain.downbeats);
  });
});

describe('a span with nothing sounding in it', () => {
  it('reports no phrases, the way it reports no sections', () => {
    // Two readers of one object may not answer the same question differently:
    // a phrase of no length, closed by nothing, is a marker rather than a
    // phrase, and a host dividing by its length divides by zero.
    expect(Score.of([]).phrases()).toEqual([]);
    expect(sectionsFromNotes([])).toEqual([]);
    const silent = [{ pitch: 60, startBeat: 8, durationBeat: 0 }];
    expect(Score.of(silent).phrases()).toEqual([]);
    expect(sectionsFromNotes(silent)).toEqual([]);
  });

  it('gives every phrase it does report some length', () => {
    const chords = [span(0, 'maj', 0), span(7, 'maj', 4), span(0, 'maj', 8)];
    const phrases = phrasesFromTimeline(
      chordTimelineFromChords(chords, 12),
      quarters([60, 62, 64, 65], 0),
      { key: majorKey(0) },
    );
    for (const phrase of phrases) {
      expect(phrase.endBeat).toBeGreaterThan(phrase.startBeat);
    }
  });
});

describe('the phrase examples state what the functions return', () => {
  // The data of the published `@example` blocks, kept here so the values their
  // closing comments name are checked rather than only executed.
  const triad = (pitches: number[], startBeat: number): NoteEvent[] =>
    pitches.map((pitch) => ({ pitch, startBeat, durationBeat: 4 }));
  const notes = [
    ...triad([60, 64, 67], 0),
    ...triad([65, 69, 72], 4),
    ...triad([67, 71, 74], 8),
    ...triad([60, 64, 67], 12),
  ];

  it('closes the last phrase on the authentic cadence the example names', () => {
    const { timeline } = chordTimelineFromNotes(notes);
    const phrases = phrasesFromTimeline(timeline, notes);
    const last = phrases[phrases.length - 1];
    expect(last?.cadence?.cadence.type).toBe('authentic');
    expect(last?.cadence?.atBeat).toBe(12);
  });

  it('ranks that cadence first', () => {
    const { timeline } = chordTimelineFromNotes(notes);
    const ranked = structuralCadences(phrasesFromTimeline(timeline, notes));
    expect(ranked[0]?.cadence.type).toBe('authentic');
    expect(ranked[0]?.atBeat).toBe(12);
  });
});

describe('a hypermeter handed in by the caller', () => {
  const timeline = chordTimelineFromChords(
    [span(0, 'maj', 0), span(7, 'maj', 4), span(0, 'maj', 8)],
    12,
  );
  const melody = quarters([60, 62, 64, 65], 0);
  const grouping = { groupBars: 2, downbeats: [0, 8], confidence: 0.5, rationale: 'given' };

  it('refuses a confidence outside the range its type states', () => {
    const call = () =>
      phrasesFromTimeline(timeline, melody, {
        key: majorKey(0),
        hypermeter: { ...grouping, confidence: 4 },
      });
    expect(call).toThrow(InvalidInputError);
    expect(call).toThrow(/hypermeter/);
  });

  it('refuses a grouping that is not a whole number of bars', () => {
    const call = () =>
      phrasesFromTimeline(timeline, melody, {
        key: majorKey(0),
        hypermeter: { ...grouping, groupBars: 2.5 },
      });
    expect(call).toThrow(InvalidInputError);
    expect(call).toThrow(/hypermeter/);
  });
});

describe('a unit with too little melody to compare', () => {
  it('is like another thin unit and unlike a full one', () => {
    // One bar of a figure, then two bars each holding a single tone of it. A
    // held tone states nothing the figure stated, so it takes a letter of its
    // own; two of them state the same nothing, so they share it.
    const notes: NoteEvent[] = [
      ...quarters([60, 62, 64, 65], 0),
      { pitch: 60, startBeat: 4, durationBeat: 4 },
      { pitch: 60, startBeat: 8, durationBeat: 4 },
    ];
    const sections = sectionsFromNotes(notes, { unitBars: 1 });
    expect(sections.map((section) => section.label)).toEqual(['A', 'B']);
    expect(sections[1]?.startBeat).toBe(4);
    expect(sections[1]?.bars).toBe(2);
  });
});

describe('phrases over a metre change', () => {
  // Four bars of 4/4, then four bars of 3/4.
  const meters: MeterMap = [
    { startBeat: 0, ts: parseTimeSignature('4/4') },
    { startBeat: 16, ts: parseTimeSignature('3/4') },
  ];
  const notes: NoteEvent[] = [
    ...quarters([60, 62, 64, 65], 0),
    ...quarters([67, 65, 64, 62], 4),
    ...quarters([60, 62, 64, 67], 8),
    { pitch: 64, startBeat: 12, durationBeat: 4 },
    ...quarters([60, 62, 64], 16),
    ...quarters([65, 64, 62], 19),
    ...quarters([60, 64, 67], 22),
    { pitch: 60, startBeat: 25, durationBeat: 3 },
  ];
  const timeline = chordTimelineFromChords(
    [
      span(0, 'maj', 0),
      span(5, 'maj', 4),
      span(7, 'maj', 8),
      span(0, 'maj', 12),
      span(5, 'maj', 16),
      span(2, 'min', 19),
      span(7, 'maj', 22),
      span(0, 'maj', 25),
    ],
    28,
  );
  const grouping = { groupBars: 2, downbeats: [0, 8], confidence: 0.5, rationale: 'given' };

  it('counts the bars of a phrase in the metre the phrase is in', () => {
    // Twelve beats of 3/4 are four bars. Counting them in the metre the piece
    // opened in would put three next to a bar number the rest of the library
    // reads as four.
    const phrases = phrasesFromTimeline(timeline, notes, { meters, key: majorKey(0) });
    const inThree = phrases.filter((phrase) => phrase.startBeat >= 16);
    expect(inThree.length).toBeGreaterThan(0);
    for (const phrase of phrases) {
      const bars = barIndexAt(phrase.endBeat, meters) - barIndexAt(phrase.startBeat, meters);
      expect(phrase.rationale).toContain(`Phrase of ${bars} bar(s)`);
    }
  });

  it('takes the default phrase length once, from the metre the span opens in', () => {
    // A length is a length rather than a position: the hyperbar the default is
    // drawn from is measured where the span begins, so a later 3/4 stretch does
    // not shorten what a phrase is expected to run.
    const withDefault = phrasesFromTimeline(timeline, notes, {
      meters,
      key: majorKey(0),
      hypermeter: grouping,
    });
    const openingHyperbar = phrasesFromTimeline(timeline, notes, {
      meters,
      key: majorKey(0),
      hypermeter: grouping,
      expectedPhraseBeats: 8,
    });
    const laterHyperbar = phrasesFromTimeline(timeline, notes, {
      meters,
      key: majorKey(0),
      hypermeter: grouping,
      expectedPhraseBeats: 6,
    });
    expect(withDefault).toEqual(openingHyperbar);
    expect(withDefault).not.toEqual(laterHyperbar);
  });

  it('draws that length from the metre the span itself opens in', () => {
    // "The metre the span opens in" is the metre of the span analysed, not of
    // the piece. Bar 0 is always the bar beginning at beat 0 of the map, so a
    // hyperbar measured from there hands an excerpt starting after the change
    // the bar length of a metre it never sounds in — and that wrong length is
    // the prior every phrase in the excerpt is fitted against.
    const excerptNotes: NoteEvent[] = [
      ...quarters([60, 62, 64], 16),
      ...quarters([65, 64, 62], 19),
      ...quarters([60, 64, 67], 22),
      { pitch: 60, startBeat: 25, durationBeat: 3 },
    ];
    const excerpt = chordTimelineFromChords(
      [span(0, 'maj', 16), span(5, 'maj', 19), span(7, 'maj', 22), span(0, 'maj', 25)],
      28,
    );
    const read = (expectedPhraseBeats?: number) =>
      phrasesFromTimeline(excerpt, excerptNotes, {
        meters,
        key: majorKey(0),
        hypermeter: grouping,
        ...(expectedPhraseBeats === undefined ? {} : { expectedPhraseBeats }),
      });
    // Two bars of 3/4 are six beats, not the eight two bars of the opening 4/4
    // would give.
    expect(read()).toEqual(read(6));
    expect(read(6)).not.toEqual(read(8));
  });
});
