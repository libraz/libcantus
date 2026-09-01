import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import {
  barPositionToBeat,
  barPositionToPulse,
  beatsPerBar,
  beatToBarPosition,
  formatBarPosition,
  formatTimeSignature,
  isCompound,
  isStrongBeat,
  metricWeight,
  parseTimeSignature,
  pulseBeats,
  pulsesPerBar,
  type TimeSignature,
  tryParseTimeSignature,
  tuplet,
} from '../src/core/meter/index.js';

describe('time signatures', () => {
  it('parses and formats', () => {
    expect(parseTimeSignature('6/8')).toEqual({ numerator: 6, denominator: 8 });
    expect(formatTimeSignature({ numerator: 4, denominator: 4 })).toBe('4/4');
    expect(() => parseTimeSignature('4-4')).toThrow();
  });

  it('round-trips additive groupings', () => {
    const aksak = { numerator: 7, denominator: 8, grouping: [2, 2, 3] };
    expect(parseTimeSignature(formatTimeSignature(aksak, { grouping: true }))).toEqual(aksak);
  });

  it('reports failure instead of throwing it, on the same texts', () => {
    const texts = ['4/4', '2+2+3/8', ' 6 / 8 ', '4-4', '', '0/4', '4/0', '5/8x', '1+1+1/8'];
    for (const text of texts) {
      const tried = tryParseTimeSignature(text);
      if (tried.ok) {
        expect(parseTimeSignature(text), text).toEqual(tried.value);
        continue;
      }
      // The throwing sibling fails on exactly the same text, with the error the
      // result carried rather than one of its own.
      expect(() => parseTimeSignature(text), text).toThrow(tried.error.message);
      expect(tried.error.code, text).toBe('INVALID_INPUT');
    }
    // Text is not the only way in: a non-string reaches the same failure rather
    // than a TypeError from inside the reader.
    const wrongType = tryParseTimeSignature(4 as unknown as string);
    expect(wrongType.ok).toBe(false);
    expect(wrongType.ok ? '' : wrongType.error.message).toContain('must be a string');
  });

  it('classifies compound meters', () => {
    expect(isCompound(parseTimeSignature('6/8'))).toBe(true);
    expect(isCompound(parseTimeSignature('12/8'))).toBe(true);
    expect(isCompound(parseTimeSignature('3/4'))).toBe(false);
    expect(isCompound(parseTimeSignature('3/8'))).toBe(false); // simple triple
  });

  it('classifies compound meters independent of the denominator', () => {
    // Compound is defined by a numerator that is a multiple of three above
    // three, so 6/4 (compound duple) and 9/8 are compound while the simple
    // 3/4 and 4/4 are not.
    expect(isCompound(parseTimeSignature('6/4'))).toBe(true);
    expect(isCompound(parseTimeSignature('9/8'))).toBe(true);
    expect(isCompound(parseTimeSignature('3/4'))).toBe(false);
    expect(isCompound(parseTimeSignature('4/4'))).toBe(false);
  });

  it('groups 6/4 as two dotted-half pulses', () => {
    const ts = parseTimeSignature('6/4');
    expect(beatsPerBar(ts)).toBe(6);
    expect(pulsesPerBar(ts)).toBe(2);
    expect(metricWeight(0, ts)).toBe(3); // downbeat
    expect(metricWeight(3, ts)).toBe(2); // second compound pulse (dotted half in)
    expect(metricWeight(1, ts)).toBe(0); // off-pulse subdivision
  });

  it('computes bar length and pulse count', () => {
    expect(beatsPerBar(parseTimeSignature('4/4'))).toBe(4);
    expect(beatsPerBar(parseTimeSignature('6/8'))).toBe(3);
    expect(pulsesPerBar(parseTimeSignature('4/4'))).toBe(4);
    expect(pulsesPerBar(parseTimeSignature('6/8'))).toBe(2);
  });
});

