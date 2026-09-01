import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import {
  Chord,
  Composer,
  InvalidInputError,
  Key,
  type KeyLike,
  Motif,
  majorKey,
  Note,
  Progression,
  Score,
  Timeline,
  Voicing,
} from '../src/index.js';
import { recordFields } from './support/signatures.js';
import { filesUnder, SRC } from './support/source-files.js';

/**
 * The interoperability table promises that a key reaches every entry point in
 * whatever form the caller is holding it. The methods are derived from the
 * sources rather than listed here, so a new key-taking method joins the
 * contract without anybody remembering to add it.
 */

/**
 * The three forms of one key the interoperability table names.
 *
 * All three name C major, and that is a known limit of what these forms can
 * measure. The three agree on a tonic, so the defect class where the caller's
 * spelling is dropped — `'Ab minor'` coming back as the G# minor its pitch
 * classes read best as — is invisible here whatever a method does with it.
 * Adding a remote key needs a second axis first: the forms that carry a
 * spelling agree with each other and with the resolver, and differ from the
 * bare scale, which is the correct behaviour rather than a violation. Until
 * that axis exists, the spelling seam is guarded by name — the modules that
 * call `spelledKeyOf` — and a module deriving a written tonic under another
 * name is measured by neither.
 */
const KEY_FORMS: readonly KeyLike[] = ['C major', majorKey(0), Key.major('C')];

/** The same three forms of another key, for a method that moves between keys. */
const OTHER_KEY_FORMS: readonly KeyLike[] = ['Eb major', majorKey(3), Key.major('Eb')];

/** A public method of a model class that takes a key in some argument. */
type KeyMethod = { className: string; method: string };

/**
 * Every public model method whose signature mentions the key coercion type.
 *
 * The declaration is read up to the start of its body, which is where the
 * parameter list ends, so a `KeyLike` in a return type or a comment further
 * down does not enrol a method that takes no key.
 */
