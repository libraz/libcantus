import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { ParseResult } from '../src/core/errors/index.js';
import * as model from '../src/model/index.js';
import {
  Arrangement,
  Chord,
  Composer,
  Duration,
  Instrument,
  Interval,
  Key,
  Meter,
  Motif,
  Note,
  Progression,
  Rhythm,
  Score,
  Tempo,
  Timeline,
  Tuning,
  Voicing,
} from '../src/model/index.js';
import { availableTensions } from '../src/theory/chordscale/index.js';

/**
 * Contracts the model classes hold as a family rather than one at a time:
 * every class hands out its plain data, every text entry point has a
 * non-throwing sibling that agrees with it, every method offers the options
 * the function it delegates to accepts, and every `equals` compares through
 * the public surface. The class list, the entry points, and the delegations
 * are read off the sources, so a class, a parser, or an option added later is
 * held to the same rules without this file being edited.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_DIR = resolve(ROOT, 'src/model');
const SRC_DIR = resolve(ROOT, 'src');

/** One program over the model barrel, shared by every source-reading check. */
const program = ts.createProgram([resolve(MODEL_DIR, 'index.ts')], {
  ...ts.getDefaultCompilerOptions(),
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  strict: true,
  noEmit: true,
});
const checker = program.getTypeChecker();

/** Every class declared in `src/model`, with its declaration. */
function modelClasses(): { className: string; declaration: ts.ClassDeclaration }[] {
  const found: { className: string; declaration: ts.ClassDeclaration }[] = [];
  for (const source of program.getSourceFiles()) {
    if (!source.fileName.startsWith(MODEL_DIR)) {
      continue;
    }
    for (const statement of source.statements) {
      if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
        found.push({ className: statement.name.text, declaration: statement });
      }
    }
  }
  return found;
}

/** A class's own methods, private `#` members excluded. */
function methodsOf(declaration: ts.ClassDeclaration): ts.MethodDeclaration[] {
  return declaration.members.filter(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) && ts.isIdentifier(member.name),
  );
}

/** Whether a method is declared `static`. */
function isStatic(member: ts.MethodDeclaration): boolean {
  return (
    ts.getModifiers(member)?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ===
    true
  );
}

/** The constructors among the barrel's exports; everything else it exports is a type or an enum. */
type ModelClass = Extract<(typeof model)[keyof typeof model], new (...args: never[]) => object>;

/** Every class the model barrel exports; its callable members are all classes. */
const CLASSES = Object.entries(model).filter(
  (entry): entry is [string, ModelClass] => typeof entry[1] === 'function',
);

/** The exported classes by name, so a discovered name reaches its class. */
const CLASS_BY_NAME = new Map<string, unknown>(CLASSES);

/** What every model instance offers, whatever class it came from. */
type Sample = { data: unknown; toJSON(): unknown; equals(other: never): boolean };

/** One instance per exported class, keyed by the name the barrel exports. */
const SAMPLES: Record<string, Sample> = {
  Arrangement: Arrangement.of([
    {
      name: 'lead',
      notes: [
        { pitch: 72, startBeat: 0, durationBeat: 2 },
        { pitch: 74, startBeat: 2, durationBeat: 2 },
      ],
    },
    {
      name: 'bass',
      notes: [
        { pitch: 36, startBeat: 0, durationBeat: 2 },
        { pitch: 43, startBeat: 2, durationBeat: 2 },
      ],
    },
  ]),
  Chord: Chord.parse('Cmaj7/E'),
  Composer: Composer.of({
    key: 'C major',
    meters: { numerator: 4, denominator: 4 },
    bpm: 120,
    seed: 42,
  }),
  // A dotted value in a tuplet, so every field of the written form is filled.
  Duration: Duration.of('quarter', 1, { actual: 3, normal: 2 }),
  Instrument: Instrument.guitar(),
  // Compound, so the pulse grouping is exercised rather than assumed.
  Meter: Meter.parse('6/8'),
  Motif: Motif.generate({ key: 'C major', bars: 2, ctx: { seed: 7 } }),
  Rhythm: Rhythm.generate({ numerator: 4, denominator: 4 }, { bars: 2, ctx: { seed: 3 } }),
  Tempo: Tempo.of(120),
  Score: Score.of(
    [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 1, durationBeat: 1 },
      { pitch: 67, startBeat: 2, durationBeat: 2 },
    ],
    { meters: { numerator: 4, denominator: 4 }, tempo: 120, key: 'C major' },
  ),
  Timeline: Timeline.fromProgression(
    new Progression([Chord.parse('C'), Chord.parse('G7')], Key.major('C')),
    4,
  ),
  Tuning: Tuning.edo(19),
  Voicing: Voicing.of([48, 55, 64, 72]),
  Interval: Interval.parse('-m3'),
  // A detected key, so the scale form a plain minor does not carry is exercised.
  Key: Key.detectBest([57, 59, 60, 62, 64, 65, 68]) ?? Key.minor('A'),
  Note: Note.parse('F#4'),
  Progression: new Progression([Chord.parse('C'), Chord.parse('G7')], Key.major('C')),
};

