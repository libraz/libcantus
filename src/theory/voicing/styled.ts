import { InvalidInputError } from '../../core/errors/index.js';
import { assertFiniteNumber, assertInteger, assertOptions } from '../../core/validation/index.js';
import { chordToneRole } from '../chord/index.js';
import { type ChordLike, toChordData } from '../symbol/index.js';
import { pitchClass } from './internal.js';

/**
 * A tertian voicing style for {@link voiceChordStyled}.
 *
 * - `close`: the plain close-position tertian stack.
 * - `drop2`: the second voice from the top dropped an octave (drop-2 voicing).
 *   It takes at least three voices, since the voice it names has to have
 *   another below it for the drop to open the stack at all.
 * - `drop3`: the third voice from the top dropped an octave (drop-3 voicing).
 *   It takes at least four voices, for the same reason.
 * - `shell`: root plus guide tones (third and seventh) for seventh chords, or
 *   root/third/fifth for triads; the fifth and tensions are omitted.
 * - `rootless`: the root omitted, keeping third/fifth/seventh and tensions
 *   (a typical left-hand jazz voicing).
 *
 * A chord with too few voices for the drop it asks for is voiced in close
 * position instead: a three-note `drop3` is the close stack, not a stack with
 * its bottom voice pushed an octave down. A slash bass the chord does not
 * contain sounds under the stack rather than in it, and is not one of the
 * voices counted here.
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
   * Base octave in scientific pitch notation: octave 4 starts the stack near
   * middle C (MIDI 60), i.e. near `12 * (octave + 1)`.
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

/**
 * Which voice of the close stack, counted from the top, a style lowers an
 * octave; 0 for a style that lowers none.
 */
function dropPositionFromTop(style: VoicingStyle): number {
  if (style === 'drop2') {
    return 2;
  }
  return style === 'drop3' ? 3 : 0;
}

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
 * A drop voicing lowers one voice below the rest, so that voice is its bass —
 * which is what tells the drop-2 voicings of one chord apart. When the chord
 * names a bass tone of its own, the close stack is therefore rotated so the
 * style drops that tone, and the result is the drop voicing whose bass is the
 * tone asked for; the named bass is not lowered under an already dropped voice
 * afterwards, which would leave a hole wider than an octave in the middle. A
 * bass the chord does not contain is no voice of the stack and cannot be the
 * dropped one, so it keeps the bottom and the drop happens above it.
 *
 * Every returned pitch is a valid MIDI number: an octave whose stack would run
 * off either end of the 0..127 range is rejected rather than voiced out of
 * range, matching {@link nextVoicing}, which clamps its derived ranges.
 *
 * @param chord The chord to voice, in whatever form it is held: a chord symbol,
 *   plain chord data, or a `Chord`.
 * @param opts Styled voicing options; defaults to a close voicing at octave 4.
 * @returns MIDI pitches, ascending, one per retained voice.
 * @throws If the voicing would not fit inside MIDI 0..127 at the given octave.
 * @example
 * ```ts
 * import { voiceChordStyled } from '@libraz/libcantus';
 * voiceChordStyled('Dm7', { style: 'drop2' }); // ascending MIDI pitches, drop-2 voicing
 * ```
 * @category Voicing & Counterpoint
 */
export function voiceChordStyled(given: ChordLike, opts?: StyledVoicingOptions): number[] {
  assertOptions(opts, 'opts');
  const chord = toChordData(given);
  const style = opts?.style ?? 'close';
  const octave = opts?.octave ?? DEFAULT_STYLE_OCTAVE;
  assertInteger(octave, 'styled voicing octave', -10, 10);
  if (opts?.topNote !== undefined) {
    assertFiniteNumber(opts.topNote, 'styled voicing topNote');
  }
  const base = 12 * (octave + 1);
  const rootPc = pitchClass(chord.rootPc);
  const bassPc = pitchClass(chord.bassPc ?? chord.rootPc);
  const omitRoot = style === 'rootless' || opts?.rootless === true;

  // Tertian chord tones in order, with the bass tone rotated to the bottom.
  let order = dedupePcs(chord.intervals.map((interval) => pitchClass(chord.rootPc + interval)));
  const bassIndex = order.indexOf(bassPc);
  const bassIsChordTone = bassIndex >= 0;
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
      return _pc === bassPc || role === 'root' || role === 'third' || role === guide;
    });
  }

  if (omitRoot) {
    order = order.filter((pc) => pc !== rootPc || (chord.bassPc !== undefined && pc === bassPc));
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

  // A drop puts the voice it lowers under the whole stack, so on a drop voicing
  // the dropped voice is the bass. When the chord names a bass tone of its own,
  // rotate the close stack so the named tone is the one the style drops: the
  // requested bass then reaches the bottom through the drop itself, which is
  // also what tells the four drop-2 voicings of a seventh chord apart. Lowering
  // it afterwards instead, under a voice already dropped below it, would open a
  // hole wider than an octave inside a voicing whose point is compactness.
  // A rotation is a single choice, so this overrides any `topNote` rotation.
  const dropFromTop = dropPositionFromTop(style);
  const dropsToNamedBass =
    dropFromTop > 0 && bassIsChordTone && chord.bassPc !== undefined && order.length > dropFromTop;
  if (dropsToNamedBass) {
    const bassAt = order.indexOf(bassPc);
    if (bassAt >= 0) {
      const shift =
        (((bassAt - (order.length - dropFromTop)) % order.length) + order.length) % order.length;
      order = [...order.slice(shift), ...order.slice(0, shift)];
    }
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

  // The dropped voice needs another voice below it, or the drop only moves the
  // bottom of the stack down an octave and leaves the rest where it was, which
  // opens the stack nowhere. A chord that short is voiced in close position.
  // A bass the chord does not contain is no part of the stacked chord tones —
  // it sounds under them — so it is neither dropped nor counted as that voice.
  const stackedFloor = bassIsChordTone ? 0 : 1;
  if (dropFromTop > 0 && stack.length - dropFromTop > stackedFloor) {
    const dropIndex = stack.length - dropFromTop;
    stack[dropIndex] = (stack[dropIndex] ?? 0) - 12;
  }

  // An explicit slash bass is a structural requirement, including when it is
  // not a chord member — and a bass that is no chord tone cannot be the voice a
  // drop lowers, so it stays where the stack put it. Top-note rotation, or a
  // stack wide enough that the dropped voice lands above the bass, may leave a
  // different tone below it, so lower the retained bass by octaves before the
  // final sort. This gives the bass priority over a conflicting top-note hint.
  if (chord.bassPc !== undefined) {
    const bassIndexInStack = stack.findIndex((pitch) => pitchClass(pitch) === bassPc);
    if (bassIndexInStack >= 0) {
      const otherLowest = Math.min(
        ...stack.filter((_pitch, index) => index !== bassIndexInStack),
        Number.POSITIVE_INFINITY,
      );
      while ((stack[bassIndexInStack] ?? 0) >= otherLowest) {
        stack[bassIndexInStack] = (stack[bassIndexInStack] ?? 0) - 12;
      }
    }
  }

  const voicing = stack.sort((a, b) => a - b);
  const lowest = voicing[0] ?? 0;
  const highest = voicing[voicing.length - 1] ?? 0;
  if (lowest < 0 || highest > 127) {
    throw new InvalidInputError(
      `styled voicing at octave ${octave} spans MIDI ${lowest}..${highest}, outside 0..127`,
    );
  }
  return voicing;
}
