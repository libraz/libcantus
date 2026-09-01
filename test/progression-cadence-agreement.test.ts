import { describe, expect, it } from 'vitest';
import { Chord } from '../src/model/chord.js';
import { Key } from '../src/model/key.js';
import { Progression } from '../src/model/progression.js';

/** C, C/G, G, C: the cadential six-four resolving onto its dominant. */
function sixFourProgression(): Progression {
  const tonicOverDominant = Chord.parse('C/G');
  return new Progression(
    [Chord.parse('C'), tonicOverDominant, Chord.parse('G'), Chord.parse('C')],
    Key.major('C'),
  );
}

describe('Progression.analyze and Progression.cadences read the closing pair alike', () => {
  it('reports the cadential six-four in both', () => {
    const progression = sixFourProgression();
    const closing = progression.analyze().cadence;
    const pairs = progression.cadences();
    expect(closing).not.toBeNull();
    expect(closing?.rationale).toBe(pairs[2]?.rationale);
    expect(closing?.rationale).toContain('six-four');
  });

  it('keeps the whole cadence result equal, not only its rationale', () => {
    const progression = sixFourProgression();
    expect(progression.analyze()).toMatchObject({ cadence: progression.cadences()[2] });
  });

  it('leaves the type and strength of an ordinary cadence alone', () => {
    const progression = new Progression(
      [Chord.parse('C'), Chord.parse('F'), Chord.parse('G7'), Chord.parse('C')],
      Key.major('C'),
    );
    const closing = progression.analyze().cadence;
    expect(closing).toMatchObject({ type: 'authentic' });
    expect(closing).toEqual(progression.cadences()[2]);
  });

  it('is deterministic across repeated analyses', () => {
    const progression = sixFourProgression();
    expect(progression.analyze()).toEqual(progression.analyze());
  });

  it('reports no cadence at all below two chords', () => {
    expect(new Progression([Chord.parse('C')], Key.major('C')).analyze().cadence).toBeNull();
    expect(new Progression([], Key.major('C')).analyze().cadence).toBeNull();
  });

  it('falls back to the approach chord the caller supplies', () => {
    const progression = new Progression([Chord.parse('G'), Chord.parse('C')], Key.major('C'));
    const withApproach = progression.analyze(undefined, {
      approach: Chord.parse('C/G').data,
    }).cadence;
    expect(withApproach?.rationale).toContain('six-four');
  });
});
