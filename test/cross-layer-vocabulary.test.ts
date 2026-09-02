/**
 * The words two layers use for the same musical concept.
 *
 * Each case here reads one musical figure through two layers and asserts they
 * call it the same thing. A layer-local test cannot catch this: both sides pass
 * their own suites while a caller putting the two answers side by side gets a
 * note-level reading and a chord-level reading that do not line up.
 */
import { describe, expect, it } from 'vitest';
import { tensionCurve } from '../src/analyze/arrange/index.js';
import { hypermeter, sectionsFromNotes } from '../src/analyze/form/index.js';
import { parallelKey } from '../src/analyze/functional/index.js';
import { gridOriginOf } from '../src/analyze/grid.js';
import { keyTimelineFromNotes } from '../src/analyze/keys/index.js';
import { reduceProgression } from '../src/analyze/reduction/index.js';
import { chordTimelineFromChords } from '../src/analyze/timeline/index.js';
import { analyzeVoice } from '../src/analyze/voice/index.js';
import { parseNote } from '../src/core/pitch/index.js';
import { classifyMelodyTones } from '../src/generate/harmonize/nct.js';
import { makeChord } from '../src/theory/chord/index.js';
import { avoidNotes } from '../src/theory/chordscale/index.js';
import { roleOf } from '../src/theory/harmony/index.js';
import {
  majorKey,
  minorKey,
  parallelKeyOf,
  scaleTonesInDegreeOrder,
} from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const fourFour = { numerator: 4, denominator: 4 };

describe('the neighbouring figure is called a neighbour in every layer', () => {
  // C - D - C over one harmony: the note-level figure and the chord-level
  // prolongation are the same event heard at two scales.
  const melody = [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 62, startBeat: 1, durationBeat: 1 },
    { pitch: 60, startBeat: 2, durationBeat: 1 },
  ];

  it('names it neighbor at the note level, in both the analysis and the harmonizer', () => {
    const labels = analyzeVoice(melody, () => makeChord(0, 'maj'), cMajor).map((note) =>
      note.labels.map((label) => label.kind),
    );
    expect(labels[1]).toContain('neighbor');
    expect(classifyMelodyTones(melody, fourFour)[1]?.role).toBe('neighbor');
  });

  it('names it neighbor at the chord level too', () => {
    // C - Dm - C: a root that steps away from the surrounding harmony and comes
    // back is the chord-level neighbour, and reduction has to spell it the same
    // way the note-level layers do.
    const timeline = chordTimelineFromChords(
      [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 2, quality: 'min', startBeat: 4 },
        { rootPc: 0, quality: 'maj', startBeat: 6 },
      ],
      10,
    );
    const levels = reduceProgression(timeline, cMajor).map((entry) => entry.level);
    expect(levels).toContain('neighbor');
    // One word for the figure across the seam: the other name for it is not a
    // level the reduction reports.
    expect(levels).not.toContain('auxiliary');
  });
});

describe('an ornament the harmonizer explains away is not a chord tone to the analysis', () => {
  // C (weak) - F (leaning, by leap) - E (step down): a textbook appoggiatura.
  const melody = [
    { pitch: 60, startBeat: 1, durationBeat: 1 },
    { pitch: 65, startBeat: 2, durationBeat: 1 },
    { pitch: 64, startBeat: 3, durationBeat: 1 },
  ];

  it('agrees that the leaning note is not part of the harmony', () => {
    const classified = classifyMelodyTones(melody, fourFour)[1];
    expect(classified?.ornamental).toBe(true);
    const labels = analyzeVoice(melody, () => makeChord(0, 'maj'), cMajor)[1]?.labels ?? [];
    const kinds = labels.map((label) => label.kind);
    // The note-level layer must not call it a chord tone — that is the
    // disagreement that let a harmonizer keep a note the analysis had already
    // explained as decoration — and it names the figure the same way the
    // harmonizer does rather than reporting an unexplained dissonance.
    expect(kinds).not.toContain('chordTone');
    expect(kinds).toContain('appoggiatura');
  });
});

describe('a suspension is read from the tones, not from the quality name', () => {
  // The suspended tone stands in the third's slot and locks the quality, and
  // the chord-scale layer has to leave that same tone alone.
  // The eleventh chord names no suspension at all — it states one by omitting
  // its third — which is exactly what a set of quality names cannot cover.
  const suspended: [string, number][] = [
    ['sus4', 5],
    ['7sus4', 5],
    ['11', 5],
    ['sus2', 2],
  ];

  it.each(suspended)('%s suspends into the tone a fourth or second above', (quality, interval) => {
    const chord = makeChord(0, quality as Parameters<typeof makeChord>[1]);
    expect(roleOf(interval, chord).role).toBe('third');
    expect(roleOf(interval, chord).lock).toBe('quality');
    // The chord-scale layer agrees: the suspended tone is not an avoid note,
    // since it is the chord's own quality-defining tone.
    expect(avoidNotes(chord, 'ionian')).not.toContain(interval);
  });

  it('still calls the fourth an avoid note over a chord that states its third', () => {
    expect(avoidNotes(makeChord(0, 'maj7'), 'ionian')).toContain(5);
  });
});

