import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Every type named in a layer's public signatures must be importable from that
 * layer's own subpath. Deriving the check from the sources rather than listing
 * the names by hand is the point: a type that quietly stops being re-exported
 * breaks `import type { X } from '@libraz/libcantus/<layer>'` for consumers of
 * that subpath, and a hand-maintained list never notices.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAYERS = ['core', 'theory', 'analyze', 'generate', 'model'] as const;

/** Type names that come from the TypeScript or DOM lib rather than this package. */
const AMBIENT = new Set([
  'Array',
  'Set',
  'Map',
  'Record',
  'Readonly',
  'ReadonlyArray',
  'Partial',
  'Pick',
  'Omit',
  'Exclude',
  'Promise',
  'Iterable',
  'IterableIterator',
]);

const program = ts.createProgram(
  LAYERS.map((layer) => resolve(ROOT, 'src', layer, 'index.ts')).concat(
    resolve(ROOT, 'src/index.ts'),
  ),
  {
    ...ts.getDefaultCompilerOptions(),
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
  },
);
const checker = program.getTypeChecker();

/** The names a module's barrel exports, types and values alike. */
function exportedNames(entry: string): Set<string> {
  const source = program.getSourceFile(entry);
  expect(source, entry).toBeDefined();
  const symbol = source && checker.getSymbolAtLocation(source);
  expect(symbol, entry).toBeDefined();
  return new Set((symbol ? checker.getExportsOfModule(symbol) : []).map((s) => s.getName()));
}

/** Every type-reference name appearing in a module's exported declarations. */
function referencedTypeNames(entry: string): Set<string> {
  const source = program.getSourceFile(entry);
  const symbol = source && checker.getSymbolAtLocation(source);
  const names = new Set<string>();
  for (const exported of symbol ? checker.getExportsOfModule(symbol) : []) {
    const declaration = (exported.getDeclarations() ?? [])[0];
    if (declaration === undefined) {
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        names.add(node.typeName.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration);
  }
  return names;
}

/** Whether a referenced name is declared anywhere under this package's src. */
function isOwnType(name: string, entry: string): boolean {
  const source = program.getSourceFile(entry);
  const symbol = source && checker.getSymbolAtLocation(source);
  for (const exported of symbol ? checker.getExportsOfModule(symbol) : []) {
    for (const declaration of exported.getDeclarations() ?? []) {
      const file = declaration.getSourceFile().fileName;
      if (file.startsWith(resolve(ROOT, 'src')) && exported.getName() === name) {
        return true;
      }
    }
  }
  return false;
}

describe('every layer names its own public types', () => {
  it.each(LAYERS)('%s exports every type its signatures mention', (layer) => {
    const entry = resolve(ROOT, 'src', layer, 'index.ts');
    const exported = exportedNames(entry);
    const missing = [...referencedTypeNames(entry)].filter((name) => {
      if (AMBIENT.has(name) || exported.has(name)) {
        return false;
      }
      // Only names this package declares matter; lib types resolve for consumers.
      const declared = program
        .getSourceFiles()
        .some(
          (file) =>
            file.fileName.startsWith(resolve(ROOT, 'src')) &&
            new RegExp(`\\b(type|interface|enum|class)\\s+${name}\\b`).test(file.text),
        );
      return declared;
    });
    expect(missing, `${layer}/index.ts does not re-export: ${missing.join(', ')}`).toEqual([]);
  });

  it('the root barrel is the union of the layer barrels', () => {
    const root = exportedNames(resolve(ROOT, 'src/index.ts'));
    for (const layer of LAYERS) {
      for (const name of exportedNames(resolve(ROOT, 'src', layer, 'index.ts'))) {
        expect(root.has(name), `root barrel is missing ${name} from ${layer}`).toBe(true);
      }
    }
  });

  it('no two layer barrels export different things under the same name', () => {
    // The root barrel star-exports all five layers, so two layers exporting
    // different declarations under one name would silently drop one of them.
    // Re-exporting the same declaration from two layers is fine and deliberate.
    const seen = new Map<string, { layer: string; origin: string }>();
    const collisions: string[] = [];
    for (const layer of LAYERS) {
      const entry = resolve(ROOT, 'src', layer, 'index.ts');
      const source = program.getSourceFile(entry);
      const moduleSymbol = source && checker.getSymbolAtLocation(source);
      for (const exported of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
        const name = exported.getName();
        const target =
          exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        const declaration = (target.getDeclarations() ?? [])[0];
        const origin =
          declaration === undefined
            ? name
            : `${declaration.getSourceFile().fileName}:${declaration.pos}`;
        const previous = seen.get(name);
        if (previous !== undefined && previous.origin !== origin) {
          collisions.push(`${name} (${previous.layer} and ${layer})`);
        }
        seen.set(name, { layer, origin });
      }
    }
    expect(collisions, 'two layers export different declarations under one name').toEqual([]);
  });

  it('declares a build output for every subpath the exports map advertises', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, { import: Record<string, string>; require: Record<string, string> }>;
    };
    for (const [subpath, conditions] of Object.entries(pkg.exports)) {
      expect(conditions.import.types, subpath).toMatch(/\.d\.ts$/);
      expect(conditions.require.types, subpath).toMatch(/\.d\.cts$/);
      expect(conditions.import.default, subpath).toMatch(/\.js$/);
      expect(conditions.require.default, subpath).toMatch(/\.cjs$/);
    }
    for (const layer of LAYERS) {
      expect(Object.keys(pkg.exports)).toContain(`./${layer}`);
    }
  });
});
