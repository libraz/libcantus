import { describe, expect, it } from 'vitest';
import { isCadentialSixFour } from '../src/analyze/functional/cadence.js';
import { chordToRoman, detectCadence, explainRoman } from '../src/analyze/functional/index.js';
import { chordTimelineFromChords, detectCadences } from '../src/analyze/timeline/index.js';
import type { ChordSpan } from '../src/theory/chord/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const aMinor = minorKey(9);

/** C/G, the tonic triad of C major standing on the dominant bass. */
const sixFour = () => makeChord(0, 'maj', 7);

describe('isCadentialSixFour', () => {
  it('holds for the tonic six-four standing on the dominant it resolves to', () => {
    expect(isCadentialSixFour(sixFour(), makeChord(7, 'maj'), cMajor)).toBe(true);
    expect(isCadentialSixFour(sixFour(), makeChord(7, 'dom7'), cMajor)).toBe(true);
    // The minor key cadences on the same raised dominant.
    expect(isCadentialSixFour(makeChord(9, 'min', 4), makeChord(4, 'maj'), aMinor)).toBe(true);
  });

  it('refuses a six-four the bass leaves', () => {
    // The passing six-four of IV-I64-IV: the next chord is not the dominant.
    expect(isCadentialSixFour(sixFour(), makeChord(5, 'maj'), cMajor)).toBe(false);
    // A neighbouring six-four over the tonic bass.
    expect(isCadentialSixFour(sixFour(), makeChord(0, 'maj'), cMajor)).toBe(false);
  });

  it('refuses a tonic that is not standing on the dominant bass', () => {
    expect(isCadentialSixFour(makeChord(0, 'maj'), makeChord(7, 'maj'), cMajor)).toBe(false);
    expect(isCadentialSixFour(makeChord(0, 'maj', 4), makeChord(7, 'maj'), cMajor)).toBe(false);
  });

  it('refuses a six-four on any degree but the tonic', () => {
    // F/C to G: a subdominant six-four is not the cadential figure.
    expect(isCadentialSixFour(makeChord(5, 'maj', 0), makeChord(7, 'maj'), cMajor)).toBe(false);
  });
});

describe('a cadence reached through the cadential six-four', () => {
  it('names the six-four in the rationale of the cadence it opens', () => {
    const result = detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), cMajor, {
      approach: sixFour(),
    });
    expect(result.type).toBe('authentic');
    expect(result.rationale).toContain('cadential six-four');
  });

  it('leaves the type, the beat-bearing facts and the grading alone', () => {
    const plain = detectCadence(makeChord(7, 'dom7'), makeChord(0, 'maj'), cMajor);
    const opened = detectCadence(makeChord(7, 'dom7'), makeChord(0, 'maj'), cMajor, {
      approach: sixFour(),
    });
    expect({ ...opened, rationale: '' }).toEqual({ ...plain, rationale: '' });
  });

  it('says nothing of a six-four when the approach is an ordinary chord', () => {
    const result = detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), cMajor, {
      approach: makeChord(5, 'maj'),
    });
    expect(result.rationale).not.toContain('six-four');
  });

  it('reads the six-four resolving onto its own dominant as a half cadence', () => {
    // `I - I64 - V` is how the antecedent of a period closes, so the arrival on
    // the dominant is the half cadence a phrase boundary is read from — the
    // same reading `IV - V` gets, since the six-four is not the dominant itself.
    const result = detectCadence(sixFour(), makeChord(7, 'maj'), cMajor);
    expect(result.type).toBe('half');
    expect(result.type).toBe(detectCadence(makeChord(5, 'maj'), makeChord(7, 'maj'), cMajor).type);
    expect(result.rationale).toContain('six-four');
  });
});

describe('a six-four that is passing or neighbouring keeps its old reading', () => {
  it('leaves IV-I64-IV alone', () => {
    // Neither pair of the passing figure is touched: the six-four is an
    // inverted tonic there, so the subdominant still falls onto a tonic and
    // the motion away from it still cadences not at all.
    expect(detectCadence(makeChord(5, 'maj'), sixFour(), cMajor).type).toBe('plagal');
    expect(detectCadence(sixFour(), makeChord(5, 'maj'), cMajor).type).toBeNull();
  });

  it('still hears a half cadence approached over a different bass', () => {
    // F/A to G: the arrival on the dominant is a half cadence, and the chord
    // before it is no six-four of anything.
    expect(detectCadence(makeChord(5, 'maj', 9), makeChord(7, 'maj'), cMajor).type).toBe('half');
  });

  it('keeps a tonic six-four that resolves onto the tonic a plagal arrival', () => {
    // IV to I64 is not the cadential figure, and IV to I still cadences.
    expect(detectCadence(makeChord(5, 'maj'), makeChord(0, 'maj'), cMajor).type).toBe('plagal');
  });

  it('keeps the numeral I64 and says what it can be in context', () => {
    // The spelling is correct and stays; the rationale is where the reading
    // the numeral cannot carry is said.
    expect(chordToRoman(sixFour(), cMajor)).toBe('I64');
    expect(explainRoman(sixFour(), cMajor).rationale).toContain('double appoggiatura');
    // An inverted tonic that is not a six-four carries no such note.
    expect(explainRoman(makeChord(0, 'maj', 4), cMajor).rationale).not.toContain(
      'double appoggiatura',
    );
  });

  it('keeps the dominant-to-tonic reading when the six-four is only written before it', () => {
    // The approach hint changes the rationale, never the type: a passing
    // six-four handed in as `approach` names no cadential figure.
    const result = detectCadence(makeChord(7, 'maj'), makeChord(9, 'min'), cMajor, {
      approach: makeChord(0, 'maj', 4),
    });
    expect(result.type).toBe('deceptive');
    expect(result.rationale).not.toContain('six-four');
  });
});

describe('a phrase closing on a six-four dominant is a cadence the timeline sees', () => {
  /** Lay chords out one per bar of 4/4, in the order given. */
  const bars = (spans: readonly Omit<ChordSpan, 'startBeat'>[]) =>
    chordTimelineFromChords(
      spans.map((span, index) => ({ ...span, startBeat: index * 4 })),
      spans.length * 4,
    );

  it('reports the half cadence that ends I I64 V', () => {
    // The antecedent of a classical period ends here. Without a cadence at the
    // dominant there is no phrase boundary, and the whole period reads as one
    // long phrase.
    const hits = detectCadences(
      bars([
        { rootPc: 0, quality: 'maj' },
        { rootPc: 0, quality: 'maj', bassPc: 7 },
        { rootPc: 7, quality: 'maj' },
      ]),
      cMajor,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.atBeat).toBe(8);
    expect(hits[0]?.cadence.type).toBe('half');
  });

  it('reports I I64 V I as the one cadence it is', () => {
    // The dominant goes on to resolve, so the six-four opened the cadence the
    // resolution names rather than closing a phrase of its own.
    const hits = detectCadences(
      bars([
        { rootPc: 0, quality: 'maj' },
        { rootPc: 0, quality: 'maj', bassPc: 7 },
        { rootPc: 7, quality: 'maj' },
        { rootPc: 0, quality: 'maj' },
      ]),
      cMajor,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.cadence.type).toBe('authentic');
    expect(hits[0]?.cadence.rationale).toContain('cadential six-four');
  });

  it('reads I64 V as IV V does', () => {
    const sixFourHalf = detectCadence(sixFour(), makeChord(7, 'maj'), cMajor);
    const plainHalf = detectCadence(makeChord(5, 'maj'), makeChord(7, 'maj'), cMajor);
    expect(sixFourHalf.type).toBe(plainHalf.type);
  });
});
