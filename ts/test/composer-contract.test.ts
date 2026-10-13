import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tsdocExamples } from './support/doc-examples.js';
import { PACKAGE_ROOT } from './support/source-files.js';

describe('the examples on the composer', () => {
  it('import from the package rather than from the source tree', () => {
    const source = readFileSync(path.join(PACKAGE_ROOT, 'src', 'model', 'composer.ts'), 'utf8');
    const specifiers = tsdocExamples(source)
      .flatMap((block) => block.code.split('\n'))
      .map((line) => line.match(/^import\s.*\sfrom\s+'([^']+)';?$/)?.[1])
      .filter((specifier): specifier is string => specifier !== undefined);

    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier, specifier).toMatch(/^@libraz\/libcantus(\/.+)?$/);
    }
  });
});
