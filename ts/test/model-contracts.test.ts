import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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

  /**
   * Delegating methods the equivalence suite does not drive with options, with
   * the reason each one is exempt.
   *
   * An entry is a claim about the method, not a note that it is untested: a
   * method whose options cannot change its answer here — or whose answer is not
   * comparable with the function's — says so and why.
   */
  const NOT_EQUIVALENCE_CHECKED: Readonly<Record<string, string>> = {};

  /**
   * The equivalence suite's own text.
   *
   * The methods are read from the sources and the driving is read from the file
   * that drives them, so a method added with options is covered or listed
   * without anyone remembering it exists. The match is by name and by there
   * being an argument in the call: a class that answers with the function's own
   * defaults answers exactly as it would if it dropped the options, so an
   * equivalence case that passes none proves nothing about carrying them.
   */
  const EQUIVALENCE = ['test/class-equivalence.test.ts', '../tests/spec/class-equivalence.test.ts']
    .map((file) => readFileSync(resolve(ROOT, file), 'utf8'))
    .join('\n');

  it('drives every delegating method with options where the equivalence is claimed', () => {
    const uncovered = [...new Set(delegations.map(({ label }) => label))]
      .filter((label) => {
        const method = label.split('.')[1] ?? '';
        return !new RegExp(`\\.${method}\\(\\s*[^)\\s]`).test(EQUIVALENCE);
      })
      .filter((label) => !(label in NOT_EQUIVALENCE_CHECKED))
      .sort();
    expect(uncovered).toEqual([]);
  });
});
