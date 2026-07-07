import type { Chord } from '../chord/index.js';
import { chordPitchClasses, chordToneRole } from '../chord/index.js';
import {
  createsHiddenParallelPerfect,
  createsParallelPerfect,
  createsVoiceCrossing,
  createsVoiceOverlap,
  exceedsSpacing,
} from '../counterpoint/index.js';

/**
 * An inclusive MIDI pitch range for a single voice.
 *
 * @category Voicing & Counterpoint
 */
export type VoiceRange = {
  min: number;
  max: number;
};

/**
 * Default four-voice SATB ranges, ascending (index 0 = lowest):
 * bass E2–C4 (40–60), tenor C3–G4 (48–67), alto G3–D5 (55–74),
 * soprano C4–G5 (60–79).
 *
 * @category Voicing & Counterpoint
 */
export const SATB_RANGES: readonly VoiceRange[] = [
  { min: 40, max: 60 },
  { min: 48, max: 67 },
  { min: 55, max: 74 },
  { min: 60, max: 79 },
];

/**
 * Options controlling {@link voiceChord} and {@link voiceProgression}.
 *
 * @category Voicing & Counterpoint
 */
export type VoicingOptions = {
  /**
   * Number of voices to realize. Ignored when `ranges` is given.
   *
   * @defaultValue 4
   */
  voices?: number;
  /** Explicit per-voice ranges, ascending (index 0 = lowest). Takes precedence over `voices`. */
  ranges?: VoiceRange[];
  /**
   * Maximum spacing in semitones between adjacent upper voices.
   *
   * @defaultValue 12
   */
  maxSpacing?: number;
};

/** Default maximum spacing between adjacent upper voices (one octave). */
const DEFAULT_MAX_SPACING = 12;

/** Overall pitch floor/ceiling used when deriving ranges for arbitrary voice counts. */
const DERIVED_LOW = 40;
const DERIVED_HIGH = 79;
/** Span of each derived per-voice range in semitones. */
const DERIVED_SPAN = 19;

/** Score penalty per counterpoint violation between consecutive voicings. */
const VIOLATION_PENALTY = 1000;
/** Score penalty per chord tone absent from a voicing. */
const MISSING_TONE_PENALTY = 500;
/** Score penalty per doubled tone that is neither the root nor the fifth. */
const POOR_DOUBLING_PENALTY = 4;
/**
 * Moderate penalty for a hidden/direct perfect fifth or octave reached on the
 * outer-voice (bass–soprano) pair. Unlike a true parallel perfect it is
 * discouraged rather than forbidden, so the weight sits alongside voice-leading
 * motion rather than the hard {@link VIOLATION_PENALTY}.
 */
const HIDDEN_PERFECT_PENALTY = 6;
/** Hard cap on candidate voicings evaluated per chord, keeping the search bounded. */
const MAX_CANDIDATES = 4000;

/** Reduce a value to a pitch class in [0, 11]. */
function pitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
}

/**
 * Resolve the per-voice ranges implied by the options: explicit `ranges` win,
 * four voices use {@link SATB_RANGES}, and other counts get evenly spaced
 * ranges spanning roughly the bass-to-soprano compass.
 */
function resolveRanges(opts?: VoicingOptions): VoiceRange[] {
  if (opts?.ranges !== undefined) {
    if (opts.ranges.length === 0) {
      throw new Error('ranges must contain at least one voice range');
    }
    return opts.ranges.map((range) => ({ ...range }));
  }
  const voices = opts?.voices ?? 4;
  if (voices < 1) {
    throw new Error('voices must be at least 1');
  }
  if (voices === 4) {
    return SATB_RANGES.map((range) => ({ ...range }));
  }
  if (voices === 1) {
    return [{ min: DERIVED_LOW, max: DERIVED_HIGH }];
  }
  const ranges: VoiceRange[] = [];
  for (let i = 0; i < voices; i += 1) {
    const min = Math.round(
      DERIVED_LOW + (i * (DERIVED_HIGH - DERIVED_SPAN - DERIVED_LOW)) / (voices - 1),
    );
    ranges.push({ min, max: min + DERIVED_SPAN });
  }
  return ranges;
}

/**
 * All MIDI pitches of a pitch class inside an inclusive range, ordered from the
 * centre of the range outward (ties break toward the lower pitch). Enumerating
 * centre-outward keeps the candidate set balanced around the register when it
 * is truncated at {@link MAX_CANDIDATES}, instead of skewing to the low octaves
 * that a plain ascending scan would visit first.
 */
