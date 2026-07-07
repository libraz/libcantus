/**
 * Meter and time signatures: bar/beat arithmetic, simple vs. compound meters,
 * metric-accent hierarchy, and tuplet subdivision.
 *
 * Positions and durations are measured in quarter-note beats, matching the rest
 * of the library's beat convention (four quarter-note beats per bar in 4/4).
 */

/** A time signature as a numerator over a note-value denominator. */
export type TimeSignature = {
  numerator: number;
  denominator: number;
  /**
   * Optional additive grouping of the bar's main pulses, as the felt-beat
   * lengths in pulses — e.g. `[2, 2, 3]` for a 2+2+3 reading of 7/8, or
   * `[3, 2]` for 5/8. The entries must be positive integers summing to
   * {@link pulsesPerBar}. When present, the head pulse of each group (other
   * than the downbeat) is treated as a secondary strong pulse by
   * {@link metricWeight}/{@link isStrongBeat}; when absent, all main pulses
   * are weighted equally as flat, evenly divided pulses.
   */
  grouping?: number[];
};

/** A position expressed as a bar index and a quarter-note offset within the bar. */
export type BarPosition = {
  bar: number;
  /** Quarter-note offset from the start of the bar. */
  beat: number;
};

const EPS = 1e-9;

/** Whether `value` is an integer multiple of `unit` (within a float tolerance). */
function isMultiple(value: number, unit: number): boolean {
  if (unit === 0) {
    return false;
  }
  const ratio = value / unit;
  return Math.abs(ratio - Math.round(ratio)) < EPS;
}

/**
 * Parse a time signature such as `"4/4"` or `"6/8"`.
 *
 * @param text The signature text.
 * @returns The parsed time signature.
 * @throws If the text is not `n/d` with positive integers.
 */
export function parseTimeSignature(text: string): TimeSignature {
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
  if (!match) {
    throw new Error(`Invalid time signature: ${text}`);
  }
  const numerator = Number.parseInt(match[1] ?? '', 10);
  const denominator = Number.parseInt(match[2] ?? '', 10);
  if (numerator <= 0 || denominator <= 0) {
    throw new Error(`Invalid time signature: ${text}`);
  }
  return { numerator, denominator };
}

/** Render a time signature as `"n/d"`. */
export function formatTimeSignature(ts: TimeSignature): string {
  return `${ts.numerator}/${ts.denominator}`;
}

/**
 * Whether a meter is compound: its main pulses each divide into three, as in
 * 6/8, 9/8, 12/8, or 6/4. Compound meters are those whose numerator is a
 * multiple of three greater than three, independent of the denominator. Meters
 * like 3/8 and 3/4 (simple triples, numerator 3) are not compound.
 *
 * @param ts The time signature.
 * @returns True for compound meters.
 */
export function isCompound(ts: TimeSignature): boolean {
  return ts.numerator % 3 === 0 && ts.numerator > 3;
}

/** Length of one denominator unit in quarter-note beats. */
function unitBeats(ts: TimeSignature): number {
  return 4 / ts.denominator;
}

/**
 * Length of a bar in quarter-note beats.
 *
 * @param ts The time signature.
 * @returns The bar length in quarter notes.
 */
export function beatsPerBar(ts: TimeSignature): number {
  return ts.numerator * unitBeats(ts);
}

/** Length of one main pulse (a dotted value in compound meters) in quarter notes. */
function pulseBeats(ts: TimeSignature): number {
  return isCompound(ts) ? 3 * unitBeats(ts) : unitBeats(ts);
}

/**
 * Number of main pulses (felt beats) per bar: the numerator for simple meters,
 * a third of it for compound meters.
 *
 * For additive/irregular meters such as 7/8 or 5/8 this counts the raw pulses
 * (7 and 5 respectively), which are otherwise felt as flat, evenly divided and
 * equally accented pulses. To recover a 2+2+3 or 3+2 felt-beat grouping, set
 * {@link TimeSignature.grouping}; {@link metricWeight} then accents each
 * group's head pulse.
 *
 * @param ts The time signature.
 * @returns The pulse count per bar.
 */
export function pulsesPerBar(ts: TimeSignature): number {
  return beatsPerBar(ts) / pulseBeats(ts);
}

/**
 * Whether `grouping` is a valid additive grouping for a bar of `pulses` main
 * pulses: a non-empty list of positive integers summing to `pulses`.
 */
