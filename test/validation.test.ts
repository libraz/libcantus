import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  analyzeArrangement,
  analyzePolyphony,
  createArrangementSession,
  tensionCurve,
  tensionCurveFrom,
} from '../src/analyze/arrange/index.js';
import { detectKeyFromNotes } from '../src/analyze/detect/index.js';
import { hypermeter, phrasesFromTimeline, sectionsFromNotes } from '../src/analyze/form/index.js';
import { keyTimelineFromNotes } from '../src/analyze/keys/index.js';
import { motifFromNotes } from '../src/analyze/melody/index.js';
import { spellLine } from '../src/analyze/spelling/index.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { analyzeVoice, toVoiceNotes } from '../src/analyze/voice/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { createNoteEventIndex } from '../src/core/event-index/index.js';
import { GUITAR_STANDARD, playability } from '../src/core/instrument/index.js';
import {
  ConsonanceClass,
  classifyInterval,
  isConsonantInterval,
  isPerfectInterval,
} from '../src/core/interval/index.js';
import {
  isCompound,
  metricWeight,
  parseTimeSignature,
  pulsesPerBar,
  type TimeSignature,
  tuplet,
} from '../src/core/meter/index.js';
import {
  formatNote,
  midiToNote,
  noteToMidi,
  noteToPitchClass,
  parseNote,
  pitchClassOf,
} from '../src/core/pitch/index.js';
import { createRng } from '../src/core/random/index.js';
import { edo, frequencyOf, nearestStep, ratioToCents } from '../src/core/tuning/index.js';
import type { NoteEvent } from '../src/core/types.js';
import {
  assertDegree,
  assertFiniteNumber,
  assertFiniteSemitones,
  assertGenerationBudget,
  assertMidiPitch,
  assertNoteEvent,
  assertNoteEvents,
  assertPositiveInt,
  assertRange,
  assertTimeSignature,
  clampToMidi,
  dropSilentNotes,
} from '../src/core/validation/index.js';
import { generateBassLine } from '../src/generate/bass/index.js';
import { generateCounterMelody, imitate } from '../src/generate/countermelody/index.js';
import { generateDrums } from '../src/generate/drums/index.js';
import {
  applyGrooveTemplate,
  extractGrooveTemplate,
  humanize,
} from '../src/generate/groove/index.js';
import { classifyMelodyTones, harmonizeMelody } from '../src/generate/harmonize/index.js';
import {
  developMotif,
  generateMotif,
  motifToNoteEvents,
  transformMotif,
} from '../src/generate/motif/index.js';
import { ornament } from '../src/generate/ornament/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { generateRhythm } from '../src/generate/rhythm/index.js';
import * as api from '../src/index.js';
import { Arrangement, Motif, Note, Score } from '../src/model/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { NoteSafety, ReasonFlag } from '../src/theory/safety/index.js';
import { majorKey, scaleByName } from '../src/theory/scale/index.js';
import { parseChordSymbol } from '../src/theory/symbol/index.js';
import { filesUnder, ROOT, SRC } from './support/source-files.js';

