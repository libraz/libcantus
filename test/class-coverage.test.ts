import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = path.join(ROOT, 'src');
const MODEL = path.join(SRC, 'model');

/**
 * Public functions a class is not expected to reach, with the reason each one
 * stays a function. Anything that leaves this list and is still unreachable is
 * a hole in the class API, not a new entry to add here.
 */
const NOT_A_CLASS_METHOD: Readonly<Record<string, string>> = {
  // Validators. A class validates its own arguments on the way in, so these
  // exist for the caller's own boundary rather than for a method to call.
  assertFiniteSemitones: 'validator for a caller boundary',
  assertDegree: 'validator for a caller boundary',
  assertGenerationBudget: 'validator for a caller boundary',
  assertMeterMap: 'validator for a caller boundary',
  assertChordTimeline: 'validator for a caller boundary',
  assertModeMask: 'validator for a caller boundary',
  assertNoteEvent: 'validator for a caller boundary',
  assertVocabulary: 'validator for a caller boundary',
  clampToMidi: 'repairs a raw number at a caller boundary',
  dropSilentNotes: 'repairs an imported event array before it is material',
  soundingNotesOnly: 'the other name of dropSilentNotes',

  // Type guards over untyped material. They narrow before a value is a value
  // object at all, which is upstream of every class.
  isDrumPattern: 'type guard over untyped material',
  isLickMaterial: 'type guard over untyped material',
  isFillArchetype: 'type guard over untyped material',
  isLibcantusError: 'type guard over a caught error',

  // Predicates on a bare semitone count. The class-side reading is spelled,
  // so `Interval` answers through `classifySpelledInterval` instead.
  classifyInterval: 'predicate on an unspelled semitone count',
  isPerfectInterval: 'predicate on an unspelled semitone count',

  // A predicate on a bare mask. Whether a scale has a signature of its own is a
  // question about the mask alone; a `Key` is asked the spelled question that
  // reads it — whether the key is written on the tonic it carries — and the
  // theory layer owns that one.
  isSignatureKey: 'predicate on an unspelled mode mask',

  // Counterpoint predicates. Each judges one pair of voices at one moment,
  // which is a question about two pitches rather than about a value object;
  // `Voicing.checkTo` is the bundled check a voicing answers, and the class
  // says so in its own doc comment.
  createsParallelOctave: 'judges one pair of voices at one moment',
  createsParallelUnison: 'judges one pair of voices at one moment',
  createsParallelPerfect: 'judges one pair of voices at one moment',
  createsHiddenParallelPerfect: 'judges one pair of voices at one moment',
  createsVerticalDissonance: 'judges one pair of voices at one moment',
  createsVoiceCrossing: 'judges one pair of voices at one moment',
  createsVoiceOverlap: 'judges one pair of voices at one moment',
  createsBattuta: 'judges one pair of voices at one moment',
  exceedsSpacing: 'judges one pair of voices at one moment',
  isAugmentedMelodicInterval: 'judges one step of one line',
  isForbiddenMelodicLeap: 'judges one step of one line',
  isLeadingToneResolution: 'judges one step of one line',
  classifySpelledInterval: 'graded form of the answer Interval.isConsonant gives',

  // Seed plumbing. A class takes a seed and derives what it needs inside its
  // generation context, so these are the primitives underneath that.
  createRng: 'primitive under the namespaced generator',
  createPositionalRng: 'primitive under the namespaced generator',
  deriveSeed: 'derives a child seed inside a generation context',
  includeAt: 'draws against a positional generator',
  resolveAlgorithmVersion: 'resolves a pinned version for a generation context',

  // Catalogue readers. They answer about the library's own tables rather than
  // about a value, so there is no receiver for them to hang off.
  progressions: 'reads the built-in catalogue',
  progressionsByStyle: 'reads the built-in catalogue',
  pickProgressionPreset: 'reads the built-in catalogue',
  pickVocabulary: 'reads the built-in catalogue',
  mergeVocabulary: 'combines catalogue entries',
  drumVoiceOf: 'reads the drum-kit table',
  chordQualities: 'lists the quality names the library knows',
  instrumentTransposition: 'reads the transposing-instrument table',
  namedScaleMask: 'reads the scale-name table',
  requireScaleMask: 'reads the scale-name table',
  resolveScaleName: 'reads the scale-name table',
  profileWeights: 'resolves a named options profile to its weights',

  // Dictionary operations. They shape the caller's own vocabulary list before
  // a generator is handed it, alongside the catalogue readers above.
  selectVocabulary: "queries the caller's dictionary",
  vocabularyOfKind: "narrows the caller's dictionary",
  fitsQuery: 'tests one dictionary entry against a query',

  // Text classification that runs before a name is parsed at all.
  detectNoteNameSystem: 'classifies text before it names a note',

  // Free-function parsers. The class face of each is the static factory named
  // here, which reads the same text and hands back the value object.
  parseNote: 'the class face is Note.parse',
  parseKeyName: 'the class face is Key.parse',
  tryParseKeyName: 'the class face is Key.tryParse, which reads the scale words too',
  parseChordSymbol: 'the class face is Chord.parse',
  parseInterval: 'the class face is Interval.parse',

  // Shortcuts over a path the class API already spells out.
  transposeChordSymbol: 'shortcut over parse, transpose, and print',
  isDiatonic: 'shortcut over chord.pitchClasses.every(pc => key.contains(pc))',
  noteNames: 'shortcut over mapping Note.format across an array',
  barIndexAt: 'the bar number of Score.barAt',
  barStartBeat: 'a beat less the in-bar offset Score.barAt reports for it',
  beatsPerBarAt: 'Meter.beatsPerBar asked at the signature Score.meterAt finds',
  spellAugmentedSixth: 'the spelled table Key.augmentedSixth builds its chord from',

  // The single-line reader under a class surface that reads more than one line.
  // Score.voices() is the class face of the question, and it splits polyphony
  // into sub-voices before reading each, exactly as analyzeVoice's own
  // documentation says a caller with polyphonic material must; analyzeVoice is
  // what that split feeds, one monophonic line at a time.
  analyzeVoice: 'the single-line reader Score.voices splits its material for',

  // Readings of plain data that a value object exposes under its own name.
  chordSpecIntervals: 'reads a plain spec; Chord.intervals is the same reading',
  chordSpecQuality: 'reads a plain spec; Chord.quality is the same reading',
  scaleMatchesChord: 'containment test over a raw mode mask',
  intervalAboveRoot: 'the interval class behind the name Chord.roleOf gives it',
  roleOf: 'the voicing-side role and lock level, not the chord tone Chord.roleOf names',
  augmentedSixthKind: 'names the kind of the augmented sixth Chord.analyze reads',
  augmentedSixthFromPitchClasses: 'reads bare pitch classes, upstream of a Chord',
  figuredBassRealization: 'the notes and suspensions around the chord Chord.fromFiguredBass builds',
  compareMelodies: 'says why two lines scored what they did; Motif.similarityTo is the score',
  tensionCurve: 'the plain-track form of Arrangement.tension',

  // Arithmetic below the level a value object works at.
  diatonicLetterOf: 'letter arithmetic upstream of a spelled note',
  naturalPitchClassOf: 'letter arithmetic upstream of a spelled note',
  maskFromOffsets: 'builds the plain mask a Key is made of',
  scaleLadderPosition: 'keeps a chromatic offset apart from the rung Key.degreeOf names',
  scaleLadderPitch: 'keeps a chromatic offset apart from the rung Key.degreeOf names',

  // Generator stages. They run on the arrays a generator passes between its
  // own steps, or on the context it writes under, not on a value object.
  double: 'transform between generator stages',
  imitate: 'transform between generator stages',
  placeDrumPattern: 'transform between generator stages',
  placeLicks: 'transform between generator stages',
  classifyMelodyTones: 'harmonizer stage that runs before any chord exists',
  gridMetricWeight: 'ranks a step of a generator grid',
  onsetWeightCurve: 'maps a metric weight to a generator probability',
  sustainsShift: 'reads a difficulty ceiling against a tempo',
  sustainsStrokes: 'reads a difficulty ceiling against a tempo',

  // Spelling a tonic out of bare pitch classes. The class API reaches the same
  // answer by wrapping the scale — `Key.of(scale).tonic` — and does so through
  // the key resolver, which is where the choice is made once for the whole
  // library. A class calling this directly would be a second place that decides
  // how a key is written.
  spelledKeyOf: 'the class API spells a bare scale by wrapping it in a Key',

  // Undecided. Each is a capability with a plausible receiver and no method,
  // and settling it means deciding whether the class API should grow or the
  // equivalence the docs claim should be narrowed. Listed so the promise is
  // not quietly read as kept.
  barPositionToBeat: 'undecided: Meter.barPositionAt spells the forward direction only',
  barPositionToPulse: 'undecided: Meter.formatPosition prints what this numbers',
  chordFromSpec: 'undecided: Chord.spec goes out, and no factory takes one back in',
  secondaryDominant: 'undecided: Chord.secondaryDominant tonicizes a chord, not a degree of a key',
  shiftByScaleDegrees: 'undecided: no receiver-side spelling of a diatonic shift',
};