describe('bar positions', () => {
  it('splits an absolute beat into bar and offset in 4/4', () => {
    const ts = parseTimeSignature('4/4');
    expect(beatToBarPosition(6, ts)).toEqual({ bar: 1, beat: 2 });
    expect(barPositionToBeat({ bar: 1, beat: 2 }, ts)).toBe(6);
  });

  it('never emits a beat beyond the bar or an ambiguous second dot', () => {
    expect(formatBarPosition(3.999, parseTimeSignature('4/4'))).toBe('2.1');
    expect(formatBarPosition(8, parseTimeSignature('6/8'))).toBe('3.2+0.33');
    expect(() => formatBarPosition(0, parseTimeSignature('4/4'), -1)).toThrow(RangeError);
  });

  it('converts compound-meter offsets to their felt pulse numbers', () => {
    const ts = parseTimeSignature('6/8');
    expect(pulseBeats(ts)).toBe(1.5);
    expect(barPositionToPulse({ bar: 2, beat: 0 }, ts)).toBe(1);
    expect(barPositionToPulse({ bar: 2, beat: 1.5 }, ts)).toBe(2);
  });

  it('refuses a bar no meter could hold, whichever form the meter came in', () => {
    // The single signature and the map are the same argument, so a position the
    // map form rejects is not a position the signature form answers.
    const map = [{ startBeat: 0, ts: parseTimeSignature('4/4') }];
    for (const meter of ['4/4', parseTimeSignature('4/4'), map]) {
      const name = JSON.stringify(meter);
      expect(() => barPositionToPulse({ bar: Number.NaN, beat: 0 }, meter), name).toThrow(
        InvalidInputError,
      );
      expect(() => barPositionToPulse({ bar: 1.5, beat: 0 }, meter), name).toThrow(
        InvalidInputError,
      );
      expect(barPositionToPulse({ bar: 1, beat: 2 }, meter), name).toBe(3);
    }
  });
});

describe('metric weight', () => {
  it('ranks 4/4 accents: downbeat > mid-bar > other beats > offbeats', () => {
    const ts = parseTimeSignature('4/4');
    expect(metricWeight(0, ts)).toBe(3);
    expect(metricWeight(2, ts)).toBe(2);
    expect(metricWeight(1, ts)).toBe(1);
    expect(metricWeight(3, ts)).toBe(1);
    expect(metricWeight(0.5, ts)).toBe(0);
    expect(isStrongBeat(0, ts)).toBe(true);
    expect(isStrongBeat(1, ts)).toBe(false);
  });

  it('treats a downbeat reached just below the bar boundary as strong', () => {
    const ts = parseTimeSignature('4/4');
    // Accumulated tuplet durations can land an epsilon below the next downbeat.
    expect(metricWeight(4 - 5e-10, ts)).toBe(3);
    expect(isStrongBeat(4 - 5e-10, ts)).toBe(true);
  });

  it('places the two dotted beats of 6/8', () => {
    const ts = parseTimeSignature('6/8');
    expect(metricWeight(0, ts)).toBe(3);
    expect(metricWeight(1.5, ts)).toBe(2); // second compound beat
    expect(metricWeight(0.5, ts)).toBe(0); // subdivision
  });

  it('has no secondary strong pulse in 3/4', () => {
    const ts = parseTimeSignature('3/4');
    expect(metricWeight(0, ts)).toBe(3);
    expect(metricWeight(1, ts)).toBe(1);
    expect(metricWeight(2, ts)).toBe(1);
  });
});

