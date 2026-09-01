import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { formatBarPosition, formatTimeSignature } from '../src/core/meter/index.js';
import { Meter } from '../src/model/meter.js';
import { ROOT } from './support/source-files.js';

/** The guides that describe the meter formatters, in both languages. */
const GUIDES = ['docs/en/time-and-arrangement.md', 'docs/ja/time-and-arrangement.md'].map(
  (file) => ({
    file,
    text: readFileSync(path.join(ROOT, file), 'utf8'),
  }),
);

describe('what rendering a signature with its grouping promises', () => {
  it('refuses a grouping counted in pulses whose groups differ', () => {
    // 12/8 grouped 1+1+2 accents the third dotted pulse. The plain form cannot
    // say so and the additive form would read the bar as twelve quavers, so the
    // request is refused rather than answered with another bar.
    const uneven = Meter.of(12, 8, [1, 1, 2]);
    expect(() => uneven.format({ grouping: true })).toThrow(InvalidInputError);
    expect(() => formatTimeSignature(uneven.data, { grouping: true })).toThrow(InvalidInputError);
    // Without the grouping asked for it is the bar it is named after.
    expect(uneven.format()).toBe('12/8');
  });

  it('falls back to the plain form only where the groups are equal', () => {
    // Equal groups counted in pulses state the division the bare signature
    // already has, so dropping them drops nothing.
    expect(Meter.of(12, 8, [1, 1, 1, 1]).format({ grouping: true })).toBe('12/8');
    expect(Meter.of(9, 8, [1, 1, 1]).format({ grouping: true })).toBe('9/8');
    // A grouping counted in denominator units has an additive spelling.
    expect(Meter.of(7, 8, [2, 2, 3]).format({ grouping: true })).toBe('2+2+3/8');
  });

  it('is described the same way in both guides', () => {
    for (const { file, text } of GUIDES) {
      expect(text, file).toContain('InvalidInputError');
      expect(text, file).toContain('[1, 1, 2]');
    }
  });
});

describe('the forms a formatted position comes in', () => {
  /** `bar.beat` on a felt beat, `bar.beat+fraction` between them. */
  const FORMS = /^-?\d+\.\d+(\+\d+(\.\d+)?)?$/;

  it('prints the fraction form between felt beats', () => {
    const sixEight = Meter.parse('6/8');
    expect(sixEight.formatPosition(7.5)).toBe('3.2');
    expect(sixEight.formatPosition(8.25)).toBe('3.2+0.5');
    expect(formatBarPosition(8.25, '6/8')).toBe('3.2+0.5');
    // The function and the method print one position one way.
    for (let beat = 0; beat < 12; beat += 0.125) {
      expect(sixEight.formatPosition(beat), `@${beat}`).toBe(formatBarPosition(beat, '6/8'));
    }
  });

  it('prints one of the two documented forms at every offset', () => {
    for (const signature of ['4/4', '3/4', '6/8', '2+2+3/8']) {
      const meter = Meter.parse(signature);
      for (let beat = -4; beat < 8; beat += 0.125) {
        const text = meter.formatPosition(beat);
        expect(text, `${signature} @${beat}`).toMatch(FORMS);
      }
    }
  });

  it('shows both forms in both guides', () => {
    for (const { file, text } of GUIDES) {
      expect(text, file).toContain("formatBarPosition(7.5, sixEight); // '3.2'");
      expect(text, file).toContain("formatBarPosition(8.25, sixEight); // '3.2+0.5'");
    }
  });
});