describe('what counts as a pickup is one question, answered in one place', () => {
  const block = (pitches: number[], at: number, len: number) =>
    pitches.map((pitch) => ({ pitch, startBeat: at, durationBeat: len }));
  // Harmony turning at bars 3, 7 and 11: four-bar groups in phase 3, which is
  // the phase that would put a group head on a pickup bar if one were read.
  const material = (firstAt: number) => [
    ...block([60, 64, 67], firstAt, 4),
    ...[4, 8].flatMap((at) => block([60, 64, 67], at, 4)),
    ...[12, 16, 20, 24].flatMap((at) => block([65, 69, 72], at, 4)),
    ...[28, 32, 36, 40].flatMap((at) => block([67, 71, 74], at, 4)),
    ...[44, 48, 52, 56].flatMap((at) => block([60, 64, 67], at, 4)),
  ];

  it('reads a note a millibeat early as the downbeat it is playing', () => {
    // The slot grids of chord and key inference answer this way ...
    expect(gridOriginOf(-0.001, 4).startBeat).toBe(0);
    // ... and the bar grid of form analysis has to answer the same, or a
    // performance exported from a DAW gets a silent bar the score never had.
    expect(hypermeter(material(-0.001))).toEqual(hypermeter(material(0)));
  });

  it('still reads a real upbeat as the pickup it is', () => {
    const withPickup = hypermeter([...block([67], -1, 1), ...material(0)]);
    expect(withPickup.groupBars).toBe(4);
    // The pickup bar is analysed, and never counted as a hypermetric downbeat.
    expect(withPickup.downbeats.every((beat) => beat >= 0)).toBe(true);
    expect(withPickup).not.toEqual(hypermeter(material(0)));
  });
});

describe('an excerpt lifted from the middle of a piece starts where it sounds', () => {
  // C - F - G7 - C, written from bar 9 rather than from bar 1. Nothing sounds
  // before beat 32, so no layer may report a span that begins earlier.
  const AT = 32;
  const chordAt = (at: number, pitches: number[]) =>
    pitches.map((pitch) => ({ pitch, startBeat: at, durationBeat: 4 }));
  const excerpt = [
    ...chordAt(AT, [60, 64, 67]),
    ...chordAt(AT + 4, [65, 69, 72]),
    ...chordAt(AT + 8, [67, 71, 74, 77]),
    ...chordAt(AT + 12, [60, 64, 67]),
  ];

  it('gives the key regions the beat the music begins on', () => {
    const regions = keyTimelineFromNotes(excerpt);
    expect(regions.length).toBeGreaterThan(0);
    expect(regions[0]?.startBeat).toBe(AT);
  });

  it('samples the tension curve from that same beat', () => {
    const curve = tensionCurve([{ notes: excerpt }], { step: 4 });
    expect(curve.length).toBeGreaterThan(0);
    expect(curve[0]?.beat).toBe(AT);
  });

  it('agrees with the form analyses, which already answer that way', () => {
    const sections = sectionsFromNotes(excerpt, { ts: fourFour });
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0]?.startBeat).toBe(AT);
  });
});

describe('the two parallel-key functions name the same key', () => {
  it('agrees on the pitch classes, whatever the representation', () => {
    for (const [name, key] of [
      ['C major', cMajor],
      ['A minor', minorKey(9)],
    ] as const) {
      const plain = parallelKey(key);
      const spelled = parallelKeyOf(parseNote(name.split(' ')[0] as string), key);
      expect(spelled.scale.rootPc, name).toBe(plain.rootPc);
      expect(scaleTonesInDegreeOrder(spelled.scale), name).toEqual(scaleTonesInDegreeOrder(plain));
    }
  });
});

describe('the two readings share their words without sharing their evidence', () => {
  it('names the same note differently where the evidence differs', () => {
    // The guides promise one vocabulary across the two readings, not one
    // answer. What each reads is different: `analyzeVoice` reads a note against
    // the chord sounding under it, and `classifyMelodyTones` reads the melody
    // and the metre with no chord at all. Neither answer is a subset of the
    // other, and a host colouring notes from both sees two legends over one bar
    // — which is the two questions, not a disagreement.
    const stepwise = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 62, startBeat: 1, durationBeat: 1 },
      { pitch: 64, startBeat: 2, durationBeat: 1 },
    ];
    // D is a chord tone of the G7 sounding under it, and a passing tone in the
    // line: the chord decides one reading and the line decides the other.
    const overDominant = analyzeVoice(stepwise, () => makeChord(7, 'dom7'), cMajor)[1];
    expect(overDominant?.labels.map((label) => label.kind)).toContain('chordTone');
    expect(classifyMelodyTones(stepwise, fourFour)[1]?.role).toBe('passing');

    // The other direction: a leap answered by a step off the beat is an
    // appoggiatura to the note-level reading, which weighs no metre, and
    // structural to the one that does.
    const leaning = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 65, startBeat: 1, durationBeat: 1 },
      { pitch: 64, startBeat: 2, durationBeat: 1 },
    ];
    const leant = analyzeVoice(leaning, () => makeChord(0, 'maj'), cMajor)[1];
    expect(leant?.labels.map((label) => label.kind)).toContain('appoggiatura');
    expect(classifyMelodyTones(leaning, fourFour)[1]?.role).toBe('structural');
  });
});