function keyTakingMethods(): KeyMethod[] {
  const found: KeyMethod[] = [];
  for (const file of filesUnder(path.join(SRC, 'model'), '.ts')) {
    const source = readFileSync(file, 'utf8');
    const className = source.match(/^export class (\w+)/m)?.[1];
    if (className === undefined) {
      continue;
    }
    for (const match of source.matchAll(/\n {2}(static )?([a-zA-Z_$][\w$]*)\(/g)) {
      const rest = source.slice(match.index);
      const head = rest.slice(0, rest.indexOf('{') + 1);
      if (/\bKeyLike\b/.test(head)) {
        found.push({ className, method: `${match[1] === undefined ? '' : 'static '}${match[2]}` });
      }
    }
  }
  return found;
}

/** How one key-taking method is called, with the key left to the harness. */
type Invocation = (key: KeyLike) => unknown;

const CHORD_DATA = Chord.of('D', 'min7').toJSON();
const CADENCE = [Chord.parse('G7'), Chord.parse('C')];
const SPANS = [
  { rootPc: 7, quality: 'dom7' as const, startBeat: 0 },
  { rootPc: 0, quality: 'maj' as const, startBeat: 4 },
];
const MELODY = [
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
  { pitch: 65, startBeat: 3, durationBeat: 1 },
];
const MOTIF = Motif.fromNotes(MELODY);
const HARMONY = Timeline.fromChords(SPANS, 8);

/**
 * One call per key-taking method, with the key left out. The set of methods is
 * derived; only the arguments around the key are written here, because there is
 * no deriving what a chord or a cantus firmus should be.
 */
const INVOCATIONS: Readonly<Record<string, Invocation>> = {
  'Chord.constructor': (key) => new Chord(CHORD_DATA, key).spell(),
  'Chord.static fromFiguredBass': (key) => Chord.fromFiguredBass('B', '6', key).symbol(),
  'Chord.withKey': (key) => Chord.of(2, 'min7').withKey(key).spell(),
  'Chord.roman': (key) => Chord.parse('G7').roman(key),
  'Chord.explain': (key) => Chord.parse('D7').explain(key, { alternatives: true }),
  'Chord.function': (key) => Chord.parse('G7').function(key),
  'Chord.analyze': (key) => Chord.parse('D7').analyze(key),
  'Chord.isBorrowed': (key) => Chord.parse('Ab').isBorrowed(key),
  'Chord.borrowedSource': (key) => Chord.parse('Ab').borrowedSource(key),
  'Chord.figuredBass': (key) => Chord.parse('G/B').figuredBass(key),
  'Chord.substitutions': (key) => Chord.parse('G7').substitutions(key),
  'Chord.modalInterchange': (key) => Chord.parse('C').modalInterchange(key),
  'Chord.negativeHarmony': (key) => Chord.parse('G7').negativeHarmony(key).symbol(),
  'Chord.spell': (key) => Chord.of(2, 'min7').spell(key),
  'Composer.withKey': (key) => new Composer({ seed: 7 }).withKey(key).toJSON(),
  'Key.static of': (key) => Key.of(key).toString(),
  'Key.pivotsTo': (key) => Key.major('C').pivotsTo(key),
  'Motif.transform': (key) => MOTIF.transform('transposeDiatonic', 1, key),
  'Motif.develop': (key) => MOTIF.develop(HARMONY, key, 2, '4/4'),
  'Motif.relateTo': (key) => MOTIF.transform('invert', undefined, key).relateTo(MOTIF, key),
  'Note.degreeIn': (key) => Note.parse('E4').degreeIn(key),
  'Progression.constructor': (key) => new Progression(CADENCE, key).roman(),
  'Progression.static of': (key) => Progression.of(CADENCE, key).roman(),
  'Progression.static fromSpans': (key) => Progression.fromSpans(SPANS, key).roman(),
  'Progression.withKey': (key) => new Progression(CADENCE).withKey(key).roman(),
  'Progression.roman': (key) => new Progression(CADENCE).roman(key),
  'Progression.functions': (key) => new Progression(CADENCE).functions(key),
  'Progression.analyze': (key) => new Progression(CADENCE).analyze(key),
  'Progression.cadences': (key) => new Progression(CADENCE).cadences(key),
  'Progression.transposeTo': (key) =>
    new Progression(CADENCE, 'G major').transposeTo(key).toString(),
  'Score.withKey': (key) => Score.of(MELODY).withKey(key).key()?.toString(),
  'Score.voices': (key) => Score.of(MELODY).voices(key),
  'Timeline.static fromChords': (key) => Timeline.fromChords(SPANS, 8, key),
  'Timeline.roman': (key) => HARMONY.roman(key),
  'Voicing.spell': (key) => Voicing.of([50, 57, 66, 69]).spell(key),
  'Voicing.checkTo': (key) =>
    Voicing.of([48, 55, 64, 72]).checkTo(Voicing.of([50, 57, 65, 69]), ['C', 'Dm'], key),
  'Voicing.species': (key) =>
    Voicing.of([72, 69, 67, 71, 72]).species(['C4', 'D4', 'E4', 'D4', 'C4'], 1, key),
};

/** Methods whose key is a destination rather than the key to read in. */
const TRANSPOSING = new Set(['Progression.transposeTo']);

/** A comparable rendering of whatever a method hands back. */
function snapshot(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

describe('every public method that takes a key takes it in any form', () => {
  const methods = keyTakingMethods();

  it('finds the key-taking methods to check', () => {
    expect(methods.length).toBeGreaterThan(20);
  });

  it('has a call written for each one', () => {
    const missing = methods
      .map(({ className, method }) => `${className}.${method}`)
      .filter((name) => INVOCATIONS[name] === undefined);
    expect(missing).toEqual([]);
  });

  for (const { className, method } of keyTakingMethods()) {
    const name = `${className}.${method}`;
    it(`reads a name, a key/scale and a Key alike in ${name}`, () => {
      const invoke = INVOCATIONS[name];
      if (invoke === undefined) {
        return;
      }
      const forms = TRANSPOSING.has(name) ? OTHER_KEY_FORMS : KEY_FORMS;
      const results = forms.map((form) => snapshot(invoke(form)));
      expect(results[1]).toBe(results[0]);
      expect(results[2]).toBe(results[0]);
    });
  }
});

/**
 * Type names by which the library names a record of caller input.
 *
 * A key field on one of these is an entry point's argument written as a field,
 * and the contract that holds for a key parameter holds for it: an options bag
 * is otherwise the way around the rule. Result types are deliberately not read
 * here — a key a result *reports* answers the opposite rule, which is that it
 * carries the whole key it worked in rather than every form one arrives in.
 */
const INPUT_RECORD = /(?:Options|Query|Settings|Input)$/;

/**
 * The forms that admit every shape a caller holds a key in.
 *
 * `KeyContext` is `KeyLike` widened again, with a per-beat function for a
 * passage that modulates, so a field declaring it asks for no reduction.
 */
const WIDE_KEY = /\bKeyLike\b|\bKeyContext\b/;

/**
 * Key fields on a caller's record that still ask for the narrow form.
 *
 * Each line is a place a caller holding a `Key` has to reduce it before the
 * call. Short by design: a field added here without a reason is the rule being
 * worked around rather than met.
 */
const NARROW_KEY_FIELD: readonly string[] = [
  // The one question the safety evaluator asks of the key is whether a pitch is
  // in the scale, and what it reports is a verdict, a set of reason flags and
  // alternative pitches — no spelling reaches the answer, so none is lost by
  // the reduction. The class API takes the wide form on the caller's behalf:
  // `VoicingSafetyQuery.key` is declared `KeyLike` and resolved before this
  // record is built.
  'src/theory/safety/index.ts:SafetyQuery.key',
];

describe('a key a caller fills into a record', () => {
  const fields = recordFields()
    .filter((field) => field.exported && INPUT_RECORD.test(field.record))
    .filter((field) => field.field === 'key');

  it('reads a subject the tree supplies rather than a list', () => {
    expect(fields.length).toBeGreaterThan(10);
  });

  it('declares it in the wide form', () => {
    const narrow = fields
      .filter((field) => !WIDE_KEY.test(field.type))
      .filter((field) => !NARROW_KEY_FIELD.includes(`${field.file}:${field.record}.${field.field}`))
      .map((field) => `${field.file}:${field.line} ${field.record}.${field.field}: ${field.type}`)
      .sort();

    expect(narrow).toEqual([]);
  });

  it('holds no allowance for a field that no longer offends', () => {
    const offending = new Set(
      fields
        .filter((field) => !WIDE_KEY.test(field.type))
        .map((field) => `${field.file}:${field.record}.${field.field}`),
    );
    const stale = NARROW_KEY_FIELD.filter((site) => !offending.has(site));

    expect(stale).toEqual([]);
  });
});

describe('a key argument that names no key', () => {
  it('names the caller’s own parameter when an options bag arrives instead', () => {
    expect(() => Chord.parse('D7').explain({ alternatives: true } as never)).toThrow(
      /chord key must be a Key; received an object/,
    );
    expect(() => Chord.parse('D7').roman({ applied: true } as never)).toThrow(
      /chord key must be a Key; received an object/,
    );
    expect(() => new Progression(CADENCE).analyze({ alternatives: true } as never)).toThrow(
      /progression key must be a Key; received an object/,
    );
  });

  it('refuses a key-shaped value that resolves to no key', () => {
    expect(() => Chord.parse('D7').spell('invalid' as never)).toThrow(InvalidInputError);
    expect(() => Chord.parse('D7').spell(null as never)).toThrow(InvalidInputError);
    expect(() => Chord.parse('D7').spell({ scale: null } as never)).toThrow(InvalidInputError);
    expect(() => Chord.parse('D7').roman('H sharp major')).toThrow(InvalidInputError);
  });

  it('falls back to the carried key when none is passed', () => {
    expect(Chord.parse('G7').withKey('C major').roman()).toBe('V7');
    expect(() => Chord.parse('G7').roman()).toThrow(InvalidInputError);
  });
});

describe('a key reaches the scale functions in any form', () => {
  it('answers the scale-degree questions alike', () => {
    expect(api.isScaleTone(62, Key.major('C'))).toBe(true);
    expect(api.isScaleTone(62, 'C major')).toBe(true);
    expect(api.isScaleTone(61, Key.major('C'))).toBe(false);
    expect(api.diatonicPitchClasses(Key.major('C'))).toEqual(api.diatonicPitchClasses(majorKey(0)));
    expect(api.scaleTonesInDegreeOrder('C major')).toEqual(
      api.scaleTonesInDegreeOrder(majorKey(0)),
    );
    expect(api.diatonicPitchClasses('C major')).not.toEqual([]);
  });

  it('spells a scale from a name, a key/scale and a Key alike', () => {
    const fromData = api.noteNames(api.spellScale('C', majorKey(0)));
    expect(api.noteNames(api.spellScale('C', 'C major'))).toEqual(fromData);
    expect(api.noteNames(api.spellScale('C', Key.major('C')))).toEqual(fromData);
    expect(fromData).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  });

  it('returns one note per scale tone, never an empty scale', () => {
    for (const scale of ['major', 'harmonicMinor', 'minorPentatonic', 'blues', 'wholeTone']) {
      const key = Key.named(scale as never, 'C');
      const degrees = api.spellScale('C', key);
      const tones = key.scale.modeMask12.toString(2).replace(/0/g, '').length;
      expect(degrees.length, scale).toBe(tones);
    }
  });

  it('names the parameter that is wrong', () => {
    expect(() => api.spellScale('C', 'not a key' as never)).toThrow(InvalidInputError);
    expect(() => api.spellScale('D', 'C major')).toThrow(/tonic/);
  });
});

describe('a key never claims a scale form its mask does not hold', () => {
  it('refuses a variant the mask does not support', () => {
    const majorScale = majorKey(0);
    expect(() =>
      Key.fromJSON({ scale: majorScale, tonic: { letter: 0, alter: 0 }, variant: 'harmonic' }),
    ).toThrow(InvalidInputError);
    expect(() =>
      Key.fromData({ scale: majorScale, tonic: { letter: 0, alter: 0 }, variant: 'melodic' }),
    ).toThrow(/variant melodic does not match the scale mask/);
    expect(() => new Key(majorScale, Note.parse('C'), 'natural')).toThrow(InvalidInputError);
    expect(() => new Key(api.scaleByName('harmonicMinor', 0), Note.parse('C'), 'major')).toThrow(
      InvalidInputError,
    );
    expect(() => new Key(majorScale, Note.parse('C'), 'modal')).toThrow(InvalidInputError);
    expect(() => new Key(majorScale, Note.parse('C'), 'unknown' as never)).toThrow(
      InvalidInputError,
    );
  });

  it('keeps the variants their mask does support, through a round trip', () => {
    const pairs = [
      ['major', majorKey(0)],
      ['natural', api.scaleByName('naturalMinor', 0)],
      ['harmonic', api.scaleByName('harmonicMinor', 0)],
      ['melodic', api.scaleByName('melodicMinor', 0)],
      ['modal', api.scaleByName('dorian', 0)],
    ] as const;
    for (const [variant, scale] of pairs) {
      const key = new Key(scale, Note.parse('C'), variant);
      expect(key.variant, variant).toBe(variant);
      expect(Key.fromJSON(key.toJSON()).toString(), variant).toBe(key.toString());
    }
  });
});

describe('the scale barrel is reachable from the package root', () => {
  /** The names one barrel file re-exports, values and types alike. */
  function exportedNames(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    const names: string[] = [];
    for (const block of source.matchAll(/export (?:type )?\{([^}]*)\}\s*from/g)) {
      for (const entry of (block[1] ?? '').split(',')) {
        const name = entry
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0];
        if (name !== undefined && name.length > 0) {
          names.push(name);
        }
      }
    }
    return names;
  }

  const scaleBarrel = path.join(SRC, 'theory', 'scale', 'index.ts');
  const theoryBarrel = path.join(SRC, 'theory', 'index.ts');

  it('re-exports every scale symbol from the theory barrel', () => {
    const reachable = new Set(exportedNames(theoryBarrel));
    const missing = exportedNames(scaleBarrel).filter((name) => !reachable.has(name));
    expect(missing).toEqual([]);
  });

  it('reaches every scale value from the package root', () => {
    const source = readFileSync(scaleBarrel, 'utf8');
    const values = exportedNames(scaleBarrel).filter(
      (name) => !new RegExp(`export type \\{[^}]*\\b${name}\\b`, 's').test(source),
    );
    const missing = values.filter((name) => !(name in api));
    expect(missing).toEqual([]);
    expect(values).toContain('isSignatureKey');
  });
});
