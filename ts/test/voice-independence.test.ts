import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Note } from '../src/core/pitch/index.js';
import { parseNote, spelledInterval } from '../src/core/pitch/index.js';
import { REPO_ROOT } from './support/source-files.js';

/** Spell one slot per beat; a dash is a rest. */
function slots(names: string): (Note | null)[] {
  return names.split(' ').map((name) => (name === '-' ? null : parseNote(name)));
}

describe('the worked example the guide and the TSDoc carry', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  /** Interval numbers as the guides spell them in English. */
  const ORDINALS: Record<number, string> = {
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'octave',
    9: 'ninth',
    10: 'tenth',
  };
  const lead = slots('C5 D5 E5');
  const counter = slots('E4 F4 G4');
  /** What the library itself calls the distance the example is written at. */
  const numbers = lead.map((note, index) =>
    note === null ? 0 : spelledInterval(counter[index] as Note, note).number,
  );

  it('is named by the interval the library reports for it, in every artifact', () => {
    // An example is the one place a reader takes an interval name on trust, so
    // the name is checked against the notes rather than against a memory of
    // them: rewrite the notes and every artifact naming them has to follow.
    const number = numbers[0] as number;
    const tsdoc = readFileSync(path.join(ROOT, 'src/theory/counterpoint/independence.ts'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('motion.parallel;'));
    expect(tsdoc).toHaveLength(1);
    expect(tsdoc[0]).toContain(ORDINALS[number] as string);

    const paragraph = (lang: string, marker: string) => {
      const found = readFileSync(
        path.join(REPO_ROOT, 'docs', lang, 'counterpoint-and-part-writing.md'),
        'utf8',
      )
        .replace(/^```[\s\S]*?^```/gm, '')
        .split(/\n\s*\n/)
        .filter((block) => block.startsWith('`motion`'));
      expect(found, lang).toHaveLength(1);
      expect(found[0], lang).toContain(marker);
    };
    paragraph('en', ORDINALS[number] as string);
    paragraph('ja', `${number}度`);
  });
});