function pitchesForPc(pc: number, range: VoiceRange): number[] {
  const result: number[] = [];
  for (let midi = Math.ceil(range.min); midi <= range.max; midi += 1) {
    if (pitchClass(midi) === pc) {
      result.push(midi);
    }
  }
  const center = (range.min + range.max) / 2;
  return result.sort((a, b) => {
    const da = Math.abs(a - center);
    const db = Math.abs(b - center);
    return da === db ? a - b : da - db;
  });
}

/**
 * Enumerate candidate voicings for a chord: the bass takes the chord's bass
 * (or root) pitch class at each available octave, and each upper voice takes
 * any chord pitch class within its range. Candidates are built in ascending
 * voice order and pruned to exclude voice crossings and over-wide adjacent
 * spacing (the bass–tenor pair is allowed an extra octave, per convention).
 * Enumeration is deterministic and capped at {@link MAX_CANDIDATES}.
 */
function enumerateVoicings(chord: Chord, ranges: VoiceRange[], maxSpacing: number): number[][] {
  const chordPcs = chordPitchClasses(chord);
  const bassPc = pitchClass(chord.bassPc ?? chord.rootPc);
  const results: number[][] = [];
  const current: number[] = [];
  const build = (voice: number): void => {
    if (results.length >= MAX_CANDIDATES) {
      return;
    }
    if (voice === ranges.length) {
      results.push([...current]);
      return;
    }
    const range = ranges[voice];
    if (range === undefined) {
      return;
    }
    const pcs = voice === 0 ? [bassPc] : chordPcs;
    const prev = current[voice - 1];
    for (const pc of pcs) {
      for (const pitch of pitchesForPc(pc, range)) {
        if (prev !== undefined) {
          if (pitch < prev) {
            continue; // would cross below the next lower voice
          }
          const spacingLimit = voice === 1 ? maxSpacing + 12 : maxSpacing;
          if (pitch - prev > spacingLimit) {
            continue;
          }
        }
        current.push(pitch);
        build(voice + 1);
        current.pop();
      }
    }
  };
  build(0);
  return results;
}

/**
 * Structural quality penalty of a single voicing: heavily penalize missing
 * chord tones, mildly penalize doubling anything other than the root or fifth.
 */
function structuralPenalty(pitches: number[], chord: Chord): number {
  const counts = new Map<number, number>();
  for (const pitch of pitches) {
    const pc = pitchClass(pitch);
    counts.set(pc, (counts.get(pc) ?? 0) + 1);
  }
  let penalty = 0;
  for (const pc of chordPitchClasses(chord)) {
    if (!counts.has(pc)) {
      penalty += MISSING_TONE_PENALTY;
    }
  }
  const rootPc = pitchClass(chord.rootPc);
  const fifthPc = pitchClass(chord.rootPc + 7);
  for (const [pc, count] of counts) {
    if (count > 1 && pc !== rootPc && pc !== fifthPc) {
      penalty += (count - 1) * POOR_DOUBLING_PENALTY;
    }
  }
  return penalty;
}

/**
 * Count counterpoint violations between two consecutive voicings of equal
 * length: parallel perfects (fifths and octaves alike, since octaves are the
 * perfect-class-zero case of {@link createsParallelPerfect}) on every voice
 * pair, voice crossings in the new voicing, and — on adjacent pairs — voice
 * overlaps and over-wide spacing between upper voices.
 */
function violationCount(prev: number[], cur: number[], maxSpacing: number): number {
  let count = 0;
  for (let lower = 0; lower < cur.length; lower += 1) {
    for (let upper = lower + 1; upper < cur.length; upper += 1) {
      const prevLower = prev[lower];
      const prevUpper = prev[upper];
      const curLower = cur[lower];
      const curUpper = cur[upper];
      if (
        prevLower === undefined ||
        prevUpper === undefined ||
        curLower === undefined ||
        curUpper === undefined
      ) {
        continue;
      }
      if (createsParallelPerfect(prevUpper, curUpper, prevLower, curLower)) {
        count += 1;
      }
      if (createsVoiceCrossing(curUpper, curLower)) {
        count += 1;
      }
      if (upper === lower + 1) {
        if (createsVoiceOverlap(prevUpper, curUpper, prevLower, curLower)) {
          count += 1;
        }
        if (lower > 0 && exceedsSpacing(curUpper, curLower, maxSpacing)) {
          count += 1;
        }
      }
    }
  }
  return count;
}

