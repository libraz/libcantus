import { describe, expect, it } from 'vitest';
import type { Note } from '../src/core/pitch/index.js';
import { parseNote } from '../src/core/pitch/index.js';
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

describe('voiceIndependence input', () => {
  it('needs the two lines aligned slot for slot', () => {
    expect(() => voiceIndependence(slots('C5 D5'), slots('A4'))).toThrow(/slot for slot/);
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
