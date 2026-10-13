import { describe, expect, it } from 'vitest';
import { detectKey, detectKeyBest, detectKeyFromNotes } from '../src/analyze/detect/index.js';
import {
  analyzeChord,
  augmentedSixthChord,
  chordToRoman,
  detectCadence,
  explainRoman,
} from '../src/analyze/functional/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const aMinor = minorKey(9);

/** The C major scale, as MIDI pitches. */
const cMajorScale = [60, 62, 64, 65, 67, 69, 71];

describe('analyzeChord rationale', () => {
  it('names the degree a diatonic chord takes its function from', () => {
    const analysis = analyzeChord(makeChord(7, 'dom7'), cMajor);
    expect(analysis.rationale).toBe(
      'Dominant: V7 takes the dominant function of its degree in the key',
    );
  });

  it('says why an applied dominant overrides the degree it stands on', () => {
    const analysis = analyzeChord(makeChord(9, 'dom7'), cMajor);
    expect(analysis.function).toBe('dominant');
    expect(analysis.rationale).toBe(
      'Dominant: VI7 is an applied dominant sonority resolving onto a diatonic degree',
    );
  });

  it('names the mode a borrowed chord came from', () => {
    expect(analyzeChord(makeChord(5, 'min'), cMajor).rationale).toContain(
      'borrowed from the parallel minor',
    );
  });

  it('does not name the Neapolitan twice', () => {
    const analysis = analyzeChord(makeChord(1, 'maj'), cMajor);
    expect(analysis.source).toBe('neapolitan');
    expect(analysis.rationale).toBe(
      'Subdominant: bII is the Neapolitan, an altered predominant on the lowered second degree',
    );
  });

  it('reports no alternatives unless they are asked for', () => {
    expect(analyzeChord(makeChord(9, 'dom7'), cMajor).alternatives).toEqual([]);
  });

  it('reports the degree reading an override turned down', () => {
    const { alternatives } = analyzeChord(makeChord(9, 'dom7'), cMajor, { alternatives: true });
    expect(alternatives[0]).toEqual({
      label: 'tonic by scale degree',
      reason: expect.stringContaining('applied dominant'),
    });
  });

  it('reports the tonicizing reading a diatonic dominant sonority did not get', () => {
    // The tonic triad sounds a dominant and points at the subdominant, so V/IV
    // is a reading it could have had and did not.
    const { alternatives } = analyzeChord(makeChord(0, 'maj'), cMajor, { alternatives: true });
    expect(alternatives.map((entry) => entry.label)).toEqual(['applied dominant']);
  });

  it('reports no tonicizing reading for a chord that points at no degree', () => {
    // A rejected reading has to be a reading. `G7` sounds a dominant, but the
    // only degree it points at is the tonic — which is the key itself rather
    // than a degree to tonicize — and the subdominant points at the leading
    // tone, which is no degree at all. Reporting either as a turned-down rival
    // named a choice the analysis never made, and gave being in the key as the
    // reason for an absence the key had nothing to do with.
    for (const chord of [makeChord(7, 'dom7'), makeChord(7, 'maj'), makeChord(5, 'maj')]) {
      expect(
        analyzeChord(chord, cMajor, { alternatives: true }).alternatives,
        `${chord.rootPc}/${chord.quality}`,
      ).toEqual([]);
    }
  });

  it('reports the numeral the other rendering option would have emitted', () => {
    const { alternatives } = analyzeChord(makeChord(9, 'dom7'), cMajor, { alternatives: true });
    expect(alternatives.map((entry) => entry.label)).toContain('V7/ii');
  });
});