/**
 * Total voice-leading cost between two voicings: the sum of absolute semitone
 * motion across voices, plus a moderate {@link HIDDEN_PERFECT_PENALTY} when the
 * outer-voice (bass–soprano) pair reaches a hidden/direct perfect fifth or
 * octave by similar motion. The arrays must be the same length; when they
 * differ the voicings are not comparable and the cost is `Infinity`.
 *
 * @param from The previous voicing, one MIDI pitch per voice.
 * @param to The next voicing, one MIDI pitch per voice.
 * @returns The summed absolute motion (plus any hidden-perfect penalty), or
 *   `Infinity` when lengths differ.
 * @category Voicing & Counterpoint
 */
export function voiceLeadingCost(from: number[], to: number[]): number {
  if (from.length !== to.length) {
    return Number.POSITIVE_INFINITY;
  }
  let total = 0;
  for (let i = 0; i < from.length; i += 1) {
    const a = from[i];
    const b = to[i];
    if (a === undefined || b === undefined) {
      continue;
    }
    total += Math.abs(b - a);
  }
  // Discourage hidden/direct perfects between the outermost voices, where they
  // are most audible. True parallels are handled (and forbidden) elsewhere.
  if (from.length >= 2) {
    const bassPrev = from[0];
    const bassCur = to[0];
    const sopPrev = from[from.length - 1];
    const sopCur = to[to.length - 1];
    if (
      bassPrev !== undefined &&
      bassCur !== undefined &&
      sopPrev !== undefined &&
      sopCur !== undefined &&
      createsHiddenParallelPerfect(bassPrev, bassCur, sopPrev, sopCur)
    ) {
      total += HIDDEN_PERFECT_PENALTY;
    }
  }
  return total;
}

/**
 * Realize a single chord as one MIDI pitch per voice, ascending (index 0 =
 * lowest). The bass voice takes the chord's `bassPc` when set, otherwise the
 * root; upper voices take chord pitch classes, doubling the root or fifth as
 * needed to fill all voices. The result stays inside each voice's range, keeps
 * adjacent upper voices within `maxSpacing`, avoids voice crossing, and is
 * deterministic: a compact close-position voicing centered in the ranges.
 *
 * @param chord The chord to voice.
 * @param opts Voicing options; defaults to four voices in {@link SATB_RANGES}.
 * @returns MIDI pitches, ascending, one per voice.
 * @throws If no voicing fits the given ranges.
 * @example
 * ```ts
 * import { parseChordSymbol, voiceChord } from '@libraz/libcantus';
 * const chord = parseChordSymbol('Cmaj7');
 * voiceChord(chord); // four ascending MIDI pitches within the SATB ranges
 * ```
 * @category Voicing & Counterpoint
 */
export function voiceChord(chord: Chord, opts?: VoicingOptions): number[] {
  const ranges = resolveRanges(opts);
  const maxSpacing = opts?.maxSpacing ?? DEFAULT_MAX_SPACING;
  const candidates = enumerateVoicings(chord, ranges, maxSpacing);
  let best: number[] | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    let score = structuralPenalty(candidate, chord);
    for (let i = 0; i < candidate.length; i += 1) {
      const pitch = candidate[i];
      const range = ranges[i];
      if (pitch === undefined || range === undefined) {
        continue;
      }
      // Prefer pitches near the middle of each voice's range for a centered,
      // compact default voicing.
      score += Math.abs(pitch - (range.min + range.max) / 2);
    }
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best === undefined) {
    throw new Error('no voicing satisfies the given ranges');
  }
  return best;
}

/**
 * Voice a chord progression with smooth voice leading. The first chord is
 * voiced with {@link voiceChord}; each subsequent chord picks, from a bounded
 * deterministic candidate set, the voicing minimizing the voice-leading cost
 * from the previous voicing plus a large penalty per counterpoint violation
 * (parallel perfects/octaves, voice crossing, voice overlap, and over-wide
 * upper-voice spacing).
 *
 * @param chords The chords to voice in order.
 * @param opts Voicing options; defaults to four voices in {@link SATB_RANGES}.
 * @returns One voicing per chord, each ascending with one MIDI pitch per voice.
 * @throws If any chord admits no voicing within the given ranges.
 * @example
 * ```ts
 * import { parseChordSymbol, voiceProgression } from '@libraz/libcantus';
 * const chords = ['C', 'Am', 'F', 'G'].map((s) => parseChordSymbol(s));
 * voiceProgression(chords); // one four-voice voicing per chord, smoothly led
 * ```
 * @category Voicing & Counterpoint
 */
