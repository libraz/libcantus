import type { Chord } from '../chord/index.js';
import { chordToneRole } from '../chord/index.js';
import { pitchClass } from './internal.js';

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