describe('explainRoman', () => {
  it('renders exactly what chordToRoman renders', () => {
    for (const chord of [makeChord(7, 'dom7'), makeChord(1, 'maj', 5), makeChord(2, 'min7', 5)]) {
      expect(explainRoman(chord, cMajor).roman).toBe(chordToRoman(chord, cMajor));
      expect(explainRoman(chord, cMajor, { neapolitan: true }).roman).toBe(
        chordToRoman(chord, cMajor, { neapolitan: true }),
      );
    }
  });

  it('names the degree, the quality and the bass', () => {
    expect(explainRoman(makeChord(7, 'dom7', 11), cMajor).rationale).toBe(
      'V65: the root is the fifth degree of the key, the case and suffix come from the dom7 quality, and the bass is an inversion, figured 65',
    );
  });

  it('says a chromatic root was spelled against a degree', () => {
    expect(explainRoman(makeChord(10, 'maj'), cMajor).rationale).toContain(
      'the root is chromatic, spelled as the seventh degree lowered a semitone',
    );
  });

  it('says where a bass that is not a chord tone went', () => {
    expect(explainRoman(makeChord(0, 'maj', 2), cMajor).rationale).toContain(
      'the bass is not a chord tone',
    );
  });

  it('explains the chords no numeral spells', () => {
    // Spelled Ab C Eb F#: the augmented sixth, not the Gb a bVI7 would write.
    const german = augmentedSixthChord('german', cMajor);
    expect(explainRoman(german, cMajor).rationale).toContain('an augmented sixth');
    expect(explainRoman(makeChord(1, 'maj', 5), cMajor, { neapolitan: true }).rationale).toContain(
      'the first-inversion Neapolitan',
    );
  });

  it('names the applied reading it was asked for', () => {
    expect(explainRoman(makeChord(2, 'dom7'), cMajor, { applied: true }).rationale).toBe(
      'V7/V: an applied chord, named in the local key its target degree V makes a tonic',
    );
  });

  it('collects the rival spellings only on request', () => {
    const chord = makeChord(2, 'dom7');
    expect(explainRoman(chord, cMajor).alternatives).toEqual([]);
    expect(
      explainRoman(chord, cMajor, { alternatives: true }).alternatives.map((entry) => entry.label),
    ).toEqual(['V7/V']);
  });
});

describe('detectCadence rationale', () => {
  it('says which motion an authentic cadence rests on and how it was graded', () => {
    const perfect = detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), cMajor, {
      voicing: [
        [55, 62, 71],
        [48, 64, 67, 72],
      ],
    });
    expect(perfect.rationale).toBe(
      'Authentic cadence: the dominant resolves onto the tonic, perfect with both chords on their roots and the tonic in the soprano',
    );
  });

  it('says which condition made an authentic cadence imperfect', () => {
    const leadingTone = detectCadence(makeChord(11, 'dim'), makeChord(0, 'maj'), cMajor);
    expect(leadingTone.rationale).toContain(
      'imperfect because the dominant root never sounds under the leading-tone chord',
    );
  });

  it('says the grade is unknown when no voicing names the soprano', () => {
    expect(detectCadence(makeChord(7, 'dom7'), makeChord(0, 'maj'), cMajor).rationale).toContain(
      'no voicing names the soprano',
    );
  });

  it('reports an evaded arrival in the rationale', () => {
    expect(detectCadence(makeChord(7, 'dom7'), makeChord(0, 'maj', 4), cMajor).rationale).toContain(
      'the tonic arrives inverted',
    );
  });

  it('explains a pair that cadences not at all', () => {
    expect(detectCadence(makeChord(7, 'maj'), makeChord(7, 'maj'), cMajor).rationale).toBe(
      'No cadence: the harmony repeats, so there is no root motion to cadence with',
    );
    expect(detectCadence(makeChord(2, 'min'), makeChord(0, 'maj'), cMajor).rationale).toBe(
      'No cadence: the tonic is approached by none of the chords that cadence onto it',
    );
  });

  it('reports no alternatives unless they are asked for', () => {
    expect(detectCadence(makeChord(7, 'maj'), makeChord(9, 'min'), cMajor).alternatives).toEqual(
      [],
    );
  });

  it('names the authentic cadence a deceptive one was heard against', () => {
    const { alternatives } = detectCadence(makeChord(7, 'maj'), makeChord(9, 'min'), cMajor, {
      alternatives: true,
    });
    expect(alternatives).toEqual([
      {
        label: 'authentic',
        reason:
          'The dominant was prepared, but the arrival is the submediant rather than the tonic',
      },
    ]);
  });

  it('names the phrygian reading a minor-key half cadence did not reach', () => {
    const { alternatives } = detectCadence(makeChord(2, 'min'), makeChord(4, 'maj'), aMinor, {
      alternatives: true,
    });
    expect(alternatives.map((entry) => entry.label)).toEqual(['phrygian']);
  });

  it('names the perfect grade an imperfect cadence fell short of', () => {
    const { alternatives } = detectCadence(makeChord(7, 'maj', 11), makeChord(0, 'maj'), cMajor, {
      alternatives: true,
    });
    expect(alternatives.map((entry) => entry.label)).toContain('perfect authentic');
  });
});