export function voiceProgression(chords: Chord[], opts?: VoicingOptions): number[][] {
  const ranges = resolveRanges(opts);
  const maxSpacing = opts?.maxSpacing ?? DEFAULT_MAX_SPACING;
  const result: number[][] = [];
  let prev: number[] | undefined;
  for (const chord of chords) {
    if (prev === undefined) {
      prev = voiceChord(chord, opts);
      result.push(prev);
      continue;
    }
    const candidates = enumerateVoicings(chord, ranges, maxSpacing);
    let best: number[] | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const score =
        structuralPenalty(candidate, chord) +
        voiceLeadingCost(prev, candidate) +
        VIOLATION_PENALTY * violationCount(prev, candidate, maxSpacing);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best === undefined) {
      throw new Error('no voicing satisfies the given ranges');
    }
    result.push(best);
    prev = best;
  }
  return result;
}

/**
 * A tertian voicing style for {@link voiceChordStyled}.
 *
 * - `close`: the plain close-position tertian stack.
 * - `drop2`: the second voice from the top dropped an octave (drop-2 voicing).
 * - `drop3`: the third voice from the top dropped an octave (drop-3 voicing).
 * - `shell`: root plus guide tones (third and seventh) for seventh chords, or
 *   root/third/fifth for triads; the fifth and tensions are omitted.
 * - `rootless`: the root omitted, keeping third/fifth/seventh and tensions
 *   (a typical left-hand jazz voicing).
 *
 * @category Voicing & Counterpoint
 */
export type VoicingStyle = 'close' | 'drop2' | 'drop3' | 'shell' | 'rootless';

/**
 * Options controlling {@link voiceChordStyled}.
 *
 * @category Voicing & Counterpoint
 */
export type StyledVoicingOptions = {
  /**
   * Voicing style to build.
   *
   * @defaultValue 'close'
   */
  style?: VoicingStyle;
  /** Constrain the highest voice to this pitch class (0..11) when given. */
  topNote?: number;
  /**
   * Base octave for the close stack; the stack begins near `12 * octave`.
   *
   * @defaultValue 4
   */
  octave?: number;
  /**
   * Omit the root regardless of style (relevant for jazz voicings).
   *
   * @defaultValue false
   */
  rootless?: boolean;
};

/** Default base octave for a styled close-position stack. */
const DEFAULT_STYLE_OCTAVE = 4;

/** Return the pitch classes of a list in order, without duplicates. */
function dedupePcs(pcs: number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const pc of pcs) {
    if (!seen.has(pc)) {
      seen.add(pc);
      result.push(pc);
    }
  }
  return result;
}

/** The lowest MIDI pitch of a pitch class at or above a floor. */
function lowestPitchAtOrAbove(pc: number, floor: number): number {
  return floor + ((((pc - pitchClass(floor)) % 12) + 12) % 12);
}

/** The pitch class in `pcs` whose circular distance to `target` is smallest. */
function nearestPc(target: number, pcs: number[]): number {
  let best = pcs[0] ?? target;
  let bestDist = 12;
  for (const pc of pcs) {
    const dist = Math.min((((pc - target) % 12) + 12) % 12, (((target - pc) % 12) + 12) % 12);
    if (dist < bestDist) {
      bestDist = dist;
      best = pc;
    }
  }
  return best;
}

/**
 * Realize a single chord as an explicit tertian voicing in a chosen style,
 * independent of the SATB range search used by {@link voiceChord}.
 *
 * The chord tones are stacked in close position from the bass (`bassPc`, else
 * `rootPc`) in the given scientific-pitch `octave` upward (octave 4 starts the
 * bass near C4 = MIDI 60, matching {@link midiToNote} and the bass module).
 * When `topNote` is given the stack is rotated so the highest voice's pitch
 * class equals that note (or the nearest chord tone). The chosen
 * {@link VoicingStyle} then transforms the stack, and the result is returned as
 * ascending MIDI pitches (index 0 = lowest).
 *
 * @param chord The chord to voice.
 * @param opts Styled voicing options; defaults to a close voicing at octave 4.
 * @returns MIDI pitches, ascending, one per retained voice.
 * @example
 * ```ts
 * import { parseChordSymbol, voiceChordStyled } from '@libraz/libcantus';
 * const chord = parseChordSymbol('Dm7');
 * voiceChordStyled(chord, { style: 'drop2' }); // ascending MIDI pitches, drop-2 voicing
 * ```
 * @category Voicing & Counterpoint
 */