describe('additive meter grouping', () => {
  it('treats 7/8 as flat equal pulses without a grouping', () => {
    const ts = parseTimeSignature('7/8');
    expect(pulsesPerBar(ts)).toBe(7);
    // Every eighth-note pulse (0.5 quarter apart) is a plain main pulse.
    expect(metricWeight(0, ts)).toBe(3);
    for (let pulse = 1; pulse < 7; pulse += 1) {
      expect(metricWeight(pulse * 0.5, ts)).toBe(1);
    }
    // Off-pulse subdivisions still weigh 0.
    expect(metricWeight(0.25, ts)).toBe(0);
  });

  it('accents the 2+2+3 group heads of 7/8 when grouped', () => {
    const ts: TimeSignature = { numerator: 7, denominator: 8, grouping: [2, 2, 3] };
    // Group heads at pulse 0 (beat 0), pulse 2 (beat 1.0), pulse 4 (beat 2.0).
    expect(metricWeight(0, ts)).toBe(3); // downbeat
    expect(metricWeight(1.0, ts)).toBe(2); // head of second group
    expect(metricWeight(2.0, ts)).toBe(2); // head of third group
    // Non-head pulses weigh 1.
    expect(metricWeight(0.5, ts)).toBe(1);
    expect(metricWeight(1.5, ts)).toBe(1);
    expect(metricWeight(2.5, ts)).toBe(1);
    expect(metricWeight(3.0, ts)).toBe(1);
    expect(isStrongBeat(1.0, ts)).toBe(true);
    expect(isStrongBeat(0.5, ts)).toBe(false);
  });

  it('accents the 3+2 group head of 5/8 when grouped', () => {
    const ts: TimeSignature = { numerator: 5, denominator: 8, grouping: [3, 2] };
    // Group heads at pulse 0 (beat 0) and pulse 3 (beat 1.5).
    expect(metricWeight(0, ts)).toBe(3);
    expect(metricWeight(1.5, ts)).toBe(2);
    expect(metricWeight(0.5, ts)).toBe(1);
    expect(metricWeight(1.0, ts)).toBe(1);
    expect(metricWeight(2.0, ts)).toBe(1);
  });

  it('throws on a grouping that does not sum to the pulse count', () => {
    const ts: TimeSignature = { numerator: 7, denominator: 8, grouping: [2, 2, 2] };
    // pulse index 0 short-circuits, but any later pulse validates the grouping.
    expect(() => metricWeight(0.5, ts)).toThrow();
  });

  it('accents the group heads of an additive reading whose groups are equal', () => {
    // 6/8 written 2+2+2 is three pairs of quavers, not the compound bar: its
    // groups say where the accents are, and equal groups say it no less than
    // uneven ones do. The midpoint the compound reading accents (beat 1.5) is
    // not a group head here.
    const hemiola: TimeSignature = { numerator: 6, denominator: 8, grouping: [2, 2, 2] };
    expect(pulsesPerBar(hemiola)).toBe(6);
    expect(pulseBeats(hemiola)).toBe(0.5);
    const weights = [0, 1, 2, 3, 4, 5].map((pulse) => metricWeight(pulse * 0.5, hemiola));
    expect(weights).toEqual([3, 1, 2, 1, 2, 1]);
    expect(metricWeight(1.5, hemiola)).toBe(1);
    expect(metricWeight(1.5, parseTimeSignature('6/8'))).toBe(2);
    // The same position asked for in quarter-note beats reads the same weight.
    expect(metricWeight(0, hemiola)).toBe(metricWeight(0 * pulseBeats(hemiola), hemiola));
    expect(isStrongBeat(1, hemiola)).toBe(true);
    expect(isStrongBeat(0.5, hemiola)).toBe(false);
  });

  it('accents the group heads of a 12/8 blues written in fours', () => {
    const blues: TimeSignature = { numerator: 12, denominator: 8, grouping: [4, 4, 4] };
    expect(pulsesPerBar(blues)).toBe(12);
    // Group heads at quaver pulses 0, 4 and 8 — beats 0, 2 and 4.
    const weights = Array.from({ length: 12 }, (_, pulse) => metricWeight(pulse * 0.5, blues));
    expect(weights).toEqual([3, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1]);
    // The compound reading of the same signature accents its own midpoint.
    expect(metricWeight(3, parseTimeSignature('12/8'))).toBe(2);
    expect(metricWeight(3, blues)).toBe(1);
  });
});