/** The factory that rebuilds a class from the plain data it hands out. */
function rebuildEntry(cls: unknown): (data: unknown) => { data: unknown } {
  const statics = cls as {
    fromData?: (data: unknown) => { data: unknown };
    fromJSON?: (data: unknown) => { data: unknown };
  };
  const factory = statics.fromData ?? statics.fromJSON;
  expect(factory, 'a model class must be rebuildable from its plain data').toBeTypeOf('function');
  return (factory as (data: unknown) => { data: unknown }).bind(cls);
}

/** Where every number sits inside a plain value, as a path into it. */
function numericPaths(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (typeof value === 'number') {
    return [prefix];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => numericPaths(item, [...prefix, index]));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => numericPaths(item, [...prefix, key]));
  }
  return [];
}

/** Read the number a path points at. */
function readPath(value: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (current, step) => (current as Record<string | number, unknown>)?.[step],
    value,
  );
}

/** A copy of a plain value with one of its numbers replaced. */
function withNumberAt(value: unknown, path: (string | number)[], replacement: number): unknown {
  const copy = structuredClone(value);
  const parent = path
    .slice(0, -1)
    .reduce<unknown>((current, step) => (current as Record<string | number, unknown>)[step], copy);
  (parent as Record<string | number, unknown>)[path[path.length - 1] as string | number] =
    replacement;
  return copy;
}

/**
 * A stand-in that exposes only an instance's public surface.
 *
 * Reading a `#private` field off this object throws, so an `equals` that
 * reaches for one fails here exactly as it would against an instance of a
 * second copy of the class.
 */
function publicFacade<T extends object>(instance: T): T {
  const facade: Record<PropertyKey, unknown> = {};
  for (
    let proto: object | null = Object.getPrototypeOf(instance) as object | null;
    proto !== null && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const key of Reflect.ownKeys(proto)) {
      if (key === 'constructor' || key in facade) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      const getter = descriptor?.get;
      const value = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
      if (getter !== undefined) {
        Object.defineProperty(facade, key, { get: () => getter.call(instance), enumerable: true });
      } else if (typeof value === 'function') {
        Object.defineProperty(facade, key, {
          value: (...args: unknown[]) => value.apply(instance, args),
          enumerable: true,
        });
      }
    }
  }
  return facade as T;
}

describe('plain data accessor', () => {
  it('covers every class the barrel exports', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(CLASSES.map(([name]) => name).sort());
  });

  it.each(CLASSES)('%s exposes its plain value as .data', (name, cls) => {
    const sample = SAMPLES[name];
    expect(sample, name).toBeDefined();
    const descriptor = Object.getOwnPropertyDescriptor(cls.prototype, 'data');
    expect(descriptor?.get, `${name} must expose a .data accessor`).toBeTypeOf('function');
  });

  it.each(CLASSES)('%s hands out .data as a copy, not its own state', (name) => {
    const sample = SAMPLES[name] as { data: unknown };
    expect(sample.data).not.toBe(sample.data);
    expect(sample.data).toEqual(sample.data);
  });

  it.each(CLASSES)('%s round-trips through its plain data', (name, cls) => {
    const sample = SAMPLES[name] as { data: unknown; toJSON(): unknown };
    // `.data` and `toJSON()` are the same value: one is what a host reads, the
    // other what `JSON.stringify` reaches, and a difference between them is a
    // field that survives one route and not the other.
    expect(sample.data).toEqual(sample.toJSON());
    expect(sample.data).toEqual(JSON.parse(JSON.stringify(sample)));
    expect(rebuildEntry(cls)(sample.data).data).toEqual(sample.data);
  });
});