export function voiceChordStyled(chord: Chord, opts?: StyledVoicingOptions): number[] {
  const style = opts?.style ?? 'close';
  const base = 12 * ((opts?.octave ?? DEFAULT_STYLE_OCTAVE) + 1);
  const rootPc = pitchClass(chord.rootPc);
  const bassPc = pitchClass(chord.bassPc ?? chord.rootPc);
  const omitRoot = style === 'rootless' || opts?.rootless === true;

  // Tertian chord tones in order, with the bass tone rotated to the bottom.
  let order = dedupePcs(chord.intervals.map((interval) => pitchClass(chord.rootPc + interval)));
  const bassIndex = order.indexOf(bassPc);
  if (bassIndex > 0) {
    order = [...order.slice(bassIndex), ...order.slice(0, bassIndex)];
  } else if (bassIndex < 0) {
    order = [bassPc, ...order];
  }

  if (style === 'shell') {
    const roles = order.map((pc) => chordToneRole(pc, chord));
    // The guide tone is the seventh when present; on a sixth chord the sixth
    // stands in for it, and otherwise the voicing falls back to the fifth.
    const guide = roles.includes('seventh')
      ? 'seventh'
      : roles.includes('sixth')
        ? 'sixth'
        : 'fifth';
    order = order.filter((_pc, i) => {
      const role = roles[i];
      return role === 'root' || role === 'third' || role === guide;
    });
  }

  if (omitRoot) {
    order = order.filter((pc) => pc !== rootPc);
  }

  if (order.length === 0) {
    return [];
  }

  if (opts?.topNote !== undefined) {
    const target = order.includes(pitchClass(opts.topNote))
      ? pitchClass(opts.topNote)
      : nearestPc(pitchClass(opts.topNote), order);
    const targetIndex = order.indexOf(target);
    order = [...order.slice(targetIndex + 1), ...order.slice(0, targetIndex + 1)];
  }

  // Stack the ordered pitch classes upward in close position.
  const stack: number[] = [];
  let prev: number | undefined;
  for (const pc of order) {
    if (prev === undefined) {
      prev = lowestPitchAtOrAbove(pc, base);
    } else {
      let delta = (((pc - pitchClass(prev)) % 12) + 12) % 12;
      if (delta === 0) {
        delta = 12;
      }
      prev += delta;
    }
    stack.push(prev);
  }

  if (style === 'drop2' && stack.length >= 2) {
    stack[stack.length - 2] = (stack[stack.length - 2] ?? 0) - 12;
  } else if (style === 'drop3' && stack.length >= 3) {
    stack[stack.length - 3] = (stack[stack.length - 3] ?? 0) - 12;
  }

  return stack.sort((a, b) => a - b);
}

/**
 * Voice a single chord to follow smoothly from an arbitrary current voicing.
 *
 * Candidate voicings of `chord` are enumerated within ranges taken from `opts`,
 * or — when neither `voices` nor `ranges` is given — from a one-octave window
 * around each pitch of `current` (so the result matches `current`'s voice
 * count). Each candidate is scored by structural quality, voice-leading motion
 * from `current`, and a large penalty per counterpoint violation; the lowest
 * scoring candidate is returned, ascending.
 *
 * @param current The current voicing to lead from, ascending (index 0 = lowest).
 * @param chord The next chord to voice.
 * @param opts Voicing options; when omitted, ranges follow `current`'s span.
 * @returns The chosen voicing, ascending with one MIDI pitch per voice.
 * @throws If no voicing fits the derived ranges.
 * @category Voicing & Counterpoint
 */
export function nextVoicing(current: number[], chord: Chord, opts?: VoicingOptions): number[] {
  const ranges =
    opts?.ranges !== undefined || opts?.voices !== undefined
      ? resolveRanges(opts)
      : current.map((pitch) => {
          // Window one octave around each current pitch, clamped so extreme-low
          // or extreme-high input can never yield MIDI outside [0, 127].
          const centre = Math.min(127, Math.max(0, pitch));
          return { min: Math.max(0, centre - 12), max: Math.min(127, centre + 12) };
        });
  const maxSpacing = opts?.maxSpacing ?? DEFAULT_MAX_SPACING;
  const candidates = enumerateVoicings(chord, ranges, maxSpacing);
  let best: number[] | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const score =
      structuralPenalty(candidate, chord) +
      voiceLeadingCost(current, candidate) +
      VIOLATION_PENALTY * violationCount(current, candidate, maxSpacing);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best === undefined) {
    throw new Error('no voicing satisfies the given ranges');
  }
  return best;
}
