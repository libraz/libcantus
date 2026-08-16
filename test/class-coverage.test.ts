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

  // Type guards over untyped material. They narrow before a value is a value
  // object at all, which is upstream of every class.
  isDrumPattern: 'type guard over untyped material',
  isLickMaterial: 'type guard over untyped material',

  // Predicates on a bare semitone count. The class-side reading is spelled,
  // so `Interval` answers through `classifySpelledInterval` instead.
  classifyInterval: 'predicate on an unspelled semitone count',
  isPerfectInterval: 'predicate on an unspelled semitone count',

  // Finer-grained siblings of a predicate a class does reach. `Voicing` asks
  // `createsParallelPerfect`; these split the same answer by interval.
  createsParallelOctave: 'finer-grained sibling of createsParallelPerfect',
  createsParallelUnison: 'finer-grained sibling of createsParallelPerfect',

  // The seedable generator itself. A class reaches the namespaced form through
  // its generation context; this is the primitive underneath it.
  createRng: 'primitive under the namespaced generator',

  // Catalogue readers. They answer about the library's own tables rather than
  // about a value, so there is no receiver for them to hang off.
  progressions: 'reads the built-in catalogue',
  progressionsByStyle: 'reads the built-in catalogue',
  pickVocabulary: 'reads the built-in catalogue',
  mergeVocabulary: 'combines catalogue entries',
  drumVoiceOf: 'reads the drum-kit table',

  // Text classification that runs before a name is parsed at all.
  detectNoteNameSystem: 'classifies text before it names a note',

  // A shortcut over a path the class API already spells out as
  // `Chord.parse(text).transpose(n).symbol()`.
  transposeChordSymbol: 'shortcut over parse, transpose, and print',

  // Grid-event transforms shared by the generators. They operate on the event
  // arrays a generator passes between its own stages, not on a value object.
  double: 'transform between generator stages',
  imitate: 'transform between generator stages',
  placeDrumPattern: 'transform between generator stages',
  placeLicks: 'transform between generator stages',
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
 * Every name a class file reaches, following each one it finds into its own
 * declaration and on through that body. A one-level scan of the imports would
 * miss most of the surface, because a class reaches `parseNote` through the
 * coercer rather than by importing it.
 */
function reachableFromClasses(program: ts.Program, checker: ts.TypeChecker): Set<string> {
  const seen = new Set<ts.Symbol>();
  const names = new Set<string>();
  const queue: ts.Node[] = classSources(program);

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const found = checker.getSymbolAtLocation(node);
      const symbol =
        found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0
          ? checker.getAliasedSymbol(found)
          : found;
      if (symbol !== undefined && !seen.has(symbol)) {
        seen.add(symbol);
        names.add(symbol.name);
        for (const declaration of symbol.getDeclarations() ?? []) {
          if (declaration.getSourceFile().fileName.startsWith(SRC)) {
            queue.push(declaration);
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

/**
 * Whether `name` is a public wrapper whose whole body delegates to work the
 * classes already reach.
 *
 * Widening an entry point to the text form leaves the narrow implementation
 * behind as a twin, and a class calls the twin because it holds resolved data
 * already. Reading only the symbol the class names would then report the entry
 * point as unreachable while the class takes exactly the same path with the
 * argument resolved one step earlier.
 */
function delegatesToReached(
  program: ts.Program,
  checker: ts.TypeChecker,
  reached: ReadonlySet<string>,
  published: ReadonlySet<string>,
  name: string,
): boolean {
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(SRC)) {
      continue;
    }
    for (const statement of file.statements) {
      if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== name) {
        continue;
      }
      // Only what the wrapper hands back counts, and only when the delegate is
      // private: a validator it calls first is reached by everything, and a
      // public delegate means the wrapper is one entry point calling another
      // rather than the resolved half of one.
      const returned: string[] = [];
      const walk = (node: ts.Node): void => {
        if (
          ts.isReturnStatement(node) &&
          node.expression !== undefined &&
          ts.isCallExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression)
        ) {
          const callee = node.expression.expression;
          const found = checker.getSymbolAtLocation(callee);
          const symbol =
            found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0
              ? checker.getAliasedSymbol(found)
              : found;
          returned.push(symbol?.name ?? callee.text);
        }
        ts.forEachChild(node, walk);
      };
      ts.forEachChild(statement, walk);
      return (
        returned.length > 0 &&
        returned.every((callee) => reached.has(callee) && !published.has(callee))
      );
    }
  }
  return false;
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
  const published = new Set(publicFunctions());
  const reaches = (name: string): boolean =>
    reachable.has(name) || delegatesToReached(program, checker, reachable, published, name);

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
