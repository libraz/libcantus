import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './support/source-files.js';

/** The guides that describe the meter formatters, in both languages. */
const GUIDES = ['docs/en/time-and-arrangement.md', 'docs/ja/time-and-arrangement.md'].map(
  (file) => ({
    file,
    text: readFileSync(path.join(REPO_ROOT, file), 'utf8'),
  }),
);

describe('what rendering a signature with its grouping promises', () => {
  it('is described the same way in both guides', () => {
    for (const { file, text } of GUIDES) {
      expect(text, file).toContain('InvalidInputError');
      expect(text, file).toContain('[1, 1, 2]');
    }
  });
});

describe('the forms a formatted position comes in', () => {
  it('shows both forms in both guides', () => {
    for (const { file, text } of GUIDES) {
      expect(text, file).toContain("formatBarPosition(7.5, sixEight); // '3.2'");
      expect(text, file).toContain("formatBarPosition(8.25, sixEight); // '3.2+0.5'");
    }
  });
});