/**
 * Functions the class API delegates to that the package does not publish, with
 * the reason each one stays inside. A name that leaves this list and is still
 * unpublished is a capability with only a class-shaped way in — the method is
 * the sole implementation a caller can reach — rather than a new entry here.
 */
const NOT_PUBLISHED: Readonly<Record<string, string>> = {
  // Plumbing under an entry point rather than an entry point. A class `parse`
  // throws what its own `tryParse` reported, and that reading — the `tryParse`
  // function beside it — is published.
  unwrapParse: 'turns a parse result into a throw; the reading itself is published',

  // A reading the published value already carries: this is the search a
  // `ChordTimeline` answers `at(beat)` through, so a caller holding the plain
  // timeline `chordTimelineFromNotes` hands back has it in hand already.
  chordAtBeat: 'the search the ChordTimeline a caller already holds answers at() through',

  // A fragment of a chord rather than a chord: it moves a spellings record,
  // which is one step inside the published transposition of a chord symbol.
  transposeChordSpellings: 'moves a spellings record, a step inside transposeChordSymbol',

  // A measurement the motif transforms make of a cell, shared with the class so
  // that the answer is given in one place rather than two. `Motif.totalBeats`
  // is how a caller asks for it; the transforms are what it is there for.
  cellSpan: 'measures a cell for the transforms; Motif.totalBeats is how it is asked for',

  // A view of a validated tempo map, handed out for the length of one pass.
  // Only the pass that validated the map can say it is still current, and the
  // conversions a caller holds — `beatsToSeconds` and the rest — validate the
  // map they are given each time, which is what makes them safe to publish.
  tempoReader: 'holds a validated tempo map for one pass; the conversions themselves are published',
};