describe('data arriving from outside is checked, not trusted', () => {
  /** What a project file, a plugin, or a hand-edited JSON can carry in. */
  const POISON = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it.each(CLASSES)('%s rebuilds no value carrying a number it cannot hold', (name, cls) => {
    const sample = SAMPLES[name] as { data: unknown };
    const rebuild = rebuildEntry(cls);
    const paths = numericPaths(sample.data);
    // Derived from the value itself, so a field added to a class's plain form
    // is poisoned too without this test being edited.
    expect(paths.length, `${name} has no numeric field to corrupt`).toBeGreaterThan(0);
    for (const path of paths) {
      for (const poison of POISON) {
        const label = `${name}.${path.join('.')} = ${poison}`;
        let rebuilt: { data: unknown } | undefined;
        try {
          rebuilt = rebuild(withNumberAt(sample.data, path, poison));
        } catch (error) {
          // Rejected at the boundary, which is the other half of the contract.
          expect(error, label).toBeInstanceOf(RangeError);
          continue;
        }
        // Accepted, so it must have been normalized: a value that keeps the
        // number reports it from every getter and compares against nothing.
        for (const leaf of numericPaths(rebuilt.data)) {
          expect(Number.isFinite(readPath(rebuilt.data, leaf)), `${label} survived`).toBe(true);
        }
      }
    }
  });

  it('rejects an interval whose parts describe no interval', () => {
    // The same reading `Interval.of` refuses: a fifth spanning eight semitones
    // names itself a fifth and sounds a sixth, and every method downstream —
    // `isConsonant` above all — answers for the sound rather than the name.
    expect(() => Interval.fromJSON({ number: 5, quality: 'P', semitones: 8 })).toThrow(RangeError);
    expect(() => Interval.of(5, 'P', 8)).toThrow(RangeError);
    expect(() => Interval.fromData({ number: 5, quality: 'M', semitones: 7 })).toThrow(RangeError);
    expect(() => Interval.fromData({ number: 1.5, quality: 'P', semitones: 0 })).toThrow(
      RangeError,
    );
    expect(() => Interval.fromData({ number: 5, quality: 'P', semitones: Number.NaN })).toThrow(
      RangeError,
    );
    // What the pitch module measures still passes, in both directions.
    expect(Interval.fromData({ number: 5, quality: 'P', semitones: 7 }).name).toBe('P5');
    expect(Interval.fromData({ number: 5, quality: 'P', semitones: -7 }).isDescending).toBe(true);
  });

  it('reads the direction the way the pitch module reads it', () => {
    // C# up to Dbb climbs a letter while losing a semitone: a doubly
    // diminished second that ascends, which the span's sign alone calls a
    // descent.
    const climbing = Note.parse('C#4').intervalTo(Note.parse('Dbb4'));
    expect(climbing.semitones).toBeLessThan(0);
    expect(climbing.isDescending).toBe(false);
    expect(Interval.fromData(climbing.data).isDescending).toBe(false);
    expect(Interval.fromJSON(JSON.parse(JSON.stringify(climbing))).equals(climbing)).toBe(true);
  });

  it('serializes an interval in the canonical shape, descending flag and all', () => {
    for (const interval of [
      Interval.parse('P5'),
      Interval.parse('-m3'),
      Interval.parse('P1'),
      Interval.parse('P1').negate(),
      Interval.of(3, 'M', -4),
      Note.parse('C#4').intervalTo(Note.parse('Dbb4')),
      Note.parse('Fb4').intervalTo(Note.parse('E4')),
    ]) {
      const json = interval.toJSON();
      // One shape whichever way the interval goes, carrying the direction it
      // goes in: the pitch module's own shape, so measured, parsed and
      // serialized data compare.
      expect('descending' in json, interval.name).toBe(true);
      expect(json.descending, interval.name).toBe(interval.isDescending);
      expect(Interval.fromJSON(json).equals(interval), interval.name).toBe(true);
    }
  });

  it('reduces a chord root and bass to pitch classes at the boundary', () => {
    const wrapped = Chord.fromData({ rootPc: 25, quality: 'maj', intervals: [0, 4, 7] });
    expect(wrapped.rootPc).toBe(1);
    expect(wrapped.data.rootPc).toBe(1);
    expect(Chord.of(1, 'maj').equals(wrapped)).toBe(true);
    expect(wrapped.equals(Chord.of(1, 'maj'))).toBe(true);
    const slash = Chord.fromJSON({ rootPc: -12, quality: 'maj', intervals: [0, 4, 7], bassPc: 19 });
    expect(slash.rootPc).toBe(0);
    expect(slash.bassPc).toBe(7);
    expect(slash.symbol()).toBe('C/G');
    expect(() => Chord.fromData({ rootPc: Number.NaN, quality: 'maj', intervals: [0] })).toThrow(
      RangeError,
    );
  });
});