function isValidGrouping(grouping: number[], pulses: number): boolean {
  if (grouping.length === 0) {
    return false;
  }
  let sum = 0;
  for (const g of grouping) {
    if (!Number.isInteger(g) || g <= 0) {
      return false;
    }
    sum += g;
  }
  return sum === pulses;
}

/** Whether `pulseIndex` is the head pulse of one of the additive groups. */
function isGroupHead(grouping: number[], pulseIndex: number): boolean {
  let acc = 0;
  for (const g of grouping) {
    if (acc === pulseIndex) {
      return true;
    }
    acc += g;
  }
  return false;
}

/**
 * Convert an absolute quarter-note position to a bar index and in-bar offset.
 *
 * @param beatInQuarters Absolute position in quarter-note beats.
 * @param ts The time signature.
 * @returns The bar and in-bar quarter-note offset.
 */
export function beatToBarPosition(beatInQuarters: number, ts: TimeSignature): BarPosition {
  const barLen = beatsPerBar(ts);
  const bar = Math.floor(beatInQuarters / barLen);
  return { bar, beat: beatInQuarters - bar * barLen };
}

/**
 * Convert a bar index and in-bar offset back to an absolute quarter-note
 * position.
 *
 * @param pos The bar position.
 * @param ts The time signature.
 * @returns The absolute position in quarter-note beats.
 */
export function barPositionToBeat(pos: BarPosition, ts: TimeSignature): number {
  return pos.bar * beatsPerBar(ts) + pos.beat;
}

/**
 * Metric weight of a position within its bar, on a 0–3 scale:
 * 3 the downbeat, 2 a secondary strong pulse, 1 any other main pulse, and 0 an
 * off-pulse subdivision.
 *
 * The secondary strong pulse is the bar's midpoint in even simple/compound
 * meters. For an additive/irregular meter with {@link TimeSignature.grouping}
 * set (e.g. `[2, 2, 3]` for 7/8), each group's head pulse other than the
 * downbeat is the secondary strong pulse instead; without a grouping every
 * non-downbeat main pulse of such a meter weighs 1 (flat, evenly divided
 * pulses).
 *
 * @param beatInQuarters Absolute or in-bar quarter-note position.
 * @param ts The time signature.
 * @returns The metric weight (0–3).
 * @throws If `ts.grouping` is present but is not a positive-integer list
 *   summing to {@link pulsesPerBar}.
 */
export function metricWeight(beatInQuarters: number, ts: TimeSignature): number {
  const { beat } = beatToBarPosition(beatInQuarters, ts);
  const pulse = pulseBeats(ts);
  if (!isMultiple(beat, pulse)) {
    return 0;
  }
  const pulses = pulsesPerBar(ts);
  const pulseIndex = Math.round(beat / pulse) % pulses;
  if (pulseIndex === 0) {
    return 3;
  }
  const grouping = ts.grouping;
  if (grouping !== undefined) {
    if (!isValidGrouping(grouping, pulses)) {
      throw new Error(
        `Invalid grouping [${grouping.join(', ')}] for ${formatTimeSignature(ts)}: ` +
          `entries must be positive integers summing to ${pulses}`,
      );
    }
    return isGroupHead(grouping, pulseIndex) ? 2 : 1;
  }
  if (pulses % 2 === 0 && pulseIndex === pulses / 2) {
    return 2;
  }
  return 1;
}

/**
 * Whether a position is metrically accented (weight 2 or more — a downbeat or a
 * secondary strong pulse).
 *
 * @param beatInQuarters Absolute or in-bar quarter-note position.
 * @param ts The time signature.
 * @returns True on strong beats.
 */
export function isStrongBeat(beatInQuarters: number, ts: TimeSignature): boolean {
  return metricWeight(beatInQuarters, ts) >= 2;
}

/**
 * Subdivide a span into `count` equal tuplet durations (e.g. an eighth-note
 * triplet is `tuplet(1, 3)`).
 *
 * @param totalBeats Total span in quarter-note beats.
 * @param count Number of equal parts.
 * @returns `count` equal durations summing to `totalBeats`.
 * @throws If `count` is not a positive integer.
 */
export function tuplet(totalBeats: number, count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`Invalid tuplet count: ${count}`);
  }
  return new Array<number>(count).fill(totalBeats / count);
}