/** The `src` files that define the class API, `index.ts` aside. */
function classSources(program: ts.Program): ts.SourceFile[] {
  return program
    .getSourceFiles()
    .filter(
      (file) =>
        file.fileName.startsWith(`${MODEL}${path.sep}`) && !file.fileName.endsWith('index.ts'),
    );
}

/**
 * The bodies a declaration contributes: what it runs, not what it is named or
 * annotated with. Reading the name back would let a method called `transpose`
 * report the function `transpose` as reached without ever calling it.
 */
function bodiesOf(node: ts.Node): ts.Node[] {
  if (ts.isClassDeclaration(node)) {
    return node.members.flatMap(bodiesOf);
  }
  const bodies: ts.Node[] = [];
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  ) {
    if (node.body !== undefined) {
      bodies.push(node.body);
    }
    for (const parameter of node.parameters) {
      if (parameter.initializer !== undefined) {
        bodies.push(parameter.initializer);
      }
    }
  } else if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
    if (node.initializer !== undefined) {
      bodies.push(node.initializer);
    }
  } else if (ts.isClassStaticBlockDeclaration(node)) {
    bodies.push(node.body);
  }
  return bodies;
}

/**
 * Every name the class API itself calls: what the body of a member declared in
 * `src/model` writes down, plus what the helpers those bodies call write down
 * in turn, for as long as the helper also lives in `src/model`.
 *
 * The walk stops at the edge of `src/model` on purpose. Following a name into
 * its declaration anywhere in `src/` and carrying on through that body reports
 * everything the library transitively calls, which is nearly the whole surface
 * and says nothing about whether a class ever offered it.
 */
