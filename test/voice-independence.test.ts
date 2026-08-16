import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Note } from '../src/core/pitch/index.js';
import { parseNote, spelledInterval } from '../src/core/pitch/index.js';
import { voiceIndependence } from '../src/theory/counterpoint/index.js';

/** Spell one slot per beat; a dash is a rest. */
function slots(names: string): (Note | null)[] {
  return names.split(' ').map((name) => (name === '-' ? null : parseNote(name)));
}

describe('motion breakdown', () => {
  it('reads a harmony line in thirds as parallel motion', () => {
    const report = voiceIndependence(slots('C5 D5 E5 F5'), slots('A4 B4 C5 D5'));
    expect(report.motion).toEqual({ contrary: 0, oblique: 0, similar: 0, parallel: 1 });
  });

  it('reads a pedal point as oblique motion', () => {
    const report = voiceIndependence(slots('C5 D5 E5 F5'), slots('G3 G3 G3 G3'));
    expect(report.motion.oblique).toBe(1);
  });

  it('reads a bass moving against the lead as contrary motion', () => {
    const report = voiceIndependence(slots('C5 D5 E5'), slots('G3 F3 E3'));
    expect(report.motion.contrary).toBe(1);
  });

  it('separates similar motion from parallel by whether the interval holds', () => {
    // Both rise, but a sixth opens into an octave: similar, not parallel.
    const report = voiceIndependence(slots('A4 C5'), slots('C4 C4'));
    expect(report.motion.oblique).toBe(1);
    const opening = voiceIndependence(slots('A4 C5'), slots('C4 D4'));
    expect(opening.motion.similar).toBe(1);
  });

  it('leaves a slot where neither voice moves out of the breakdown', () => {
    const report = voiceIndependence(slots('C5 C5 D5'), slots('A4 A4 B4'));
    expect(report.motion.parallel).toBe(1);
  });

  it('reports all zeroes when nothing moves', () => {
    const report = voiceIndependence(slots('C5 C5'), slots('A4 A4'));
    expect(report.motion).toEqual({ contrary: 0, oblique: 0, similar: 0, parallel: 0 });
  });
});

describe('rhythmic complementarity', () => {
  it('is 1 when the counter attacks on every slot the lead holds through', () => {
    const report = voiceIndependence(slots('C5 C5 C5 C5'), slots('E4 F4 G4 A4'));
    expect(report.rhythmicComplementarity).toBe(1);
  });

  it('counts a rest in the lead as a slot to fill', () => {
    const report = voiceIndependence(slots('C5 - - C5'), slots('E4 F4 G4 A4'));
    expect(report.rhythmicComplementarity).toBe(1);
  });

  it('is 0 for a counter glued to the lead', () => {
    const report = voiceIndependence(slots('C5 D5 E5'), slots('A4 B4 C5'));
    expect(report.rhythmicComplementarity).toBe(0);
  });

  it('is 0 when the lead never holds or rests', () => {
    const report = voiceIndependence(slots('C5 D5'), slots('A4 A4'));
    expect(report.rhythmicComplementarity).toBe(0);
  });

  it('takes the caller attack flags over the note-change reading', () => {
    const lead = slots('C5 C5 C5');
    const counter = slots('E4 E4 E4');
    const report = voiceIndependence(lead, counter, {
      leadAttacks: [true, false, false],
      counterAttacks: [true, true, true],
    });
    expect(report.rhythmicComplementarity).toBe(1);
  });
});

describe('separation and crossings', () => {
  it('measures the mean and closest gap in semitones', () => {
    const report = voiceIndependence(slots('C5 C5'), slots('C4 E4'));
    expect(report.separation).toEqual({ mean: 10, min: 8 });
    expect(report.sounding).toBe(2);
  });

  it('counts only the slots that depart from the prevailing order', () => {
    const report = voiceIndependence(slots('C5 C5 C4'), slots('C4 E4 E4'));
    expect(report.crossings).toBe(1);
  });

  it('reports zero separation when the two lines never sound together', () => {
    const report = voiceIndependence(slots('C5 -'), slots('- E4'));
    expect(report.separation).toEqual({ mean: 0, min: 0 });
    expect(report.sounding).toBe(0);
  });
});

describe('perfect consonance runs', () => {
  it('measures a power-chord line as a long run rather than a fault', () => {
    const report = voiceIndependence(slots('C5 D5 E5 F5'), slots('C4 D4 E4 F4'));
    expect(report.longestPerfectRun).toBe(4);
    expect(report.motion.parallel).toBe(1);
  });

  it('breaks the run on a third', () => {
    const report = voiceIndependence(slots('C5 D5 E5'), slots('C4 B3 A3'));
    expect(report.longestPerfectRun).toBe(1);
  });

  it('counts the fourth only when asked to', () => {
    const lead = slots('C5 D5');
    const counter = slots('G4 A4');
    expect(voiceIndependence(lead, counter).longestPerfectRun).toBe(0);
    expect(voiceIndependence(lead, counter, { countFourths: true }).longestPerfectRun).toBe(2);
  });
});

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

  it('is a harmony line at one interval throughout, and reports as parallel', () => {
    expect(new Set(numbers).size).toBe(1);
    expect(voiceIndependence(lead, counter).motion.parallel).toBe(1);
  });

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
        path.join(ROOT, 'docs', lang, 'counterpoint-and-part-writing.md'),
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

describe('voiceIndependence input', () => {
  it('needs the two lines aligned slot for slot', () => {
    expect(() => voiceIndependence(slots('C5 D5'), slots('A4'))).toThrow(/slot for slot/);
  });

  it('needs each attack array aligned with the lines as well', () => {
    // A short array is not a shorter reading of the same texture: every slot
    // past its end would silently count as a sustain.
    const lead = slots('C5 D5 E5');
    const counter = slots('E4 F4 G4');
    expect(() => voiceIndependence(lead, counter, { leadAttacks: [true, false] })).toThrow(
      /leadAttacks aligned slot for slot with the lines; received 2 and 3/,
    );
    expect(() =>
      voiceIndependence(lead, counter, { counterAttacks: [true, false, true, false] }),
    ).toThrow(/counterAttacks aligned slot for slot with the lines; received 4 and 3/);
    expect(() =>
      voiceIndependence(lead, counter, {
        leadAttacks: [true, true, true],
        counterAttacks: [true, true, true],
      }),
    ).not.toThrow();
  });

  it('accepts two empty lines', () => {
    const report = voiceIndependence([], []);
    expect(report).toEqual({
      motion: { contrary: 0, oblique: 0, similar: 0, parallel: 0 },
      rhythmicComplementarity: 0,
      separation: { mean: 0, min: 0 },
      crossings: 0,
      longestPerfectRun: 0,
      sounding: 0,
    });
  });
});
