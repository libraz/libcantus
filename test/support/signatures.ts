import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { filesUnder, SRC } from './source-files.js';

/**
 * Syntactic readings of the library's own sources, shared by every check that
 * derives its subject from the tree rather than from a list somebody wrote.
 *
 * The readings are syntactic on purpose: a check asks what a signature *says*,
 * not what a type checker infers it to mean. A parameter declared `KeyScale` is
 * the defect even when every caller happens to pass a full key, because the
 * declaration is what the next caller reads. Parsing also costs a fraction of
 * building a program, and these checks walk the whole tree on every run.
 */

/** One parameter of one declared function, as its declaration writes it. */
export type ParamInfo = {
  /** Path relative to the repository root, so a failure names a file a reader can open. */
  file: string;
  /** The function the parameter belongs to. */
  fn: string;
  /** Whether the declaration carries `export`. */
  exported: boolean;
  /** The parameter's own name. */
  param: string;
  /** The declared type, verbatim; empty when the declaration gives none. */
  type: string;
  /** Whether the declaration supplies a default value. */
  hasDefault: boolean;
  /** 1-based line of the declaration. */
  line: number;
};

/** One top-level declaration, by the name it is declared under. */
export type DeclInfo = {
  /** Path relative to the repository root. */
  file: string;
  /** The declared name. */
  name: string;
  /** What kind of declaration introduced the name. */
  kind: 'function' | 'variable' | 'type' | 'class' | 'interface' | 'enum';
  /** Whether the declaration carries `export`. */
  exported: boolean;
  /** 1-based line of the declaration. */
  line: number;
};

/** One import, with the names it brings in. */
export type ImportInfo = {
  /** Path relative to the repository root. */
  file: string;
  /** The module specifier, verbatim. */
  spec: string;
  /** The names bound by the import; empty for a bare or namespace import. */
  names: string[];
  /** 1-based line of the import. */
  line: number;
};

/** Every `.ts` file under `src`, absolute. */
export function sourceFiles(): string[] {
  return filesUnder(SRC, '.ts');
}

/** A file's path as a failure message should name it. */
export function relativeTo(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

/** Parse one file into a syntax tree, with no program and no type checker. */
function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
}

/** Whether a node's modifiers carry `export`. */
function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** The 1-based line a node starts on. */
function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/**
 * The string members a declared union type lists, in declaration order.
 *
 * For the checks whose subject is a vocabulary: a member added to the union is
 * carried into the check without anybody adding it there too, which is the
 * whole reason to read the declaration instead of restating it.
 *
 * Throws rather than answering empty when the type is not there or is not such
 * a union: a check whose subject silently became nothing would pass by
 * measuring no members at all.
 *
 * @param file Absolute path of the file declaring the type.
 * @param name The type alias to read.
 * @returns Its string-literal members.
 * @throws If the file declares no such alias, or the alias is not a union of
 *   string literals.
 */
export function unionMembers(file: string, name: string): string[] {
  for (const statement of parse(file).statements) {
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === name &&
      ts.isUnionTypeNode(statement.type)
    ) {
      return statement.type.types.map((member) =>
        ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)
          ? member.literal.text
          : '',
      );
    }
  }
  throw new Error(`${name} is not a string-literal union in ${file}`);
}

/**
 * Every parameter of every function declared at the top level of the given
 * files, including the signatures of an overload set.
 *
 * Overloads are read one by one rather than through their implementation: the
 * implementation of an overloaded function is written to accept the union of
 * what its signatures accept, so reading only the implementation would report a
 * contract no caller can see.
 */
export function functionParams(files: readonly string[] = sourceFiles()): ParamInfo[] {
  const found: ParamInfo[] = [];
  for (const file of files) {
    const source = parse(file);
    const rel = relativeTo(path.dirname(SRC), file);
    const record = (name: string, node: ts.SignatureDeclarationBase, exported: boolean): void => {
      for (const param of node.parameters) {
        if (!ts.isIdentifier(param.name)) {
          continue;
        }
        found.push({
          file: rel,
          fn: name,
          exported,
          param: param.name.text,
          type: param.type === undefined ? '' : param.type.getText(source).replace(/\s+/g, ' '),
          hasDefault: param.initializer !== undefined,
          line: lineOf(source, node),
        });
      }
    };
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
        record(statement.name.text, statement, isExported(statement));
        continue;
      }
      if (!ts.isVariableStatement(statement)) {
        continue;
      }
      const exported = isExported(statement);
      for (const decl of statement.declarationList.declarations) {
        const init = decl.initializer;
        if (
          ts.isIdentifier(decl.name) &&
          init !== undefined &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          record(decl.name.text, init, exported);
        }
      }
    }
  }
  return found;
}

/** Every name declared at the top level of the given files. */
export function declarations(files: readonly string[] = sourceFiles()): DeclInfo[] {
  const found: DeclInfo[] = [];
  for (const file of files) {
    const source = parse(file);
    const rel = relativeTo(path.dirname(SRC), file);
    const push = (name: string, kind: DeclInfo['kind'], node: ts.Node, exported: boolean): void => {
      found.push({ file: rel, name, kind, exported, line: lineOf(source, node) });
    };
    for (const statement of source.statements) {
      const exported = isExported(statement);
      if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
        push(statement.name.text, 'function', statement, exported);
      } else if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
        push(statement.name.text, 'class', statement, exported);
      } else if (ts.isInterfaceDeclaration(statement)) {
        push(statement.name.text, 'interface', statement, exported);
      } else if (ts.isTypeAliasDeclaration(statement)) {
        push(statement.name.text, 'type', statement, exported);
      } else if (ts.isEnumDeclaration(statement)) {
        push(statement.name.text, 'enum', statement, exported);
      } else if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            push(decl.name.text, 'variable', statement, exported);
          }
        }
      }
    }
  }
  return found;
}

/** Every import of the given files, with the names each one binds. */
export function importsOf(files: readonly string[] = sourceFiles()): ImportInfo[] {
  const found: ImportInfo[] = [];
  for (const file of files) {
    const source = parse(file);
    const rel = relativeTo(path.dirname(SRC), file);
    for (const statement of source.statements) {
      const isImport = ts.isImportDeclaration(statement);
      const isReexport =
        ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined;
      if (!isImport && !isReexport) {
        continue;
      }
      const specifier = isImport ? statement.moduleSpecifier : statement.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) {
        continue;
      }
      const names: string[] = [];
      const bindings = isImport ? statement.importClause?.namedBindings : statement.exportClause;
      if (bindings !== undefined && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
        for (const element of bindings.elements) {
          names.push((element.propertyName ?? element.name).text);
        }
      }
      found.push({ file: rel, spec: specifier.text, names, line: lineOf(source, statement) });
    }
  }
  return found;
}

/** The file a relative specifier names, with the `.js` extension mapped back to source. */
export function resolveSpecifier(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) {
    return null;
  }
  const base = path.resolve(path.dirname(from), spec).replace(/\.js$/, '.ts');
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // Not this shape; try the next.
    }
  }
  return null;
}