describe('the reading a grouping selects', () => {
  /** 9/8 written as its three dotted pulses, in units and in pulses. */
  const NINE_COMPOUND: TimeSignature[] = [
    { numerator: 9, denominator: 8, grouping: [3, 3, 3] },
    { numerator: 9, denominator: 8, grouping: [1, 1, 1] },
  ];

  it('reads groups of threes on a compound numerator as the compound division', () => {
    for (const ts of NINE_COMPOUND) {
      const spelling = JSON.stringify(ts.grouping);
      expect(pulsesPerBar(ts), spelling).toBe(3);
      expect(pulseBeats(ts), spelling).toBe(1.5);
      expect(isCompound(ts), spelling).toBe(true);
      expect(barPositionToPulse({ bar: 0, beat: 1.5 }, ts), spelling).toBe(2);
      expect(formatBarPosition(1.5, ts), spelling).toBe('1.2');
    }
    const six: TimeSignature = { numerator: 6, denominator: 8, grouping: [3, 3] };
    expect(pulsesPerBar(six)).toBe(2);
    expect(pulseBeats(six)).toBe(1.5);
    expect(isCompound(six)).toBe(true);
  });

  it('reads any other grouping summing to the numerator as additive units', () => {
    const aksak: TimeSignature = { numerator: 9, denominator: 8, grouping: [2, 2, 2, 3] };
    expect(pulsesPerBar(aksak)).toBe(9);
    expect(pulseBeats(aksak)).toBe(0.5);
    expect(isCompound(aksak)).toBe(false);
    // Group heads at quaver pulses 0, 2, 4 and 6 — beats 0, 1, 2 and 3.
    expect([0, 1, 2, 3].map((beat) => metricWeight(beat, aksak))).toEqual([3, 2, 2, 2]);
    expect(metricWeight(0.5, aksak)).toBe(1);
  });

  it('reports one reading from every exit that depends on it', () => {
    const cases: TimeSignature[] = [
      { numerator: 4, denominator: 4 },
      { numerator: 3, denominator: 4 },
      { numerator: 6, denominator: 8 },
      ...NINE_COMPOUND,
      { numerator: 9, denominator: 8 },
      { numerator: 9, denominator: 8, grouping: [2, 2, 2, 3] },
      { numerator: 12, denominator: 8, grouping: [2, 2] },
      { numerator: 7, denominator: 8, grouping: [2, 2, 3] },
      { numerator: 5, denominator: 8, grouping: [3, 2] },
      { numerator: 6, denominator: 4, grouping: [3, 3] },
    ];
    for (const ts of cases) {
      const name = `${formatTimeSignature(ts)} ${JSON.stringify(ts.grouping)}`;
      const pulses = pulsesPerBar(ts);
      const pulse = pulseBeats(ts);
      // The bar is exactly its pulses, and a pulse is a felt beat everywhere.
      expect(pulses * pulse, name).toBeCloseTo(beatsPerBar(ts), 9);
      expect(isCompound(ts), name).toBe(pulses === ts.numerator / 3);
      for (let index = 0; index < pulses; index += 1) {
        const beat = index * pulse;
        expect(barPositionToPulse({ bar: 0, beat }, ts), `${name} @${beat}`).toBeCloseTo(
          index + 1,
          9,
        );
        expect(formatBarPosition(beat, ts), `${name} @${beat}`).toBe(`1.${index + 1}`);
        expect(metricWeight(beat, ts), `${name} @${beat}`).toBeGreaterThan(0);
      }
      // Half a pulse in is a subdivision under every reading.
      expect(metricWeight(pulse / 2, ts), name).toBe(0);
    }
  });
});

