import { describe, expect, it } from 'vitest';
import {
  hypermeter,
  phrasesFromTimeline,
  sectionsFromNotes,
  structuralCadences,
} from '../src/analyze/form/index.js';
import { choosePhrasePath, PHRASE_CUT_COST } from '../src/analyze/form/phrase.js';
import { chordTimelineFromChords } from '../src/analyze/timeline/index.js';
import type { MeterMap } from '../src/core/meter/index.js';
import { parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
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