function reachableFromClasses(program: ts.Program, checker: ts.TypeChecker): Set<string> {
  const modelFiles = new Set(classSources(program).map((file) => file.fileName));
  const seen = new Set<ts.Symbol>();
  const names = new Set<string>();
  const queue: ts.Node[] = [];
  for (const file of classSources(program)) {
    for (const statement of file.statements) {
      if (ts.isClassDeclaration(statement)) {
        queue.push(...bodiesOf(statement));
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      const found = checker.getSymbolAtLocation(node);
      const symbol =
        found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0
          ? checker.getAliasedSymbol(found)
          : found;
      if (symbol !== undefined && !seen.has(symbol)) {
        seen.add(symbol);
        names.add(symbol.name);
        for (const declaration of symbol.getDeclarations() ?? []) {
          if (modelFiles.has(declaration.getSourceFile().fileName)) {
            queue.push(...bodiesOf(declaration));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  while (queue.length > 0) {
    const node = queue.pop();
    if (node !== undefined) {
      visit(node);
    }
  }
  return names;
}

/** Every class the model layer declares. */
function modelClasses(program: ts.Program): ts.ClassDeclaration[] {
  return classSources(program).flatMap((file) =>
    file.statements.filter((statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement),
    ),
  );
}

/** The named methods and getters of a class, static and instance alike. */
function membersOf(
  declaration: ts.ClassDeclaration,
): (ts.MethodDeclaration | ts.GetAccessorDeclaration)[] {
  return declaration.members.filter(
    (member): member is ts.MethodDeclaration | ts.GetAccessorDeclaration =>
      (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member)) &&
      ts.isIdentifier(member.name),
  );
}

/** Where a declaration lives, as `file:pos`, so a rename on the way out reads as the same thing. */
function originOf(declaration: ts.Declaration): string {
  return `${declaration.getSourceFile().fileName}:${declaration.pos}`;
}

/** Every declaration the root barrel makes importable, under whatever name. */
function publishedOrigins(program: ts.Program, checker: ts.TypeChecker): Set<string> {
  const entry = program.getSourceFile(path.join(SRC, 'index.ts'));
  const symbol = entry === undefined ? undefined : checker.getSymbolAtLocation(entry);
  const origins = new Set<string>();
  for (const exported of symbol === undefined ? [] : checker.getExportsOfModule(symbol)) {
    const target =
      (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported;
    for (const declaration of target.getDeclarations() ?? []) {
      origins.add(originOf(declaration));
    }
  }
  return origins;
}

/**
 * The functions a class member delegates to: the ones declared outside the
 * model layer that its body calls by name.
 *
 * A call through a plain identifier is a delegation — `analyzePolyphony(...)`
 * is the implementation `Score.voices` hands its caller. `this.notes()` and
 * `Key.fromJSON(...)` are the model talking to itself and are left out, as is
 * anything declared inside `src/model`, which is the class API's own scaffolding
 * rather than a capability it is the face of.
 */
function delegatesOf(
  member: ts.MethodDeclaration | ts.GetAccessorDeclaration,
  checker: ts.TypeChecker,
): ts.FunctionDeclaration[] {
  return callsOf(member, checker).filter(
    (declaration) => !declaration.getSourceFile().fileName.startsWith(`${MODEL}${path.sep}`),
  );
}

/** The functions this package declares that a body calls by name. */
function callsOf(node: ts.Node, checker: ts.TypeChecker): ts.FunctionDeclaration[] {
  const called = new Set<ts.FunctionDeclaration>();
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      const found = checker.getSymbolAtLocation(child.expression);
      const symbol =
        found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0
          ? checker.getAliasedSymbol(found)
          : found;
      for (const declaration of symbol?.getDeclarations() ?? []) {
        if (
          ts.isFunctionDeclaration(declaration) &&
          declaration.getSourceFile().fileName.startsWith(`${SRC}${path.sep}`)
        ) {
          called.add(declaration);
        }
      }
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return [...called];
}

/**
 * For each function no barrel exports, the published function that answers by
 * handing the question straight to it.
 *
 * An entry point that checks its arguments and then hands the work to an inner
 * reading is one capability written as two functions: the wrapper is what a
 * caller reaches for, and the inner one is what it runs. A class that holds a
 * value already checked calls the inner one — repeating the check on a profile
 * it copied at construction would be the second reading this layer exists not
 * to have — and in doing so runs exactly the code the published entry runs, so
 * the capability is on both APIs whatever the call graph looks like from here.
 *
 * "Hands it straight to" is what keeps this from excusing anything else: the
 * call has to be the whole of what a `return` in the wrapper evaluates, and no
 * second published function may answer through the same inner reading. A shared
 * helper several entry points call on the way to their own answers is not the
 * answer to any of them, so reaching it says nothing about reaching them. The
 * relation is read out of the wrapper's body rather than from a list of names,
 * so an inner reading that stops being one stops counting on the same run.
 */
function innerReadings(
  program: ts.Program,
  checker: ts.TypeChecker,
  published: Set<string>,
): Map<string, string> {
  const wrappers = new Map<string, Set<string>>();
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(`${SRC}${path.sep}`)) {
      continue;
    }
    for (const statement of file.statements) {
      if (!ts.isFunctionDeclaration(statement)) {
        continue;
      }
      const outer = statement.name?.text;
      if (outer === undefined || !published.has(originOf(statement))) {
        continue;
      }
      for (const inner of handedTo(statement, checker)) {
        const origin = originOf(inner);
        if (published.has(origin)) {
          continue;
        }
        const named = wrappers.get(origin) ?? new Set<string>();
        named.add(outer);
        wrappers.set(origin, named);
      }
    }
  }
  const single = new Map<string, string>();
  for (const [origin, named] of wrappers) {
    const only = [...named][0];
    if (named.size === 1 && only !== undefined) {
      single.set(origin, only);
    }
  }
  return single;
}

/** The functions a body returns the result of calling, unwrapped by nothing. */
function handedTo(node: ts.Node, checker: ts.TypeChecker): ts.FunctionDeclaration[] {
  const answered: ts.FunctionDeclaration[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isReturnStatement(child) && child.expression !== undefined) {
      answered.push(...calledDirectly(child.expression, checker));
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return answered;
}

/** The function an expression is a call to, if that is all the expression is. */
function calledDirectly(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.FunctionDeclaration[] {
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) {
    return [];
  }
  const found = checker.getSymbolAtLocation(expression.expression);
  const symbol =
    found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(found)
      : found;
  return (symbol?.getDeclarations() ?? []).filter(
    (declaration): declaration is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(declaration) &&
      declaration.getSourceFile().fileName.startsWith(`${SRC}${path.sep}`),
  );
}

/** The public runtime exports that are plain functions rather than classes. */
function publicFunctions(): string[] {
  return Object.entries(api as Record<string, unknown>)
    .filter(([name, value]) => typeof value === 'function' && !/^[A-Z]/.test(name))
    .map(([name]) => name)
    .sort();
}

describe('class coverage of the functional API', () => {
  const config = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const published = publishedOrigins(program, checker);
  const wrappers = innerReadings(program, checker, published);
  const reachable = reachableFromClasses(program, checker);
  // A class that calls an inner reading reaches the published wrapper around
  // it: same code, one name outward. See {@link innerReadings}.
  for (const file of program.getSourceFiles()) {
    for (const statement of file.statements) {
      if (!ts.isFunctionDeclaration(statement) || statement.name === undefined) {
        continue;
      }
      if (!reachable.has(statement.name.text)) {
        continue;
      }
      const outer = wrappers.get(originOf(statement));
      if (outer !== undefined) {
        reachable.add(outer);
      }
    }
  }
  const reaches = (name: string): boolean => reachable.has(name);

  it('reaches every public function that has a receiver to hang off', () => {
    // The class API promises that reaching for a class never costs capability.
    // A public function no class reaches is a reader who has to leave the
    // fluent style to finish the job, so it is listed here with its reason or
    // it is a gap.
    const unreachable = publicFunctions().filter(
      (name) => !reaches(name) && !(name in NOT_A_CLASS_METHOD),
    );
    expect(unreachable).toEqual([]);
  });

  it('lists nothing as function-only that a class already reaches', () => {
    // The list decays the other way too: once a class grows the method, the
    // entry stops describing anything and the next reader trusts it anyway.
    const stale = Object.keys(NOT_A_CLASS_METHOD)
      .filter((name) => reaches(name))
      .sort();
    expect(stale).toEqual([]);
  });

  it('lists nothing that is not a public function', () => {
    const published = new Set(publicFunctions());
    const absent = Object.keys(NOT_A_CLASS_METHOD)
      .filter((name) => !published.has(name))
      .sort();
    expect(absent).toEqual([]);
  });

  /** Each class member that hands its caller a function, with that function. */
  const faces = modelClasses(program).flatMap((declaration) =>
    membersOf(declaration).flatMap((member) =>
      delegatesOf(member, checker).map((delegate) => ({
        label: `${declaration.name?.text ?? '(anonymous)'}.${(member.name as ts.Identifier).text}`,
        name: delegate.name?.text ?? '(anonymous)',
        delegate,
      })),
    ),
  );

  it('finds the delegations to check', () => {
    // Derived from the sources, so a walk that stopped matching would leave the
    // two checks below passing over nothing at all.
    expect(faces.length).toBeGreaterThan(20);
  });

  it('publishes every function a class method delegates to', () => {
    // Reaching a function from a class is half of what the class API promises;
    // the other half is that the function is there to reach. One a method
    // delegates to but no barrel exports is implemented once and importable
    // nowhere, so that method is the only way to the capability and the
    // equivalence the two APIs are supposed to hold is not one a caller can
    // check. Neither list above can see it: both read the exports as given and
    // ask only which of them a class reaches, so a capability that never
    // reached the barrel is absent from the question as well as from the answer.
    // The root barrel is the union of the layer barrels, so a function it does
    // not carry is off every subpath too.
    const unpublished = faces
      .filter(
        ({ name, delegate }) =>
          !published.has(originOf(delegate)) &&
          !wrappers.has(originOf(delegate)) &&
          !(name in NOT_PUBLISHED),
      )
      .map(({ label, name }) => `${label} -> ${name}`)
      .sort();
    expect([...new Set(unpublished)]).toEqual([]);
  });

  it('lists nothing as unpublished that a class no longer reaches or the package now exports', () => {
    // The same decay the function-only list has: an entry whose function has
    // since been published, or that no class delegates to any more, describes
    // nothing and is trusted anyway.
    const live = new Map(faces.map(({ name, delegate }) => [name, delegate]));
    const stale = Object.keys(NOT_PUBLISHED)
      .filter((name) => {
        const delegate = live.get(name);
        return delegate === undefined || published.has(originOf(delegate));
      })
      .sort();
    expect(stale).toEqual([]);
  });
});