describe('shared numeric input contracts', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite value %s',
    (value) => {
      expect(() => assertFiniteNumber(value, 'value')).toThrow(RangeError);
    },
  );

  it('checks integer, range, and generation budget boundaries', () => {
    expect(assertPositiveInt(1, 'count')).toBe(1);
    expect(() => assertPositiveInt(1.5, 'count')).toThrow(RangeError);
    expect(assertRange(1, 0, 1, 'ratio')).toBe(1);
    expect(() => assertRange(-1, 0, 1, 'ratio')).toThrow(RangeError);
    expect(assertGenerationBudget(10, 'events', 10)).toBe(10);
    expect(() => assertGenerationBudget(11, 'events', 10)).toThrow(RangeError);
    expect(assertDegree(1)).toBe(1);
    expect(assertDegree(7)).toBe(7);
    expect(() => assertDegree(0)).toThrow(RangeError);
    expect(() => assertDegree(1.5)).toThrow(RangeError);
    expect(() => assertFiniteSemitones(Number.NaN)).toThrow(RangeError);
  });

  it('shares the MIDI pitch contract between rejection and generator clamping', () => {
    expect(assertMidiPitch(0)).toBe(0);
    expect(assertMidiPitch(127)).toBe(127);
    expect(() => assertMidiPitch(127.5)).toThrow(RangeError);
    expect(() => assertMidiPitch(128)).toThrow(RangeError);
    expect(clampToMidi(-12)).toBe(0);
    expect(clampToMidi(140)).toBe(127);
    expect(() => clampToMidi(60.5)).toThrow(RangeError);
  });

  it('validates meter grouping before downbeat and off-pulse early returns', () => {
    const invalid = { numerator: 7, denominator: 8, grouping: [2, 2] };
    expect(() => metricWeight(0, invalid)).toThrow(RangeError);
    expect(() => metricWeight(0.25, invalid)).toThrow(RangeError);
    expect(() => tuplet(1, 1_000_001)).toThrow(RangeError);
  });

  it('rejects invalid tuning and random ranges consistently', () => {
    expect(() => edo(0)).toThrow(RangeError);
    expect(() => frequencyOf(Number.NaN)).toThrow(RangeError);
    expect(() => nearestStep(0)).toThrow(RangeError);
    expect(() => ratioToCents(3, 0)).toThrow(RangeError);
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => createRng(1).range(4, 3)).toThrow(RangeError);
    expect(() => createRng(1).range(1.5, 3)).toThrow(RangeError);
    expect(() => createRng(1).float(2, 1)).toThrow(RangeError);
  });

  it.each([
    () => generateRhythm({ numerator: 4, denominator: 4 }, { bars: Number.POSITIVE_INFINITY }),
    () => generateRhythm({ numerator: 4, denominator: 4 }, { subdivision: 1_000_001 }),
    () => generateProgression({ key: majorKey(0), style: 'dance', bars: 1.5 }),
    () => generateMotif({ key: majorKey(0), bars: Number.NaN }),
    () =>
      generateDrums({
        bars: 1,
        ctx: { bpm: 120, complexity: { rhythmic: Number.NaN } },
        style: 'standard',
        section: 'verse',
        fills: false,
      }),
    () =>
      harmonizeMelody({
        melody: [{ pitch: 60, startBeat: 0, durationBeat: 1 }],
        key: majorKey(0),
        harmonicRhythm: Number.POSITIVE_INFINITY,
        reharmonize: 'diatonic',
        placement: { transposeSearch: false, octaveSearch: false },
      }),
  ])('rejects unsafe generator input before looping or allocating', (generate) => {
    expect(generate).toThrow(RangeError);
  });
});

describe('core guards reject what would otherwise flow on as garbage', () => {
  it('reports a non-array event collection as invalid input', () => {
    expect(() => assertNoteEvents(null as unknown as NoteEvent[])).toThrow(InvalidInputError);
  });

  it('rejects a non-finite MIDI number instead of naming it CNaN', () => {
    expect(() => midiToNote(Number.NaN)).toThrow(RangeError);
    expect(() => midiToNote(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => Note.fromMidi(Number.NaN)).toThrow(RangeError);
    expect(() => pitchClassOf(Number.NaN)).toThrow(RangeError);
  });

  it('rejects a note whose fields are not finite integers', () => {
    expect(() => formatNote({ letter: 0, alter: Number.NaN })).toThrow(RangeError);
    expect(() => noteToMidi({ letter: 0, alter: 0, octave: Number.NaN })).toThrow(RangeError);
    expect(() => noteToPitchClass({ letter: Number.NaN, alter: 0 })).toThrow(RangeError);
  });

  it('rejects an alteration wide enough to blow up glyph rendering', () => {
    expect(() => formatNote({ letter: 0, alter: 1e6 })).toThrow(RangeError);
    expect(() => parseNote(`C${'#'.repeat(40)}`)).toThrow(RangeError);
  });

  it('rejects a non-finite interval instead of silently calling it a dissonance', () => {
    expect(() => classifyInterval(Number.NaN)).toThrow(RangeError);
    expect(() => isConsonantInterval(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => isPerfectInterval(Number.NaN)).toThrow(RangeError);
  });

  it('rejects a hole or an undefined element in a note-event array', () => {
    const sparse: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1 }];
    sparse[2] = { pitch: 62, startBeat: 2, durationBeat: 1 };
    expect(() => assertNoteEvents(sparse)).toThrow(RangeError);
    expect(() => assertNoteEvents([undefined as unknown as NoteEvent])).toThrow(RangeError);
  });

  it('names a zero-length note as such instead of quoting a denormal bound', () => {
    expect(() => assertNoteEvent({ pitch: 60, startBeat: 0, durationBeat: 0 })).toThrow(
      /durationBeat must be positive/,
    );
  });
});