describe('detectKey rationale', () => {
  it('says nothing unless explanation is asked for', () => {
    const [best] = detectKey(cMajorScale);
    expect(best?.rationale).toBeUndefined();
    expect(best?.alternatives).toBeUndefined();
  });

  it('quotes the correlation and the coverage behind a candidate', () => {
    const [best] = detectKey(cMajorScale, { explain: true });
    expect(best?.rationale).toBe(
      'C major: profile correlation 0.76, with 7 of 7 input pitch classes in the scale',
    );
  });

  it('spells a candidate the way its key signature would be written', () => {
    const labels = detectKey(cMajorScale, { explain: true })
      .slice(0, 2)
      .map((match) => match.rationale?.split(':')[0]);
    expect(labels).toEqual(['C major', 'A natural minor']);
  });

  it('carries the rejected candidates on the winner alone', () => {
    const matches = detectKey(cMajorScale, { explain: true });
    expect(matches[0]?.alternatives).toHaveLength(3);
    expect(matches[1]?.alternatives).toBeUndefined();
  });

  it('says which link of the tie-break chain rejected each rival', () => {
    const best = detectKeyBest(cMajorScale, { explain: true });
    expect(best?.alternatives?.[0]).toEqual({
      label: 'A natural minor',
      reason: 'Ranked below on profile correlation (0.71 against 0.76)',
    });
  });

  it('names the tie-break that separates candidates scoring alike', () => {
    // A chromatic input correlates identically with all 24 candidates, so the
    // later links of the chain are what decide the order.
    const best = detectKeyBest([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], { explain: true });
    expect(best?.alternatives?.every((entry) => entry.reason.startsWith('Tied on'))).toBe(true);
  });

  it('quotes enough digits to tell two near-equal correlations apart', () => {
    // C major and C natural minor sit four decimals apart on a lone tonic; the
    // two decimals a rationale quotes would read as a tie.
    const best = detectKeyBest([0], { explain: true });
    expect(best?.alternatives?.[0]?.reason).toBe(
      'Ranked below on profile correlation (0.6842 against 0.6845)',
    );
  });

  it('reaches the note-weighted entry point too', () => {
    const [best] = detectKeyFromNotes(
      cMajorScale.map((pitch, index) => ({ pitch, startBeat: index, durationBeat: 1 })),
      { explain: true },
    );
    expect(best?.rationale).toContain('C major');
  });

  it('leaves the ranking itself untouched', () => {
    const plain = detectKey(cMajorScale).map((match) => [match.key.rootPc, match.scaleName]);
    const explained = detectKey(cMajorScale, { explain: true }).map((match) => [
      match.key.rootPc,
      match.scaleName,
    ]);
    expect(explained).toEqual(plain);
  });
});

describe('a chord the key contains is described as its own degree', () => {
  it('does not call the diatonic VII of a mode a borrowed cadence chord', () => {
    // F major is G mixolydian's own subtonic triad. Naming it borrowed would
    // contradict the `borrowed` and `source` fields printed beside it.
    const gMixolydian = scaleByName('mixolydian', 7);
    const analysis = analyzeChord(makeChord(5, 'maj'), gMixolydian);
    expect(analysis.function).toBe('subdominant');
    expect(analysis.borrowed).toBe(false);
    expect(analysis.source).toBeNull();
    expect(analysis.rationale).toContain('takes the subdominant function of its degree in the key');
    expect(analysis.rationale).not.toContain('borrowed');
  });

  it('still calls the borrowed bVII of a major key what it is', () => {
    const analysis = analyzeChord(makeChord(10, 'maj'), cMajor);
    expect(analysis.function).toBe('subdominant');
    expect(analysis.borrowed).toBe(true);
    expect(analysis.rationale).toContain('the borrowed cadence chord');
  });
});
