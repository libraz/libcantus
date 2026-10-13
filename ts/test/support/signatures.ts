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
  /** The function the parameter belongs to; a class member reads as `Class.member`. */
  fn: string;
  /**
   * The exported name the declaration is reached under.
   *
   * For a free function it is the function itself; for a class member it is the
   * class, which is the name a barrel exports and a caller imports.
   */
  entry: string;
  /** Whether the declaration carries `export`; a class member inherits its class's. */
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

/** One field of one declared record type, as its declaration writes it. */
export type FieldInfo = {
  /** Path relative to the repository root. */
  file: string;
  /** The type the field belongs to. */
  record: string;
  /** The field's own name. */
  field: string;
  /** The declared type, verbatim. */
  type: string;
  /** Whether the type declaration carries `export`. */
  exported: boolean;
  /** 1-based line of the field. */
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

/** Whether a class member is part of the class's public surface. */
function isPublicMember(node: ts.ClassElement): boolean {
  const hidden = ts.ModifierFlags.Private | ts.ModifierFlags.Protected;
  return (
    (ts.getCombinedModifierFlags(node) & hidden) === 0 &&
    !ts.isPrivateIdentifier(node.name ?? ts.factory.createIdentifier(''))
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
  const source = parse(file);
  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== name) {
      continue;
    }
    if (ts.isUnionTypeNode(statement.type)) {
      return statement.type.types.map((member) =>
        ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)
          ? member.literal.text
          : '',
      );
    }
    // The other spelling of the same vocabulary: a frozen table of names, with
    // the union derived from it as `(typeof TABLE)[number]`. A name is checked
    // at run time against the table and at compile time against the union, so
    // reading either spelling is reading one declaration rather than two.
    const table = indexedTableOf(statement.type);
    if (table !== undefined) {
      return literalsOfTable(source, table, file, name);
    }
  }
  throw new Error(`${name} is not a string-literal union in ${file}`);
}

/** The table name behind `(typeof TABLE)[number]`, when the type is written that way. */
function indexedTableOf(type: ts.TypeNode): string | undefined {
  if (
    !ts.isIndexedAccessTypeNode(type) ||
    type.indexType.kind !== ts.SyntaxKind.NumberKeyword ||
    !ts.isParenthesizedTypeNode(type.objectType)
  ) {
    return undefined;
  }
  const inner = type.objectType.type;
  return ts.isTypeQueryNode(inner) && ts.isIdentifier(inner.exprName)
    ? inner.exprName.text
    : undefined;
}

/** The string literals a named table lists, whether or not it is frozen. */
function literalsOfTable(
  source: ts.SourceFile,
  table: string,
  file: string,
  name: string,
): string[] {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== table ||
        declaration.initializer === undefined
      ) {
        continue;
      }
      const literals = arrayLiteralOf(declaration.initializer);
      if (literals !== undefined) {
        return literals.elements.map((element) =>
          ts.isStringLiteral(element) ? element.text : '',
        );
      }
    }
  }
  throw new Error(`${name} is derived from ${table}, which is not a table of names in ${file}`);
}

/** The array literal an initializer names, through `Object.freeze` and `as const`. */
function arrayLiteralOf(node: ts.Expression): ts.ArrayLiteralExpression | undefined {
  let current = node;
  for (let step = 0; step < 4; step += 1) {
    if (ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isCallExpression(current) && current.arguments[0] !== undefined) {
      current = current.arguments[0];
      continue;
    }
    return ts.isArrayLiteralExpression(current) ? current : undefined;
  }
  return undefined;
}

/**
 * Every parameter of every callable declared at the top level of the given
 * files — free functions, and the public members of classes — including the
 * signatures of an overload set.
 *
 * Class members are read because the class API is a surface a caller reaches
 * directly: a method is as much an entry point as the free function beside it,
 * and a walk that stopped at function declarations measured none of the model
 * layer while reporting a count that looked complete.
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
    const record = (
      name: string,
      entry: string,
      node: ts.SignatureDeclarationBase,
      exported: boolean,
    ): void => {
      for (const param of node.parameters) {
        if (!ts.isIdentifier(param.name)) {
          continue;
        }
        found.push({
          file: rel,
          fn: name,
          entry,
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
        const name = statement.name.text;
        record(name, name, statement, isExported(statement));
        continue;
      }
      if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
        const className = statement.name.text;
        const exported = isExported(statement);
        for (const member of statement.members) {
          if (
            (!ts.isMethodDeclaration(member) && !ts.isConstructorDeclaration(member)) ||
            !isPublicMember(member)
          ) {
            continue;
          }
          const memberName = ts.isConstructorDeclaration(member)
            ? 'constructor'
            : member.name.getText(source);
          record(`${className}.${memberName}`, className, member, exported);
        }
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
          record(decl.name.text, decl.name.text, init, exported);
        }
      }
    }
  }
  return found;
}

/**
 * Every field of every record type declared at the top level of the given
 * files: an interface, a type alias over a type literal, and the literal halves
 * of an alias over an intersection.
 *
 * A record a caller fills in is an argument list under another name, so the
 * contracts that hold for a parameter hold for its fields too, and reading only
 * parameters leaves an options bag as the way around the rule.
 */
export function recordFields(files: readonly string[] = sourceFiles()): FieldInfo[] {
  const found: FieldInfo[] = [];
  for (const file of files) {
    const source = parse(file);
    const rel = relativeTo(path.dirname(SRC), file);
    const record = (name: string, members: ts.NodeArray<ts.TypeElement>, exported: boolean) => {
      for (const member of members) {
        if (!ts.isPropertySignature(member) || member.type === undefined) {
          continue;
        }
        found.push({
          file: rel,
          record: name,
          field: member.name.getText(source),
          type: member.type.getText(source).replace(/\s+/g, ' '),
          exported,
          line: lineOf(source, member),
        });
      }
    };
    for (const statement of source.statements) {
      const exported = isExported(statement);
      if (ts.isInterfaceDeclaration(statement)) {
        record(statement.name.text, statement.members, exported);
        continue;
      }
      if (!ts.isTypeAliasDeclaration(statement)) {
        continue;
      }
      const name = statement.name.text;
      if (ts.isTypeLiteralNode(statement.type)) {
        record(name, statement.type.members, exported);
      } else if (ts.isIntersectionTypeNode(statement.type)) {
        for (const part of statement.type.types) {
          if (ts.isTypeLiteralNode(part)) {
            record(name, part.members, exported);
          }
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
