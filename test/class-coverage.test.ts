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
  assertNoteEvents: 'validator for a caller boundary',
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
  const reachable = reachableFromClasses(program, checker);
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
});
