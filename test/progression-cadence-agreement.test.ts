import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { Chord } from '../src/model/chord.js';
import { Key } from '../src/model/key.js';
import { Progression } from '../src/model/progression.js';
import { majorKey } from '../src/theory/scale/index.js';

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

describe('the voicing both cadence entries take', () => {
  const voiced = () =>
    new Progression(
      [Chord.parse('C'), Chord.parse('F'), Chord.parse('G7'), Chord.parse('C')],
      Key.major('C'),
    );

  it('cuts the closing pair out of the progression own voicing', () => {
    // `voice()` returns one voicing per chord, which is what `cadences` takes;
    // handing the same array to `analyze` used to grade the final cadence on
    // the first two chords instead, silently and with no error.
    const progression = voiced();
    const voicing = progression.voice();
    const closing = progression.cadences(undefined, { voicing }).at(-1);
    expect(closing).toBeDefined();
    expect(progression.analyze(undefined, { voicing }).cadence).toEqual(closing);
  });

  it('reads a two-element array as the closing pair it is', () => {
    const progression = voiced();
    const voicing = progression.voice();
    const pair = [voicing.at(-2) ?? [], voicing.at(-1) ?? []];
    expect(progression.analyze(undefined, { voicing: pair }).cadence).toEqual(
      progression.analyze(undefined, { voicing }).cadence,
    );
  });

  it('refuses a voicing that fits neither the progression nor its closing pair', () => {
    const progression = voiced();
    const voicing = progression.voice().slice(0, 3);
    expect(() => progression.analyze(undefined, { voicing })).toThrow(InvalidInputError);
  });

  it('grades the closing cadence the same from either entry, in every key', () => {
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      const key = Key.of(majorKey(rootPc));
      const progression = new Progression(
        [
          Chord.of(rootPc, 'maj'),
          Chord.of((rootPc + 5) % 12, 'maj'),
          Chord.of((rootPc + 7) % 12, 'dom7'),
          Chord.of(rootPc, 'maj'),
        ],
        key,
      );
      const voicing = progression.voice();
      expect(
        progression.analyze(undefined, { voicing }).cadence,
        `key with root ${rootPc}`,
      ).toEqual(progression.cadences(undefined, { voicing }).at(-1));
    }
  });
});