describe('equals compares through the public surface', () => {
  it.each(CLASSES)('%s equals a stand-in that exposes only public members', (name) => {
    const sample = SAMPLES[name] as { equals(other: never): boolean };
    expect(sample.equals(publicFacade(sample) as never), name).toBe(true);
  });

  it('compares values built by a second copy of the module', async () => {
    // A CommonJS build without shared chunks emits the model classes twice, once
    // for the root entry and once for `/model`. Resetting the registry gives the
    // same two identities here: an `equals` that reads a `#private` field off
    // the other value throws a TypeError instead of answering.
    vi.resetModules();
    const other = (await import('../src/model/index.js')) as typeof model;
    expect(other.Interval).not.toBe(Interval);

    expect(Interval.parse('P5').equals(other.Interval.parse('P5'))).toBe(true);
    expect(Interval.parse('P5').equals(other.Interval.parse('P4'))).toBe(false);
    expect(Interval.parse('M3').negate().equals(other.Interval.parse('M3').negate())).toBe(true);
    expect(Interval.parse('M3').equals(other.Interval.parse('M3').negate())).toBe(false);
    expect(Note.parse('C4').equals(other.Note.parse('C4'))).toBe(true);
    expect(Key.major('C').equals(other.Key.major('C'))).toBe(true);
    expect(Chord.parse('Cmaj7').equals(other.Chord.parse('Cmaj7'))).toBe(true);
    expect(
      new Progression([Chord.parse('C')]).equals(new other.Progression([other.Chord.parse('C')])),
    ).toBe(true);
    expect(Note.parse('C4').intervalTo(other.Note.parse('G4')).name).toBe('P5');
  });
});

describe('non-throwing parser siblings', () => {
  /**
   * Every static factory that reads text, found by its declared first
   * parameter rather than by name, so an entry point added later is checked
   * without being listed here.
   */
  const textEntries = modelClasses().flatMap(({ className, declaration }) =>
    methodsOf(declaration)
      .filter(
        (member) =>
          isStatic(member) && member.parameters[0]?.type?.kind === ts.SyntaxKind.StringKeyword,
      )
      .map((member) => ({ className, method: (member.name as ts.Identifier).text })),
  );

  /** Text an input field passes through on its way to (or away from) a value. */
  const PROBES = [
    '',
    ' ',
    'C',
    'C#4',
    'Bb',
    'H',
    'Cmaj7',
    'Cmaj7(#',
    'C/G',
    'Cfoo',
    'P5',
    'm3',
    '-m3',
    'M5',
    'x9',
    'gis moll',
    'C major',
    '嬰ト短調',
    '4/4',
    '6/8',
    '5/x',
  ];

  const throwing = textEntries.filter((entry) => !entry.method.startsWith('try'));

  it('finds the text entry points on the classes that have them', () => {
    expect(throwing.length).toBeGreaterThan(0);
    // One text entry per class, so `tryParse` names its sibling unambiguously.
    expect(new Set(throwing.map((entry) => entry.className)).size).toBe(throwing.length);
  });

  it.each(throwing)('$className.$method has a tryParse sibling', ({ className }) => {
    const cls = CLASS_BY_NAME.get(className) as Record<string, unknown>;
    expect(cls.tryParse, `${className} must offer a non-throwing sibling`).toBeTypeOf('function');
  });

  it.each(throwing)('$className.$method and $className.tryParse agree', ({ className, method }) => {
    const cls = CLASS_BY_NAME.get(className) as Record<string, (text: string) => unknown>;
    let parsed = 0;
    let reported = 0;
    for (const text of PROBES) {
      const result = cls.tryParse?.(text) as ParseResult<{ data: unknown }>;
      let thrown: unknown;
      let value: { data: unknown } | undefined;
      try {
        value = cls[method]?.(text) as { data: unknown };
      } catch (error) {
        thrown = error;
      }
      const label = `${className}.${method}(${JSON.stringify(text)})`;
      expect(result.ok, label).toBe(thrown === undefined);
      if (result.ok) {
        parsed += 1;
        expect(result.value.data, label).toEqual(value?.data);
      } else {
        reported += 1;
        // The throwing form is the non-throwing one unwrapped, so the two
        // cannot describe the same text differently.
        expect((thrown as Error).message, label).toBe(result.error.message);
        expect(result.error.code, label).toBe('INVALID_INPUT');
      }
    }
    expect(parsed, `${className}: no probe parsed`).toBeGreaterThan(0);
    expect(reported, `${className}: no probe was rejected`).toBeGreaterThan(0);
  });

  it('reads the notes, intervals, and keys a text field is typing', () => {
    // `H` is a note: the German B natural, which the name itself announces.
    expect(Note.tryParse('H').ok).toBe(true);
    expect(Note.tryParse('C#b').ok).toBe(false);
    const note = Note.tryParse('C');
    expect(note.ok && note.value.name).toBe('C');
    const interval = Interval.tryParse('P5');
    expect(interval.ok && interval.value.name).toBe('P5');
    expect(Interval.tryParse('M5').ok).toBe(false);
    const key = Key.tryParse('gis moll');
    expect(key.ok && key.value.toString()).toBe('G# minor');
    const failed = Key.tryParse('gis dur moll');
    expect(failed.ok).toBe(false);
    expect(!failed.ok && failed.error.message.length).toBeGreaterThan(0);
  });
});

