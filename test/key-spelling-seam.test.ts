import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { augmentedSixthChord, spellLine } from '../src/analyze/index.js';
import { formatNote, parseNote } from '../src/core/pitch/index.js';
import * as api from '../src/index.js';
import { Key } from '../src/model/key.js';
import { Voicing } from '../src/model/voicing.js';
import { makeChord } from '../src/theory/chord/index.js';
import { figuredBassRealization } from '../src/theory/figured-bass/index.js';
import { spellVoicing } from '../src/theory/partwriting/index.js';
import { type ResolvedKey, resolveKey } from '../src/theory/scale/index.js';
import { toChordData } from '../src/theory/symbol/index.js';
import { TRANSPOSING_INSTRUMENTS } from '../src/theory/transposition/index.js';
import { functionParams, type ParamInfo, sourceFiles } from './support/signatures.js';
import { filesUnder, SRC } from './support/source-files.js';

/**
 * A key crosses into the library carrying the tonic it is written on, and every
 * letter the answer is spelled with is derived from that tonic.
 *
 * The keys that make this visible are the ones whose pitch classes read best
 * from the other side of the circle: an A flat minor and a G sharp minor sound
 * alike, so a layer that reduces a key to its pitch classes and spells one back
 * hands an A flat minor exercise the sharps of a G sharp minor — or, where the
 * two sides differ by more than that, the double accidentals that make a chord
 * unbuildable.
 */

/** The keys whose written spelling differs from the one their pitches read as. */
const FAR_SIDE_KEYS = [
  'F# major',
  'C# major',
  'Cb major',
  'Gb major',
  'Ab minor',
  'D# minor',
  'A# minor',
] as const;

/** Every pitch class, for the sweeps that have to cover the whole circle. */
const PITCH_CLASSES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Widest signature a key is written with, in either direction. */
const MAX_CONVENTIONAL_FIFTHS = 7;

describe('a key is spelled by the tonic it was handed in with', () => {
  it('realizes an unfigured bass on the tonic as that key own triad', () => {
    const realized = figuredBassRealization(parseNote('F#'), '', 'F# major');
    expect(realized.notes.map((note) => formatNote(note))).toEqual(['F#', 'A#', 'C#']);
  });

  it('builds a triad in every key the library can spell', () => {
    for (const name of FAR_SIDE_KEYS) {
      const key = Key.parse(name);
      const expected = [1, 3, 5].map((degree) => key.degree(degree).name);
      const realized = figuredBassRealization(key.tonic.data, '', key);
      expect(
        realized.notes.map((note) => formatNote(note)),
        name,
      ).toEqual(expected);
    }
  });

  it('spells a line with the letters the key writes its own scale with', () => {
    const key = Key.parse('Ab minor');
    const spelled = spellLine(
      [60, 61, 63, 65, 68].map((pitch, index) => ({ pitch, startBeat: index, durationBeat: 1 })),
      null,
      key,
    );
    // A flat-side key writes its accidentals as flats: read from the pitch
    // classes instead, the same five notes come back as the sharps of G# minor.
    for (const note of spelled) {
      expect(note.alter, formatNote(note)).toBeLessThanOrEqual(0);
    }
    // The tonic is spelled as the key spells its own tonic.
    expect(formatNote({ letter: spelled[4]?.letter ?? 0, alter: spelled[4]?.alter ?? 0 })).toBe(
      key.tonic.name,
    );
  });

  it('spells an augmented sixth on the flat side of a flat-side key', () => {
    const spelled = Key.parse('Ab minor')
      .augmentedSixth('german')
      .spell()
      .map((note) => note.name);
    expect(spelled).toEqual(['Fb', 'Ab', 'Cb', 'D']);
    const sharpSide = augmentedSixthChord('german', 'F# major');
    expect(sharpSide.toneSpellings?.map((tone) => formatNote(tone))).toEqual([
      'D',
      'F#',
      'A',
      'B#',
    ]);
  });

  it('spells a voicing the same through the class and through the function', () => {
    const pitches = [54, 61, 66, 70];
    for (const pc of PITCH_CLASSES) {
      for (const key of [Key.major(pc), Key.minor(pc)]) {
        for (const symbol of ['F#', 'Gb', 'C', 'Ab']) {
          const chord = toChordData(symbol);
          const viaClass = Voicing.of(pitches)
            .spell(key, symbol)
            .map((note) => note.name);
          const viaFunction = spellVoicing(pitches, chord, key).map((note) => formatNote(note));
          expect(viaClass, `${key} ${symbol}`).toEqual(viaFunction);
        }
      }
    }
  });
});

