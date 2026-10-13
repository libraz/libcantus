import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { MODAL_CANDIDATES, modalProfileVector } from '../src/analyze/detect/modes.js';
import { KRUMHANSL_KESSLER_PROFILE } from '../src/analyze/detect/profiles.js';

describe('modal key candidates', () => {
  it('substitutes the same degrees in the profile as in the scale', () => {
    for (const candidate of MODAL_CANDIDATES) {
      const parent = candidate.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
      const substituted = parent.map((degree) => {
        const swap = candidate.substitutions.find(([replaced]) => replaced === degree);
        return swap === undefined ? degree : swap[1];
      });
      let mask = 0;
      for (const degree of substituted) {
        mask |= 1 << degree;
      }
      expect(mask, candidate.scaleName).toBe(candidate.mask);
    }
  });

  it('derives every modal profile as a permutation of its parent', () => {
    for (const candidate of MODAL_CANDIDATES) {
      const parent =
        candidate.mode === 'major'
          ? KRUMHANSL_KESSLER_PROFILE.major
          : KRUMHANSL_KESSLER_PROFILE.minor;
      const vector = modalProfileVector(KRUMHANSL_KESSLER_PROFILE, candidate);
      // A permutation shares the parent's mean and variance, which is what keeps
      // modal and diatonic correlations comparable.
      expect([...vector].sort(), candidate.scaleName).toEqual([...parent].sort());
      for (const [replaced, replacing] of candidate.substitutions) {
        expect(vector[replacing], candidate.scaleName).toBe(parent[replaced]);
      }
    }
  });
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every name a barrel publishes, counting both sides of a renaming re-export. */
function publishedNames(file: string): Set<string> {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  );
  const names = new Set<string>();
  const exported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
          if (element.propertyName !== undefined) {
            names.add(element.propertyName.text);
          }
        }
      }
      continue;
    }
    if (!exported(statement)) {
      continue;
    }
    if (
      (ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.add(declaration.name.text);
        }
      }
    }
  }
  return names;
}

describe('the recognition module reaches the shipped surface', () => {
  it('carries every name of its public block up to the analyze barrel', () => {
    // A type listed in a module's export block reads as part of that module's
    // surface; one the layer barrel never picks up is a name a consumer can see
    // in the source and cannot import. The layer is where that is decided — the
    // root barrel is the union of the layers, which `type-surface` checks.
    const layer = publishedNames(path.join(ROOT, 'src/analyze/index.ts'));
    const missing = [...publishedNames(path.join(ROOT, 'src/analyze/detect/index.ts'))]
      .filter((name) => !layer.has(name))
      .sort();
    expect(missing).toEqual([]);
  });
});