describe('a grouping of equal groups', () => {
  /** Each grouped signature and the plain one it has to agree with. */
  const cases: { grouped: TimeSignature; plain: TimeSignature }[] = [
    {
      grouped: { numerator: 9, denominator: 8, grouping: [1, 1, 1] },
      plain: { numerator: 9, denominator: 8 },
    },
    {
      grouped: { numerator: 9, denominator: 8, grouping: [3, 3, 3] },
      plain: { numerator: 9, denominator: 8 },
    },
    {
      grouped: { numerator: 12, denominator: 8, grouping: [1, 1, 1, 1] },
      plain: { numerator: 12, denominator: 8 },
    },
    {
      grouped: { numerator: 4, denominator: 4, grouping: [1, 1, 1, 1] },
      plain: { numerator: 4, denominator: 4 },
    },
    {
      grouped: { numerator: 6, denominator: 8, grouping: [3, 3] },
      plain: { numerator: 6, denominator: 8 },
    },
    {
      grouped: parseTimeSignature('1+1+1/8'),
      plain: parseTimeSignature('3/8'),
    },
  ];

  it('weighs the bar exactly as the ungrouped signature does', () => {
    for (const { grouped, plain } of cases) {
      const name = `${formatTimeSignature(grouped)} ${JSON.stringify(grouped.grouping)}`;
      for (let beat = 0; beat < beatsPerBar(plain); beat += 0.25) {
        expect(metricWeight(beat, grouped), `${name} @${beat}`).toBe(metricWeight(beat, plain));
      }
    }
  });

  it('leaves 9/8 one downbeat and two ordinary pulses', () => {
    const ts: TimeSignature = { numerator: 9, denominator: 8, grouping: [1, 1, 1] };
    expect([0, 1.5, 3].map((beat) => metricWeight(beat, ts))).toEqual([3, 1, 1]);
    expect([1.5, 3].map((beat) => isStrongBeat(beat, ts))).toEqual([false, false]);
  });
});