describe('a key the library derives itself is one that can be written', () => {
  it('keeps a key taken from a scale degree inside the written signatures', () => {
    for (const name of ['blues', 'majorPentatonic', 'minorPentatonic', 'wholeTone', 'major']) {
      for (const pc of PITCH_CLASSES) {
        const key = Key.named(name, pc);
        for (let degree = 1; degree <= key.pitchClasses().length; degree += 1) {
          const derived = key.keyOnDegree(degree);
          expect(Math.abs(derived.fifths), `${key} degree ${degree}`).toBeLessThanOrEqual(
            MAX_CONVENTIONAL_FIFTHS,
          );
        }
      }
    }
  });

  it('writes a transposing part in a signature a player is handed', () => {
    for (const instrument of Object.keys(TRANSPOSING_INSTRUMENTS)) {
      for (const pc of PITCH_CLASSES) {
        for (const key of [Key.major(pc), Key.minor(pc), Key.parse('Cb major')]) {
          const part = key.forInstrument(instrument as keyof typeof TRANSPOSING_INSTRUMENTS);
          expect(Math.abs(part.fifths), `${key} on ${instrument}`).toBeLessThanOrEqual(
            MAX_CONVENTIONAL_FIFTHS,
          );
          expect(part.tonic.pitchClass, `${key} on ${instrument}`).toBe(part.scale.rootPc);
        }
      }
    }
    expect(Key.parse('F# major').forInstrument('clarinetBb').toString()).toBe('Ab major');
  });
});

/**
 * The convention read off the tree rather than off a list.
 *
 * Reducing a key to its pitch classes stays allowed — a function that asks only
 * which pitches are in the scale needs nothing else, and says so at the place it
 * reduces. What is not allowed is reducing a key and then deriving a tonic back
 * from what is left: that pair is where the caller's A flat minor becomes a G
 * sharp minor, and it is the shape every defect in this area has. So the tonic
 * is derived in exactly one place, the resolver, and an entry point that needs
 * one asks the resolver for it.
 *
 * The subject comes from the declarations, so an entry point added tomorrow is
 * held to the rule without anybody remembering it here.
 */