describe('methods offer the options their delegate accepts', () => {
  /**
   * A parameter's type with `undefined` removed, so an `opts?: X` parameter
   * reads as the `X` it names rather than as the union the compiler gives it.
   */
  function typeOfParameter(parameter: ts.ParameterDeclaration): ts.Type {
    return checker.getNonNullableType(checker.getTypeAtLocation(parameter));
  }

  /**
   * Whether a type is an options bag rather than a value, a union, or a list.
   *
   * An intersection counts: a method that reaches two delegates names the
   * options of both, as `Progression.analyze` does.
   *
   * Every property must be optional. That is what separates a bag of settings
   * from a value that happens to be an object: `KeyScale` requires `rootPc` and
   * `modeMask12`, and a delegate taking an optional key would otherwise read as
   * a delegate taking two optional settings — so a wrapper accepting the key as
   * a `KeyLike`, which is how every entry point in the library takes one, would
   * be reported as dropping them.
   */
  function isOptionsType(type: ts.Type): boolean {
    const properties = type.getProperties();
    return (
      (type.getFlags() & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0 &&
      type.getCallSignatures().length === 0 &&
      !checker.isArrayType(type) &&
      properties.length > 0 &&
      properties.every((property) => (property.getFlags() & ts.SymbolFlags.Optional) !== 0)
    );
  }

  /** The optional options bags a signature accepts, in declaration order. */
  function optionParameters(signature: ts.SignatureDeclaration): ts.ParameterDeclaration[] {
    return signature.parameters.filter((parameter) => {
      if (parameter.questionToken === undefined && parameter.initializer === undefined) {
        return false;
      }
      return isOptionsType(typeOfParameter(parameter));
    });
  }

  /** Every property an options bag carries, as `name` and whether it is optional. */
  function optionProperties(parameter: ts.ParameterDeclaration): Map<string, boolean> {
    const properties = new Map<string, boolean>();
    for (const property of typeOfParameter(parameter).getProperties()) {
      properties.set(property.getName(), (property.getFlags() & ts.SymbolFlags.Optional) !== 0);
    }
    return properties;
  }

  /**
   * The functions a method delegates to, outside the model layer.
   *
   * A call is a delegation when its callee is a plain identifier declared in
   * another layer: `analyzeChord(...)` is one, while `this.notes()` and
   * `Key.fromJSON(...)` are the model talking to itself and carry no contract
   * of their own.
   */
  function delegatesOf(method: ts.MethodDeclaration): ts.SignatureDeclaration[] {
    const found: ts.SignatureDeclaration[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const symbol = checker.getSymbolAtLocation(node.expression);
        const target =
          symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(symbol)
            : symbol;
        const declaration = (target?.getDeclarations() ?? [])[0];
        if (declaration !== undefined && ts.isFunctionDeclaration(declaration)) {
          const file = declaration.getSourceFile().fileName;
          if (file.startsWith(SRC_DIR) && !file.startsWith(MODEL_DIR)) {
            found.push(declaration);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(method, visit);
    return found;
  }

  const delegations = modelClasses().flatMap(({ className, declaration }) =>
    methodsOf(declaration).flatMap((method) =>
      delegatesOf(method).flatMap((delegate) =>
        optionParameters(delegate).map((parameter) => ({
          // One label, because a `$a.$b` title reads as a property path.
          label: `${className}.${(method.name as ts.Identifier).text}`,
          delegate: (delegate.name as ts.Identifier | undefined)?.text ?? '(anonymous)',
          declaration: method,
          parameter,
        })),
      ),
    ),
  );

  it('finds the delegations to check', () => {
    // The list is derived from the sources; an empty one would mean the walk
    // stopped matching and every assertion below silently passed.
    expect(delegations.length).toBeGreaterThan(5);
  });

  it.each(delegations)(
    '$label accepts what $delegate does',
    ({ label, delegate, declaration, parameter }) => {
      const exposed = new Map<string, boolean>();
      for (const own of declaration.parameters) {
        const type = typeOfParameter(own);
        if (!isOptionsType(type)) {
          continue;
        }
        for (const property of type.getProperties()) {
          exposed.set(property.getName(), (property.getFlags() & ts.SymbolFlags.Optional) !== 0);
        }
      }
      for (const [name, optional] of optionProperties(parameter)) {
        const message = `${label} must accept '${name}' from ${delegate}`;
        expect(exposed.has(name), message).toBe(true);
        expect(exposed.get(name), `${message} with the same optionality`).toBe(optional);
      }
    },
  );

  it('passes the new chord-scale options through to the functions', () => {
    const chord = Chord.of('C', 'maj7');
    expect(chord.avoidNotes('ionian')).toEqual([5]);
    expect(chord.avoidNotes('ionian', { use: 'melodic' })).toEqual([]);
    const dominant = Chord.of('G', 'dom7');
    expect(
      dominant.tensions('phrygianDominant', { resolvesTo: Chord.of('C', 'min').data }),
    ).toEqual(
      availableTensions(dominant.data, 'phrygianDominant', {
        resolvesTo: Chord.of('C', 'min').data,
      }),
    );
    expect(
      dominant.tensions('phrygianDominant', { resolvesTo: Chord.of('C', 'min').data }).length,
    ).toBeGreaterThan(dominant.tensions('phrygianDominant').length);
  });

  it('reaches the rejected readings and the cadence strength from the class API', () => {
    const key = Key.major('C');
    const applied = Chord.parse('D7');
    expect(applied.analyze(key).alternatives).toEqual([]);
    expect(applied.analyze(key, { alternatives: true }).alternatives.length).toBeGreaterThan(0);

    const progression = new Progression([Chord.parse('G7'), Chord.parse('C')], key);
    expect(progression.analyze().cadence?.strength).toBe(null);
    const voiced = progression.voice();
    const cadence = progression.analyze(undefined, {
      voicing: [voiced[0] ?? [], voiced[1] ?? []],
      alternatives: true,
    }).cadence;
    expect(cadence?.type).toBe('authentic');
    expect(cadence?.strength === 'perfect' || cadence?.strength === 'imperfect').toBe(true);
    expect(
      progression.analyze(undefined, { alternatives: true }).chords[0]?.alternatives.length,
    ).toBeGreaterThan(0);
  });

  it('names a note and a scale in every notation system the functions read', () => {
    expect(Note.parse('B', { system: 'german' }).name).toBe('Bb');
    expect(Note.parse('gis').name).toBe('G#');
    expect(Note.parse('G#').format({ system: 'german' })).toBe('gis');
    expect(Note.parse('G#4').toString({ system: 'japanese' })).toBe('嬰ト4');
    expect(Note.parse('G#').toString()).toBe('G#');
    expect(Key.minor('G#').noteNames({ system: 'german' })[0]).toBe('gis');
    expect(Key.minor('G#').noteNames()[0]).toBe('G#');
  });
});

describe('Key JSON identity', () => {
  it('carries the detected scale form through a round trip', () => {
    const detected = Key.detectBest([57, 59, 60, 62, 64, 65, 68]); // A harmonic minor
    expect(detected?.variant).toBe('harmonic');
    expect(detected).not.toBeNull();
    const key = detected as Key;
    const restored = Key.fromJSON(JSON.parse(JSON.stringify(key)) as model.KeyData);
    expect(restored.scale).toEqual(key.scale);
    expect(restored.tonic.equals(key.tonic)).toBe(true);
    expect(restored.variant).toBe(key.variant);
    expect(restored.toString()).toBe(key.toString());
    expect(restored.toString()).toBe('A harmonic minor');
  });

  it('carries the scale form of every key detection reports', () => {
    // Melodic minor as well as harmonic: the variant is the only record of
    // which form was detected, and the mode mask alone cannot rebuild it.
    for (const pitches of [
      [57, 59, 60, 62, 64, 65, 68],
      [57, 59, 60, 62, 64, 66, 68],
      [0, 2, 4, 5, 7, 9, 11],
    ]) {
      for (const match of Key.detectMatches(pitches)) {
        const restored = Key.fromJSON(JSON.parse(JSON.stringify(match.key)) as model.KeyData);
        expect(restored.variant, match.key.toString()).toBe(match.key.variant);
        expect(restored.toString()).toBe(match.key.toString());
      }
    }
  });

  it('leaves the variant out of a key that has none', () => {
    expect(Key.major('Eb').toJSON()).toEqual({
      scale: Key.major('Eb').scale,
      tonic: { letter: 2, alter: -1 },
    });
    expect('variant' in Key.major('Eb').toJSON()).toBe(false);
  });

  it('carries the scale form through a progression that holds the key', () => {
    const key = Key.detectBest([57, 59, 60, 62, 64, 65, 68]) as Key;
    const progression = new Progression([Chord.parse('Am'), Chord.parse('E7')], key);
    const restored = Progression.fromJSON(JSON.parse(JSON.stringify(progression)));
    expect(restored.key?.variant).toBe('harmonic');
    expect(restored.key?.toString()).toBe('A harmonic minor');
  });
});

describe('interval inversion', () => {
  /** The simple interval a diatonic number belongs to, stated independently. */
  function simple(numberValue: number): number {
    let reduced = numberValue;
    while (reduced > 8) {
      reduced -= 7;
    }
    return reduced;
  }

  it('depends only on the simple interval, not on how far apart the notes sit', () => {
    for (let numberValue = 1; numberValue <= 29; numberValue += 1) {
      const compound = Interval.parse(`${qualityFor(numberValue)}${numberValue}`);
      const reduced = Interval.parse(`${qualityFor(simple(numberValue))}${simple(numberValue)}`);
      expect(compound.invert().name, `invert(${compound.name})`).toBe(reduced.invert().name);
    }
  });

  it('does not fold the octave and its multiples onto the unison', () => {
    // Every octave-multiple is an octave, so it inverts as one; only the unison
    // inverts to an octave.
    expect(Interval.parse('P8').invert().name).toBe('P1');
    expect(Interval.parse('P15').invert().name).toBe('P1');
    expect(Interval.parse('P22').invert().name).toBe('P1');
    expect(Interval.parse('P1').invert().name).toBe('P8');
    expect(Note.parse('C2').intervalTo(Note.parse('C4')).invert().name).toBe('P1');
    expect(Note.parse('C2').intervalTo(Note.parse('C4')).invert().invert().number).toBe(8);
  });

  it('is an identity on the simple interval when applied twice', () => {
    for (let numberValue = 1; numberValue <= 29; numberValue += 1) {
      const quality = qualityFor(numberValue);
      const interval = Interval.parse(`${quality}${numberValue}`);
      expect(interval.invert().invert().number, interval.name).toBe(simple(numberValue));
      expect(interval.invert().invert().quality, interval.name).toBe(
        qualityFor(simple(numberValue)),
      );
    }
  });

  it('keeps the octave-equivalent family on one answer', () => {
    for (const numberValue of [8, 15, 22, 29]) {
      expect(Interval.parse(`P${numberValue}`).invert().equals(Interval.parse('P8').invert())).toBe(
        true,
      );
    }
  });
});

/** The quality a diatonic number takes when the interval is perfect or major. */
function qualityFor(numberValue: number): 'P' | 'M' {
  const degree = ((numberValue - 1) % 7) + 1;
  return degree === 1 || degree === 4 || degree === 5 ? 'P' : 'M';
}