describe('every note-event guard has a rejection path', () => {
  it.each([
    ['non-finite pitch', { pitch: Number.NaN, startBeat: 0, durationBeat: 1 }],
    ['infinite pitch', { pitch: Number.POSITIVE_INFINITY, startBeat: 0, durationBeat: 1 }],
    ['non-finite onset', { pitch: 60, startBeat: Number.NaN, durationBeat: 1 }],
    ['infinitely early onset', { pitch: 60, startBeat: Number.NEGATIVE_INFINITY, durationBeat: 1 }],
    ['zero duration', { pitch: 60, startBeat: 0, durationBeat: 0 }],
    ['negative duration', { pitch: 60, startBeat: 0, durationBeat: -1 }],
    ['velocity above 127', { pitch: 60, startBeat: 0, durationBeat: 1, velocity: 128 }],
    ['negative velocity', { pitch: 60, startBeat: 0, durationBeat: 1, velocity: -1 }],
    // A velocity is the MIDI byte the pitch beside it is, so it is held to the
    // same whole domain: 63.7 is a rounding left undone, not a quiet note.
    ['fractional velocity', { pitch: 60, startBeat: 0, durationBeat: 1, velocity: 63.7 }],
    ['fractional pitch', { pitch: 60.5, startBeat: 0, durationBeat: 1 }],
  ])('rejects a note with a %s', (_label, event) => {
    expect(() => assertNoteEvent(event)).toThrow(RangeError);
    expect(() => assertNoteEvents([event])).toThrow(RangeError);
  });

  it('accepts an onset before the downbeat, which is where a pickup sounds', () => {
    const upbeat = { pitch: 60, startBeat: -1, durationBeat: 1 };
    expect(() => assertNoteEvent(upbeat)).not.toThrow();
    expect(() => assertNoteEvents([upbeat])).not.toThrow();
    // A caller that knows how long its pickup is says so, and anything
    // starting before it is out of the piece rather than in the upbeat.
    expect(() => assertNoteEvent(upbeat, 'note', { minStartBeat: -1 })).not.toThrow();
    expect(() => assertNoteEvent(upbeat, 'note', { minStartBeat: 0 })).toThrow(RangeError);
    expect(() =>
      assertNoteEvent({ pitch: 60, startBeat: -2, durationBeat: 1 }, 'note', { minStartBeat: -1 }),
    ).toThrow(RangeError);
  });

  it('accepts a silent note only when the caller opts in', () => {
    const silent = { pitch: 60, startBeat: 0, durationBeat: 0 };
    expect(() => assertNoteEvent(silent, 'note', { allowNonPositiveDuration: true })).not.toThrow();
    // A non-finite field is still rejected under the same option.
    expect(() =>
      assertNoteEvent({ pitch: Number.NaN, startBeat: 0, durationBeat: 0 }, 'note', {
        allowNonPositiveDuration: true,
      }),
    ).toThrow(RangeError);
  });

  it('applies the caller budget to the event count', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      pitch: 60,
      startBeat: i,
      durationBeat: 1,
    }));
    expect(() => assertNoteEvents(many, 'events', { budget: 4 })).toThrow(RangeError);
    expect(() => assertNoteEvents(many, 'events', { budget: 5 })).not.toThrow();
  });

  it.each([
    [
      'bass style',
      () =>
        generateBassLine({
          segments: [{ startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') }],
          key: majorKey(0),
          style: 'nonsense' as never,
        }),
    ],
    [
      'bass segment span',
      () =>
        generateBassLine({
          segments: [{ startBeat: 4, endBeat: 4, chord: makeChord(0, 'maj') }],
          key: majorKey(0),
        }),
    ],
    [
      'countermelody melody',
      () =>
        generateCounterMelody({
          melody: [{ pitch: 60, startBeat: 0, durationBeat: Number.NaN }],
          key: majorKey(0),
          chordAt: () => makeChord(0, 'maj'),
        }),
    ],
    [
      'motif notes',
      () =>
        transformMotif(
          { notes: [{ pitch: Number.NaN, startBeat: 0, durationBeat: 1 }] },
          'retrograde',
        ),
    ],
    [
      'arrangement tracks',
      () =>
        analyzeArrangement([{ notes: [{ pitch: 60, startBeat: Number.NaN, durationBeat: 1 }] }]),
    ],
    [
      'event index',
      () => createNoteEventIndex([{ pitch: 60, startBeat: 0, durationBeat: 1, velocity: 999 }]),
    ],
  ])('rejects malformed input at the %s entry point', (_label, call) => {
    expect(call).toThrow(RangeError);
  });

  it('validates the compound branch of a grouping', () => {
    // 9/8 accepts both readings; a sum that is neither is rejected.
    expect(() =>
      assertTimeSignature({ numerator: 9, denominator: 8, grouping: [1, 1, 1] }),
    ).not.toThrow();
    expect(() =>
      assertTimeSignature({ numerator: 9, denominator: 8, grouping: [2, 2, 2, 3] }),
    ).not.toThrow();
    expect(() =>
      assertTimeSignature({ numerator: 9, denominator: 8, grouping: [2, 2, 2] }),
    ).toThrow(/pulses|units/);
    expect(() => assertTimeSignature({ numerator: 6, denominator: 8, grouping: [] })).toThrow(
      /must not be empty/,
    );
  });
});