describe('a key reaching an entry point goes through the one resolver', () => {
  /** Entry points are the functions a caller can reach from the package root. */
  const reachable: ReadonlySet<string> = new Set(
    Object.entries(api as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name),
  );

  /** The source text of each file, indexed the way a parameter names its file. */
  const textByFile = new Map<string, string>(
    sourceFiles().map((file) => [
      path.relative(path.dirname(SRC), file).split(path.sep).join('/'),
      readFileSync(file, 'utf8'),
    ]),
  );

  /** A call to a function, ignoring the doc comments that merely name it. */
  function callsInto(text: string, fn: string): boolean {
    return text
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/)/.test(line))
      .some((line) => new RegExp(`\\b${fn}\\(`).test(line));
  }

  const keyParams: ParamInfo[] = functionParams().filter(
    (param) => param.exported && reachable.has(param.fn) && /\bKeyLike\b/.test(param.type),
  );

  /**
   * The modules that may spell a tonic from bare pitch classes, each with why.
   *
   * Short by design: a module added here without such a reason is a second
   * answer to "how is this key written", which is the split the resolver exists
   * to prevent.
   */
  const SPELLS_ITS_OWN_TONIC: readonly string[] = [
    // Where the reading lives: this is the resolver's own bare-scale branch.
    'src/theory/scale/identity.ts',
    // The function being defined, and the doc examples beside it.
    'src/theory/scale/relations.ts',
    // The key was built here out of pitch classes the detector weighed, so
    // there is no caller's spelling for the reading to lose.
    'src/analyze/detect/index.ts',
  ];

  it('derives a tonic in one place only', () => {
    const offenders = [...textByFile.entries()]
      .filter(([, text]) => callsInto(text, 'spelledKeyOf'))
      .map(([file]) => file)
      .filter((file) => !SPELLS_ITS_OWN_TONIC.includes(file));

    expect(offenders).toEqual([]);
  });

  it('holds no allowance for a module that no longer spells its own tonic', () => {
    const stale = SPELLS_ITS_OWN_TONIC.filter(
      (file) => !callsInto(textByFile.get(file) ?? '', 'spelledKeyOf'),
    );

    expect(stale).toEqual([]);
  });

  it('never derives a tonic inside an entry point that was handed a key', () => {
    const violations = keyParams
      .filter((param) => callsInto(textByFile.get(param.file) ?? '', 'spelledKeyOf'))
      .filter((param) => !SPELLS_ITS_OWN_TONIC.includes(param.file))
      .map(
        (param) =>
          `${param.file}:${param.line} ${param.fn}(${param.param}) spells a tonic of its own instead of resolving the key`,
      );

    expect(violations).toEqual([]);
  });

  it('reads a subject the tree supplies rather than a list', () => {
    // Without this the checks above would pass by measuring nothing at all.
    expect(keyParams.length).toBeGreaterThan(30);
    expect(textByFile.size).toBeGreaterThan(50);
  });
});

/**
 * The same convention measured by what the entry points answer rather than by
 * what they call it.
 *
 * The checks above read the tree for one name. A second derivation written
 * under another name is invisible to them, and that is exactly how one grew: a
 * private tonic speller sat beside the resolver and wrote the borrowed chords
 * of an A flat minor with double sharps, because it was not called
 * `spelledKeyOf`.
 *
 * This asks the entry points instead. An A flat minor and a G sharp minor are
 * one set of pitch classes and two sets of letters, so an entry point that
 * hands back letters has to hand back different ones for the two. An entry
 * point that reduces its key and derives a tonic back from what is left — under
 * any name at all — answers both alike, and fails here.
 *
 * The subject is what the package root exports, so an entry point written
 * tomorrow is measured without anybody listing it here.
 */