describe('the time-signature round trip', () => {
  /**
   * Every way of writing `total` as an ordered sum of at most `maxParts`
   * positive integers. The cap keeps the sweep finite; a bar of more than four
   * felt-beat groups is past anything a signature is written for.
   */
  function compositions(total: number, maxParts = 4): number[][] {
    if (total === 0) {
      return [[]];
    }
    if (maxParts === 0) {
      return [];
    }
    const out: number[][] = [];
    for (let head = 1; head <= total; head += 1) {
      for (const rest of compositions(total - head, maxParts - 1)) {
        out.push([head, ...rest]);
      }
    }
    return out;
  }

  /** The signatures `assertTimeSignature` accepts, within the sweep's bounds. */
  function domain(): TimeSignature[] {
    const out: TimeSignature[] = [];
    for (const denominator of [2, 4, 8]) {
      for (let numerator = 1; numerator <= 12; numerator += 1) {
        out.push({ numerator, denominator });
        // Both sums the validator accepts: the pulse count and the numerator,
        // which coincide outside compound meters.
        const pulses = numerator % 3 === 0 && numerator > 3 ? numerator / 3 : numerator;
        const sums = pulses === numerator ? [numerator] : [pulses, numerator];
        for (const sum of sums) {
          for (const grouping of compositions(sum)) {
            out.push({ numerator, denominator, grouping });
          }
        }
      }
    }
    return out;
  }

  /**
   * Whether a signature's grouping has an additive spelling.
   *
   * A grouping counted in main pulses adds up to the numerator only where a
   * pulse is one unit, so on a compound numerator it has none. Where its groups
   * are all the same length it says nothing the bare signature does not already
   * say and costs nothing to drop; where they differ it is the only thing naming
   * the bar's accents, and the plain form would read back as another bar.
   */
  function spellsItsGrouping(ts: TimeSignature): boolean {
    const grouping = ts.grouping;
    if (grouping === undefined) {
      return true;
    }
    if (grouping.reduce((sum, entry) => sum + entry, 0) === ts.numerator) {
      return true;
    }
    return grouping.every((entry) => entry === grouping[0]);
  }

  it('refuses a grouping no signature text can spell', () => {
    // 12/8 whose pulses are grouped 1+1+2 accents the third pulse; the plain
    // form has no way to say so, and the additive form would read the bar as
    // twelve quavers rather than four dotted quarters.
    const uneven: TimeSignature = { numerator: 12, denominator: 8, grouping: [1, 1, 2] };
    expect(metricWeight(3, uneven)).toBe(2);
    expect(() => formatTimeSignature(uneven, { grouping: true })).toThrow(InvalidInputError);
    // Without the grouping asked for, the plain name of the bar is what it is.
    expect(formatTimeSignature(uneven)).toBe('12/8');
    // A grouping of equal groups states the division the meter already has, so
    // the plain form carries everything it said.
    const even: TimeSignature = { numerator: 12, denominator: 8, grouping: [2, 2] };
    expect(formatTimeSignature(even, { grouping: true })).toBe('12/8');
    expect(metricWeight(3, parseTimeSignature('12/8'))).toBe(metricWeight(3, even));
  });

  it('never renders a signature that reads back as another bar', () => {
    for (const ts of domain()) {
      const name = `${ts.numerator}/${ts.denominator} ${JSON.stringify(ts.grouping)}`;
      for (const opts of [{}, { grouping: true }]) {
        if (opts.grouping === true && !spellsItsGrouping(ts)) {
          // Refused rather than answered with a bar that weighs its pulses
          // differently from the one it was given.
          expect(() => formatTimeSignature(ts, opts), name).toThrow(InvalidInputError);
          continue;
        }
        const text = formatTimeSignature(ts, opts);
        const back = parseTimeSignature(text);
        // The non-throwing sibling reads what the throwing one reads.
        const tried = tryParseTimeSignature(text);
        expect(tried.ok && tried.value, `${name} -> ${text}`).toEqual(back);
        expect(back.numerator, `${name} -> ${text}`).toBe(ts.numerator);
        expect(back.denominator, `${name} -> ${text}`).toBe(ts.denominator);
        expect(beatsPerBar(back), `${name} -> ${text}`).toBe(beatsPerBar(ts));
        if (text.includes('+')) {
          // An additive rendering also has to bring the felt beats back: its
          // terms are read as denominator units summing to the numerator.
          const terms = text.split('/')[0]?.split('+').map(Number) ?? [];
          expect(
            terms.reduce((sum, term) => sum + term, 0),
            `${name} -> ${text}`,
          ).toBe(ts.numerator);
          expect(pulsesPerBar(back), `${name} -> ${text}`).toBe(pulsesPerBar(ts));
          expect(pulseBeats(back), `${name} -> ${text}`).toBe(pulseBeats(ts));
          expect(isCompound(back), `${name} -> ${text}`).toBe(isCompound(ts));
        }
      }
    }
  });

  it('keeps the felt beats of every signature it renders additively', () => {
    for (const ts of domain()) {
      if (!spellsItsGrouping(ts)) {
        continue;
      }
      const text = formatTimeSignature(ts, { grouping: true });
      if (!text.includes('+')) {
        continue;
      }
      const back = parseTimeSignature(text);
      const name = `${ts.numerator}/${ts.denominator} ${JSON.stringify(ts.grouping)} -> ${text}`;
      for (let beat = 0; beat < beatsPerBar(ts); beat += pulseBeats(ts) / 2) {
        expect(metricWeight(beat, back), `${name} @${beat}`).toBe(metricWeight(beat, ts));
      }
    }
  });
});

describe('tuplet', () => {
  it('splits a beat into an eighth-note triplet', () => {
    expect(tuplet(1, 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('rejects an invalid count', () => {
    expect(() => tuplet(1, 0)).toThrow();
  });
});