/** The function a call sits in, named the way the coverage registry names it. */
function enclosingFunction(node: ts.Node): string {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isPropertyAssignment(current)) &&
      current.name !== undefined &&
      ts.isIdentifier(current.name)
    ) {
      return current.name.text;
    }
    if (
      (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) &&
      current.parent !== undefined &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
  }
  return 'top level';
}

/**
 * Every place in `src` that validates note events, as `file:function`.
 *
 * The tree is walked rather than listed, and the calling function is read from
 * the syntax tree rather than matched by shape, so a validating helper inside a
 * class or an object literal is found as surely as an exported function. This
 * is what makes the registry below trustworthy: a new consumer is discovered
 * because it exists, not because someone remembered to add a line for it.
 */
function noteEventCallSites(): string[] {
  const found: string[] = [];
  for (const file of filesUnder(SRC, '.ts')) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('assertNoteEvents(')) {
      continue;
    }
    const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'assertNoteEvents'
      ) {
        found.push(`${relative(ROOT, file).split(sep).join('/')}:${enclosingFunction(node)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  return [...new Set(found)].sort();
}

/**
 * The public entrances that carry each validating call into the matrix below.
 *
 * This registry is the one place a new consumer touches: the discovery walk
 * fails the suite until the call site it found appears here, and the entrances
 * named here are then exercised with malformed events and with zero-length
 * ones, so a bad imported MIDI event cannot bypass the shared contract
 * unnoticed.
 *
 * A row may name functions other than the one that validates. The public pair
 * delegates to an evidence-carrying implementation — `chordTimelineFromNotes`
 * to `analyzeTimeline` — a private helper is reached through the entrances that
 * call it, and a shared validator names every entrance that reaches it, since
 * each of them is a way in that the contract has to hold at.
 */
const NOTE_EVENT_VALIDATION_COVERAGE: Readonly<Record<string, readonly string[]>> = {
  'src/analyze/arrange/internal.ts:assertTrackNotes': ['analyzeArrangement', 'tensionCurve'],
  'src/analyze/arrange/session.ts:update': ['arrangementSessionUpdate'],
  'src/analyze/arrange/tracks.ts:analyzePolyphony': ['analyzePolyphony'],
  'src/analyze/detect/index.ts:detectKeyFromNotes': ['detectKeyFromNotes'],
  'src/analyze/form/hypermeter.ts:hypermeter': ['hypermeter'],
  'src/analyze/form/phrase.ts:phrasesFromTimeline': ['phrasesFromTimeline'],
  'src/analyze/form/section.ts:sectionsFromNotes': ['sectionsFromNotes'],
  'src/analyze/keys/index.ts:keyTimelineFromNotes': ['keyTimelineFromNotes'],
  'src/analyze/melody/internal.ts:orderedNotes': ['motifFromNotes'],
  'src/analyze/spelling/index.ts:spellLine': ['spellLine'],
  'src/analyze/timeline/index.ts:analyzeTimeline': ['chordTimelineFromNotes'],
  'src/analyze/voice/index.ts:analyzeVoice': ['analyzeVoice'],
  'src/analyze/voice/index.ts:toVoiceNotes': ['toVoiceNotes'],
  'src/core/event-index/index.ts:createNoteEventIndex': ['createNoteEventIndex'],
  'src/core/instrument/playability.ts:playability': ['playability'],
  'src/generate/countermelody/imitation.ts:imitate': ['imitate'],
  'src/generate/countermelody/index.ts:generateCounterMelody': ['generateCounterMelody'],
  'src/generate/groove/index.ts:applyGrooveTemplate': ['applyGrooveTemplate'],
  'src/generate/groove/index.ts:extractGrooveTemplate': ['extractGrooveTemplate'],
  'src/generate/groove/index.ts:humanize': ['humanize'],
  'src/generate/harmonize/index.ts:harmonizeMelody': ['harmonizeMelody'],
  'src/generate/harmonize/nct.ts:classifyMelodyTones': ['classifyMelodyTones'],
  // One reader for the three entrances that take a motif cell, so all three are
  // measured through it.
  'src/generate/motif/index.ts:assertCellNotes': [
    'developMotif',
    'motifToNoteEvents',
    'transformMotif',
  ],
  'src/generate/ornament/index.ts:ornament': ['ornament'],
  // One reader for the three class paths that keep a caller's array as what a
  // class is made of, so all three are measured by the entrances below.
  'src/model/shared.ts:assertNoteEventArray': ['arrangementOf', 'motifOf', 'scoreOf'],
};

/**
 * The entrances the registry may name, each called with the events under test.
 *
 * `tensionCurveFrom` validates through no call of its own: it is the wrapper
 * around an analysis the caller already holds, and it is kept here because the
 * contract it inherits is the one the matrix is about.
 */
function noteEventEntries(events: NoteEvent[]): Record<string, () => unknown> {
  const valid: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1 }];
  const fourFour = parseTimeSignature('4/4');
  const template = extractGrooveTemplate(valid, fourFour);
  const analysis = analyzeArrangement([{ notes: valid }]);
  const timeline = chordTimelineFromNotes(valid).timeline;
  const chord = makeChord(0, 'maj');
  const key = majorKey(0);
  return {
    analyzeArrangement: () => analyzeArrangement([{ notes: events }]),
    arrangementOf: () => Arrangement.of([{ notes: events }]),
    analyzePolyphony: () => analyzePolyphony(events, () => chord, key),
    analyzeVoice: () => analyzeVoice(events, () => chord, key),
    applyGrooveTemplate: () => applyGrooveTemplate(events, template, fourFour),
    arrangementSessionUpdate: () =>
      createArrangementSession([{ notes: valid }]).update([{ trackIndex: 0, notes: events }]),
    chordTimelineFromNotes: () => chordTimelineFromNotes(events),
    classifyMelodyTones: () => classifyMelodyTones(events, fourFour),
    createNoteEventIndex: () => createNoteEventIndex(events),
    detectKeyFromNotes: () => detectKeyFromNotes(events),
    developMotif: () => developMotif({ notes: events }, analysis.timeline, key, 1, '4/4'),
    extractGrooveTemplate: () => extractGrooveTemplate(events, fourFour),
    generateCounterMelody: () =>
      generateCounterMelody({ melody: events, key, chordAt: () => chord }),
    harmonizeMelody: () => harmonizeMelody({ melody: events, key }),
    humanize: () => humanize(events),
    hypermeter: () => hypermeter(events),
    imitate: () => imitate(events, { atBeat: 4, interval: 'P5', key }),
    keyTimelineFromNotes: () => keyTimelineFromNotes(events),
    motifFromNotes: () => motifFromNotes(events),
    motifOf: () => Motif.fromNotes(events),
    motifToNoteEvents: () => motifToNoteEvents({ notes: events }),
    ornament: () => ornament(events),
    phrasesFromTimeline: () => phrasesFromTimeline(timeline, events, { key }),
    playability: () => playability(events, GUITAR_STANDARD),
    scoreOf: () => Score.of(events),
    sectionsFromNotes: () => sectionsFromNotes(events),
    spellLine: () => spellLine(events, null, key),
    tensionCurve: () => tensionCurve([{ notes: events }]),
    tensionCurveFrom: () => tensionCurveFrom([{ notes: events }], analysis),
    toVoiceNotes: () => toVoiceNotes(events),
    transformMotif: () => transformMotif({ notes: events }, 'retrograde'),
  };
}

/** The entrances the registry names, deduplicated across shared validators. */
const COVERED_ENTRANCES = [...new Set(Object.values(NOTE_EVENT_VALIDATION_COVERAGE).flat())].sort();

describe('public NoteEvent validation entry points', () => {
  it('discovers every assertNoteEvents call site by walking src', () => {
    expect(noteEventCallSites()).toEqual(Object.keys(NOTE_EVENT_VALIDATION_COVERAGE).sort());
  });

  it('names an entrance the matrix can call for every discovered call site', () => {
    const entrances = new Set(Object.keys(noteEventEntries([])));
    expect(COVERED_ENTRANCES.filter((name) => !entrances.has(name))).toEqual([]);
    // Everything the matrix runs is either a registered call site or the
    // documented wrapper around one.
    expect([...entrances].filter((name) => !COVERED_ENTRANCES.includes(name))).toEqual([
      'tensionCurveFrom',
    ]);
  });

  it.each([
    ['NaN pitch', { pitch: Number.NaN, startBeat: 0, durationBeat: 1 }],
    ['infinite pitch', { pitch: Number.POSITIVE_INFINITY, startBeat: 0, durationBeat: 1 }],
    ['out-of-range pitch', { pitch: 128, startBeat: 0, durationBeat: 1 }],
  ])('rejects %s at every registered public entrance', (_label, event) => {
    for (const [name, entry] of Object.entries(noteEventEntries([event]))) {
      expect(entry, name).toThrow(RangeError);
    }
  });

  it('applies the documented zero-length policy at every public entrance', () => {
    const entries = noteEventEntries([{ pitch: 60, startBeat: 0, durationBeat: 0 }]);
    const rejectsSilentNotes = new Set([
      'createNoteEventIndex',
      'developMotif',
      // A cell is written material: a note that never sounds would be tiled and
      // transformed as though it were one.
      'motifOf',
      'motifToNoteEvents',
      'transformMotif',
    ]);
    for (const [name, entry] of Object.entries(entries)) {
      if (rejectsSilentNotes.has(name)) {
        expect(entry, name).toThrow(RangeError);
      } else {
        expect(entry, name).not.toThrow();
      }
    }
  });
});

/**
 * Paths to every value reachable from a public constant that a caller could
 * still write to.
 *
 * @param value The value to inspect.
 * @param path Dotted path to it, for the failure message.
 * @param seen Objects already inspected, so a shared entry is reported once and
 *   a cyclic table terminates.
 * @returns The paths of the unfrozen values, empty when the table is frozen
 *   through.
 */
function unfrozenUnder(value: unknown, path: string, seen: WeakSet<object>): string[] {
  if (value === null || typeof value !== 'object') {
    return [];
  }
  const object = value as object;
  if (seen.has(object)) {
    return [];
  }
  seen.add(object);
  const out = Object.isFrozen(object) ? [] : [path];
  for (const [key, child] of Object.entries(object)) {
    out.push(...unfrozenUnder(child, `${path}.${key}`, seen));
  }
  return out;
}

describe('lookup tables cannot be reached through the prototype chain', () => {
  it('rejects an inherited property name as a scale', () => {
    for (const name of [
      'bogus',
      'toString',
      'constructor',
      '__proto__',
      'valueOf',
      'hasOwnProperty',
    ]) {
      expect(() => scaleByName(name, 0), name).toThrow();
    }
  });

  it('rejects an inherited property name as a chord quality', () => {
    for (const suffix of ['bogus', 'toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      expect(() => parseChordSymbol(`C${suffix}`), suffix).toThrow();
    }
    expect(() => makeChord(0, 'toString' as never)).toThrow();
  });

  it('leaves every public constant table frozen through', () => {
    // Derived from what the package actually exports rather than from a list of
    // names kept by hand, so a table added later is covered on the same commit.
    const tables = Object.entries(api).filter(([name]) => /^[A-Z0-9_]+$/.test(name));
    // The filter has to find the tables at all, or the assertion below would
    // hold over an empty list.
    expect(tables.length).toBeGreaterThanOrEqual(9);
    const seen = new WeakSet<object>();
    const unfrozen = tables.flatMap(([name, table]) => unfrozenUnder(table, name, seen));
    expect(unfrozen).toEqual([]);
  });

  it('leaves the public enums frozen while keeping their reverse mapping', () => {
    const enums = [
      ['ConsonanceClass', ConsonanceClass, 'Dissonance'],
      ['NoteSafety', NoteSafety, 'Dissonant'],
      ['ReasonFlag', ReasonFlag, 'ChordTone'],
    ] as const;
    for (const [name, table, member] of enums) {
      expect(Object.isFrozen(table), name).toBe(true);
      expect(() => {
        (table as unknown as Record<string, number>)[member] = 99;
      }, name).toThrow(TypeError);
    }
    // Freezing an enum must not cost the name lookup a numeric enum carries.
    expect(ConsonanceClass[ConsonanceClass.Dissonance]).toBe('Dissonance');
    expect(NoteSafety[NoteSafety.Warning]).toBe('Warning');
    expect(ReasonFlag[ReasonFlag.Tritone]).toBe('Tritone');
  });
});

describe('additive metres stay expressible', () => {
  it('accepts a grouping in denominator units for a compound numerator', () => {
    const aksak: TimeSignature = { numerator: 9, denominator: 8, grouping: [2, 2, 2, 3] };
    expect(() => assertTimeSignature(aksak)).not.toThrow();
    expect(pulsesPerBar(aksak)).toBe(9);
    expect(isCompound(aksak)).toBe(false);
    // Group heads land on the 1st, 3rd, 5th and 7th quavers.
    expect(metricWeight(0, aksak)).toBe(3);
    expect(metricWeight(1, aksak)).toBe(2);
    expect(metricWeight(0.5, aksak)).toBe(1);
  });

  it('still accepts a grouping of the compound pulses', () => {
    const nine: TimeSignature = { numerator: 9, denominator: 8, grouping: [1, 1, 1] };
    expect(pulsesPerBar(nine)).toBe(3);
    expect(isCompound(nine)).toBe(true);
  });

  it('keeps pulse counts exact for a denominator that does not divide evenly', () => {
    const odd: TimeSignature = { numerator: 7, denominator: 12 };
    expect(pulsesPerBar(odd)).toBe(7);
    expect(() => metricWeight(0, odd)).not.toThrow();
  });
});

describe('generation budget is caller-adjustable', () => {
  const notes = Array.from({ length: 40 }, (_, i) => ({
    pitch: 60,
    startBeat: i,
    durationBeat: 1,
  }));

  it('rejects work beyond an explicit budget and accepts it beyond the default', () => {
    // The budget measures the candidates the boundary search weighs, and the
    // search weighs the whole chord lexicon against every slot of the span, so
    // forty beats of music is thousands of candidates rather than forty.
    expect(() => chordTimelineFromNotes(notes, { budget: 8 })).toThrow(RangeError);
    expect(() => chordTimelineFromNotes(notes, { budget: 10_000 })).not.toThrow();
    expect(() =>
      analyzeArrangement([{ name: 'a', role: 'harmony', notes }], { budget: 8 }),
    ).toThrow(RangeError);
  });
});

describe('silent notes across the pipeline', () => {
  /** A track carrying the zero-length artefacts a MIDI import routinely leaves. */
  function withArtefacts(): NoteEvent[] {
    return [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 62, startBeat: 1, durationBeat: 0 },
      { pitch: 64, startBeat: 1, durationBeat: 1 },
      { pitch: 67, startBeat: 2, durationBeat: -1 },
      { pitch: 65, startBeat: 2, durationBeat: 2 },
    ];
  }

  it('drops them everywhere rather than throwing in half the library', () => {
    const notes = withArtefacts();
    // The analysis side accepts them...
    const analysis = analyzeArrangement([{ notes }]);
    expect(analysis.tracks[0]?.notes).toHaveLength(3);
    // ...and so does every generation entry point that takes note events.
    expect(() => humanize(notes)).not.toThrow();
    expect(humanize(notes)).toHaveLength(3);
    const ts = parseTimeSignature('4/4');
    expect(() => extractGrooveTemplate(notes, ts, 4)).not.toThrow();
    expect(() => applyGrooveTemplate(notes, extractGrooveTemplate(notes, ts, 4), ts)).not.toThrow();
    expect(
      generateCounterMelody({
        melody: notes,
        key: majorKey(0),
        chordAt: () => makeChord(0, 'maj'),
      }),
    ).not.toHaveLength(0);
    const harmonized = harmonizeMelody({
      melody: notes,
      key: majorKey(0),
      harmonicRhythm: 4,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(harmonized.chords.length).toBeGreaterThan(0);
  });

  it('exposes the same filter the library applies', () => {
    expect(dropSilentNotes(withArtefacts())).toHaveLength(3);
    expect(dropSilentNotes([])).toEqual([]);
  });
});

describe('generator MIDI-output contract', () => {
  const allMidi = (notes: readonly NoteEvent[]) =>
    notes.every((note) => Number.isInteger(note.pitch) && note.pitch >= 0 && note.pitch <= 127);

  it('keeps counter melodies, motifs, and bass lines in range under extreme valid inputs', () => {
    const counter = generateCounterMelody({
      melody: [{ pitch: 10, startBeat: 0, durationBeat: 4 }],
      chordAt: () => makeChord(0, 'maj'),
      key: majorKey(0),
      pitchLow: 200,
      pitchHigh: 220,
    });
    const motif = generateMotif({ key: majorKey(0), bars: 40, contour: 'ascending' });
    const bass = generateBassLine({
      segments: [{ startBeat: 0, endBeat: 4, chord: makeChord(11, 'maj') }],
      key: majorKey(0),
      octave: 8,
      style: 'arpeggio',
    });

    expect(allMidi(counter)).toBe(true);
    expect(allMidi(motif.notes)).toBe(true);
    expect(allMidi(bass)).toBe(true);
    const generated = [...counter, ...motif.notes, ...bass];
    expect(() => analyzeArrangement([{ notes: humanize(generated) }])).not.toThrow();
    expect(() => transformMotif(motif, 'transposeChromatic', 0.5)).toThrow(RangeError);
  });
});