describe('an entry point spells its answer from the key it was handed', () => {
  /** One sound, written on the two sides of the circle that name it. */
  const ENHARMONIC_KEYS = ['Ab minor', 'G# minor'] as const;

  /** What to pass for one parameter of an entry point being measured. */
  type Recipe = (key: ResolvedKey) => unknown;

  /**
   * What to pass for a parameter beside the key, by the type it declares.
   *
   * A recipe reads the key, so an argument that has to agree with it — a tonic,
   * a bass — follows the key being measured instead of pinning the answer to
   * one spelling of its own.
   */
  const BY_TYPE: Readonly<Record<string, Recipe>> = {
    AugmentedSixthKind: () => 'german',
    // The key's own tonic triad, carrying no spelling of its own: a chord that
    // brought one would answer in its own letters whatever the key said.
    Chord: (key) => makeChord(key.scale.rootPc, 'maj'),
    ChordLike: (key) => makeChord(key.scale.rootPc, 'maj'),
    ChordQuality: () => 'maj',
    'ChordTimeline | null': () => null,
    KeyLike: (key) => key,
    Note: (key) => ({ ...key.tonic, octave: 4 }),
    NoteLike: (key) => key.tonic,
    number: () => 1,
    'number | Note': () => 1,
    'number[]': () => [0, 4, 7],
    'readonly number[]': () => [0, 4, 7],
    'readonly NoteEvent[]': () =>
      [60, 62, 63].map((pitch, index) => ({ pitch, startBeat: index, durationBeat: 1 })),
    'readonly NoteLike[]': (key) => [key.tonic],
    ResolvedKey: (key) => key,
    // Optional, and omitted the way a caller with nothing to say about the
    // surrounding line omits it.
    SpellingContext: () => undefined,
    string: () => '',
  };

  /** What to pass where the declared type alone does not say what would be valid. */
  const BY_PARAM: Readonly<Record<string, Recipe>> = {
    // The tones and the bass of the German sixth of the key being measured, so
    // the reading has something to recognize.
    'augmentedSixthFromPitchClasses.pcs': (key) =>
      [0, 4, 7, 10].map((tone) => (key.scale.rootPc + BASS_ABOVE_TONIC + tone) % 12),
    'augmentedSixthFromPitchClasses.bassPc': (key) => (key.scale.rootPc + BASS_ABOVE_TONIC) % 12,
    // A numeral whose chord is spelled from the tonic rather than numbered from
    // the scale degrees.
    'romanToChord.text': () => 'Ger6',
  };

  /** Semitones from a tonic up to the lowered submediant an augmented sixth stands on. */
  const BASS_ABOVE_TONIC = 8;

  /**
   * Entry points the recipes cannot call, each with what it would take.
   *
   * Short by design, and asserted to be exact: an entry point that drops off
   * this list without becoming callable is one this check quietly stopped
   * measuring.
   */
  const NOT_EXERCISED: Readonly<Record<string, string>> = {
    // Wants a written voicing per chord, which no recipe can derive from a key.
    checkPartWriting: 'needs a spelled voicing for every chord it checks',
    checkSpecies: 'needs a cantus firmus and a counterpoint written against it',
    // Want a motif, which is a shape rather than anything the key implies.
    developMotif: 'needs a motif cell and a chord timeline to develop it over',
    relateMotifs: 'needs two motifs to compare',
    transformMotif: 'needs a motif cell to transform',
    placeLicks: 'needs a chord timeline to place licks into',
  };

  /** Every letter-and-accidental pair anywhere in an answer, in the order found. */
  function spellingsIn(value: unknown, found: string[] = []): string[] {
    if (Array.isArray(value)) {
      for (const item of value) {
        spellingsIn(item, found);
      }
      return found;
    }
    if (typeof value === 'object' && value !== null) {
      const fields = value as Record<string, unknown>;
      if (typeof fields.letter === 'number' && typeof fields.alter === 'number') {
        found.push(`${fields.letter}:${fields.alter}`);
      }
      for (const field of Object.values(fields)) {
        spellingsIn(field, found);
      }
    }
    return found;
  }

  /**
   * Every function a caller can reach from the package root that declares a key,
   * with the parameters of the signature that declares it.
   *
   * One entry per name: an overload set is measured through its first
   * signature, which is the one a caller reads first.
   */
  const entryPoints = (): Map<string, ParamInfo[]> => {
    const reachable = new Set(
      Object.entries(api as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'function')
        .map(([name]) => name),
    );
    const signatures = new Map<string, ParamInfo[]>();
    for (const param of functionParams()) {
      const id = `${param.file}:${param.line}:${param.fn}`;
      signatures.set(id, [...(signatures.get(id) ?? []), param]);
    }
    const found = new Map<string, ParamInfo[]>();
    for (const params of signatures.values()) {
      const [first] = params;
      if (first === undefined || !first.exported || !reachable.has(first.fn)) {
        continue;
      }
      if (params.some((param) => /\bKeyLike\b/.test(param.type)) && !found.has(first.fn)) {
        found.set(first.fn, params);
      }
    }
    return found;
  };

  /** The arguments one entry point is called with in one key, or null for none. */
  function argumentsFor(fn: string, params: ParamInfo[], key: ResolvedKey): unknown[] | null {
    const args: unknown[] = [];
    for (const param of params) {
      // An options bag is what a caller omits, so the check omits it too.
      const recipe = param.type.endsWith('Options')
        ? () => undefined
        : (BY_PARAM[`${fn}.${param.param}`] ?? BY_TYPE[param.type]);
      if (recipe === undefined) {
        return null;
      }
      args.push(recipe(key));
    }
    while (args.length > 0 && args[args.length - 1] === undefined) {
      args.pop();
    }
    return args;
  }

  /** What an entry point answers in one key, or null when it cannot be called. */
  function answerOf(fn: string, params: ParamInfo[], keyName: string): unknown | null {
    const key = resolveKey(keyName);
    const args = argumentsFor(fn, params, key);
    if (args === null) {
      return null;
    }
    const call = (api as unknown as Record<string, (...args: unknown[]) => unknown>)[fn];
    try {
      return call === undefined ? null : { answer: call(...args) };
    } catch {
      return null;
    }
  }

  /** Each entry point's two answers, or null where the recipes could not call it. */
  const answers = new Map<string, { flat: unknown; sharp: unknown } | null>();
  for (const [fn, params] of entryPoints()) {
    const [flatName, sharpName] = ENHARMONIC_KEYS;
    const flat = answerOf(fn, params, flatName);
    const sharp = answerOf(fn, params, sharpName);
    answers.set(fn, flat === null || sharp === null ? null : { flat, sharp });
  }

  it('answers the two spellings of one sound differently', () => {
    const offenders = [...answers.entries()]
      .filter(([, pair]) => pair !== null)
      .filter(([, pair]) => spellingsIn(pair?.flat).length > 0)
      .filter(
        ([, pair]) => spellingsIn(pair?.flat).join(' ') === spellingsIn(pair?.sharp).join(' '),
      )
      .map(
        ([fn, pair]) =>
          `${fn} spells an Ab minor and a G# minor alike: ${spellingsIn(pair?.flat).join(' ')}`,
      );

    expect(offenders).toEqual([]);
  });

  it('names exactly the entry points the recipes cannot call', () => {
    const uncallable = [...answers.entries()]
      .filter(([, pair]) => pair === null)
      .map(([fn]) => fn)
      .sort();

    expect(uncallable).toEqual(Object.keys(NOT_EXERCISED).sort());
  });

  it('reads a subject the tree supplies rather than a list', () => {
    // Without these the checks above would pass by calling nothing, or by
    // calling only the entry points that answer in pitch classes.
    const spelled = [...answers.values()].filter(
      (pair) => pair !== null && spellingsIn(pair.flat).length > 0,
    );

    expect(answers.size).toBeGreaterThan(40);
    expect(spelled.length).toBeGreaterThan(10);
  });
});

