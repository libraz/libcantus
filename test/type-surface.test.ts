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

/** Follow an alias to the symbol that actually declares the thing. */
function resolve_(symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

/**
 * Where a symbol is declared, as `file:pos`. Comparing declaration sites rather
 * than names is what lets a barrel rename on the way out — `Note as NoteData` —
 * without reading as a missing export.
 */
function originOf(symbol: ts.Symbol): string | undefined {
  const declaration = (resolve_(symbol).getDeclarations() ?? [])[0];
  return declaration === undefined
    ? undefined
    : `${declaration.getSourceFile().fileName}:${declaration.pos}`;
}

/** Declaration sites the barrel makes importable, under whatever name. */
function exportedOrigins(entry: string): Set<string> {
  const source = program.getSourceFile(entry);
  const symbol = source && checker.getSymbolAtLocation(source);
  const origins = new Set<string>();
  for (const exported of symbol ? checker.getExportsOfModule(symbol) : []) {
    const origin = originOf(exported);
    if (origin !== undefined) {
      origins.add(origin);
    }
  }
  return origins;
}

/** Every type this package declares that a module's public signatures mention. */
function referencedTypes(entry: string): Map<string, string> {
  const source = program.getSourceFile(entry);
  const symbol = source && checker.getSymbolAtLocation(source);
  const found = new Map<string, string>();
  for (const exported of symbol ? checker.getExportsOfModule(symbol) : []) {
    // A barrel exports aliases, whose own declaration is the `export {}`
    // specifier and mentions no types at all. Resolve to the declaration the
    // alias points at, or the check reads every re-export barrel as empty.
    const declaration = (resolve_(exported).getDeclarations() ?? [])[0];
    if (declaration === undefined) {
      continue;
    }
    // A pure rename (`export type Section = PublicSection`) publishes the name
    // consumers actually write; the internal name behind it is never needed.
    if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeReferenceNode(declaration.type)) {
      continue;
    }
    const visit = (node: ts.Node): void => {
      // A function body's local types are implementation detail, not surface.
      if (ts.isBlock(node)) {
        return;
      }
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const referenced = checker.getSymbolAtLocation(node.typeName);
        const target = referenced && resolve_(referenced);
        const site = (target?.getDeclarations() ?? [])[0];
        const origin =
          site === undefined || ts.isTypeParameterDeclaration(site)
            ? undefined
            : `${site.getSourceFile().fileName}:${site.pos}`;
        // Only types this package declares matter; lib types resolve anyway.
        if (origin?.startsWith(resolve(ROOT, 'src'))) {
          found.set(origin, node.typeName.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration);
  }
  return found;
}

describe('every layer names its own public types', () => {
  it.each(LAYERS)('%s exports every type its signatures mention', (layer) => {
    const entry = resolve(ROOT, 'src', layer, 'index.ts');
    const exported = exportedOrigins(entry);
    const missing = [...referencedTypes(entry)]
      .filter(([origin]) => !exported.has(origin))
      .map(([, name]) => name);
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
      exports: Record<
        string,
        string | { import: Record<string, string>; require: Record<string, string> }
      >;
      typesVersions: Record<string, Record<string, string[]>>;
    };
    for (const [subpath, conditions] of Object.entries(pkg.exports)) {
      if (typeof conditions === 'string') {
        // A file exposed verbatim, such as the manifest itself.
        expect(subpath, subpath).toBe(conditions.replace(/^\./, '.'));
        continue;
      }
      expect(conditions.import.types, subpath).toMatch(/\.d\.ts$/);
      expect(conditions.require.types, subpath).toMatch(/\.d\.cts$/);
      expect(conditions.import.default, subpath).toMatch(/\.js$/);
      expect(conditions.require.default, subpath).toMatch(/\.cjs$/);
    }
    for (const layer of LAYERS) {
      expect(Object.keys(pkg.exports)).toContain(`./${layer}`);
      // The pre-`exports` resolver ignores the map entirely and reads this.
      expect(pkg.typesVersions['*']?.[layer], layer).toEqual([`./dist/${layer}/index.d.ts`]);
    }
  });
});