/**
 * The same convention read off the class layer, which the checks above cannot
 * see.
 *
 * The scanners read declarations: what a signature says it takes. That measures
 * the function API well and the class API not at all, because a class method
 * does not declare the shape it passes on — it writes it in its body, one
 * expression at a time, and `Key` satisfies `KeyLike` structurally, so
 * `figuredBassOf(chord, key.scale)` type-checks exactly as well as
 * `figuredBassOf(chord, key)` does. That is how the same defect grew in five
 * classes at once: every method decided for itself, and nothing measured the
 * decision.
 *
 * This reads the bodies. A key reduced to its pitch classes — by `.scale` or by
 * the reducer named for it — is found wherever it stands in `src/model`, and
 * each reduction that stays has to be named here with the reason it is not a
 * defect. The list is asserted to be exact, so a reduction that is removed
 * takes its entry with it and the next one written has nowhere to hide.
 */
describe('a key is not reduced on its way through the class layer', () => {
  /** One place a key is reduced to its pitch classes. */
  type Narrow = {
    /** Path relative to the repository root. */
    file: string;
    /** The declaration it stands in, as `Class.member` or the function's name. */
    where: string;
    /** The expression itself, so a failure reads as the line it is on. */
    text: string;
    /** 1-based line. */
    line: number;
  };

  /**
   * The reductions that are deliberate, each with what makes it one.
   *
   * A reduction is legitimate where the value it feeds is declared as pitch
   * classes, or where reducing is the thing being asked for. Everything else —
   * a key on its way to a function that takes a whole key — is the defect, and
   * an entry added here without one of those reasons is that defect wearing an
   * allowance.
   */
  const KEPT: Readonly<Record<string, string>> = {
    'src/model/key.ts Key.equals':
      'reads the other key own scale to compare pitch classes, which is what this comparison is',
    'src/model/key.ts Key.toJSON':
      'writes the three facts down side by side, so the scale is one field of the key rather than the key',
    'src/model/key.ts toKey':
      'the class API own resolver: it reads a key into the class, and the tonic and the form it carries are read beside the scale rather than dropped',
    'src/model/key.ts keyIdentity':
      'writes a key down whole, with the scale as one of the three fields it carries',
    'src/model/key.ts Key.#fromSpelled':
      'reads a resolved key apart into the three fields the class holds; the tonic and the form travel beside the scale',
    'src/model/key.ts Key.of':
      'reads a resolved key apart into the three fields the class holds; the tonic and the form travel beside the scale',
    'src/model/key.ts Key.fromJSON':
      'reads stored key data apart into the three fields the class holds; the tonic and the form travel beside the scale',
    'src/model/key.ts Key.tryParse':
      'reads a parsed key apart into the three fields the class holds; the tonic and the form travel beside the scale',
    'src/model/voicing.ts Voicing.#context':
      'SafetyQuery.key is declared KeyScale: the safety rules read which pitches are in the key and never spell one',
  };

  /** The declaration a node stands in, as a failure should name it. */
  function enclosing(node: ts.Node, source: ts.SourceFile): string {
    for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) {
      if (ts.isMethodDeclaration(at) || ts.isGetAccessor(at) || ts.isSetAccessor(at)) {
        const owner = at.parent;
        const name = at.name.getText(source);
        return ts.isClassDeclaration(owner) && owner.name !== undefined
          ? `${owner.name.text}.${name}`
          : name;
      }
      if (ts.isConstructorDeclaration(at)) {
        const owner = at.parent;
        return ts.isClassDeclaration(owner) && owner.name !== undefined
          ? `${owner.name.text}.constructor`
          : 'constructor';
      }
      if (ts.isFunctionDeclaration(at) && at.name !== undefined) {
        return at.name.text;
      }
      // Only a variable that *is* a function names a declaration; one that
      // merely holds the reduction is named by the member it stands in.
      if (
        ts.isVariableDeclaration(at) &&
        ts.isIdentifier(at.name) &&
        at.initializer !== undefined &&
        (ts.isArrowFunction(at.initializer) || ts.isFunctionExpression(at.initializer))
      ) {
        return at.name.text;
      }
    }
    return '(top level)';
  }

  /** Every reduction of a key to its pitch classes in one file. */
  function narrowsIn(file: string): Narrow[] {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ESNext,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );
    const rel = path.relative(path.dirname(SRC), file).split(path.sep).join('/');
    const found: Narrow[] = [];
    const visit = (node: ts.Node): void => {
      const reduces =
        (ts.isPropertyAccessExpression(node) && node.name.text === 'scale') ||
        (ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'toKeyScale');
      if (reduces) {
        found.push({
          file: rel,
          where: enclosing(node, source),
          text: node.getText(source).replace(/\s+/g, ' '),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    return found;
  }

  const narrows = filesUnder(path.join(SRC, 'model'), '.ts').flatMap(narrowsIn);

  it('reduces a key only where the reduction is named and reasoned', () => {
    const offenders = narrows
      .filter((narrow) => KEPT[`${narrow.file} ${narrow.where}`] === undefined)
      .map(
        (narrow) => `${narrow.file}:${narrow.line} ${narrow.where} reduces a key: ${narrow.text}`,
      )
      .sort();

    expect(offenders).toEqual([]);
  });

  it('holds no allowance for a reduction that is no longer there', () => {
    const live = new Set(narrows.map((narrow) => `${narrow.file} ${narrow.where}`));
    const stale = Object.keys(KEPT).filter((entry) => !live.has(entry));

    expect(stale).toEqual([]);
  });

  it('reads a subject the tree supplies rather than a list', () => {
    // Without this the check above would pass by walking no class at all.
    const files = filesUnder(path.join(SRC, 'model'), '.ts');
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((file) => file.endsWith('progression.ts'))).toBe(true);
  });
});
