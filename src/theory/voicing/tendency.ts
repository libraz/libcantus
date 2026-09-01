/**
 * Tendency tones: which pitch class of a chord owes its next move to a rule.
 *
 * The voicing search and the part-writing checker both need this, and they have
 * to agree on it. A generator resolving a tone the checker does not recognize —
 * or holding one the checker thinks must move — would report its own output as
 * faulty, so both read the same predicates from here.
 */

import { pitchClassOf } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordQuality } from '../chord/index.js';
import { chordToneRole } from '../chord/index.js';

/** The key's leading tone as a pitch class. */
export function leadingTonePcOf(key: KeyScale): number {
  return pitchClassOf(key.rootPc - 1);
}

/** The qualities a leading-tone chord takes: the diminished triad and sevenths. */
const LEADING_TONE_QUALITIES: ReadonlySet<ChordQuality> = new Set(['dim', 'dim7', 'm7b5']);

/**
 * Whether the key's leading tone is functioning as one in a chord.
 *
 * The tendency is the dominant's, not the pitch class's: the leading tone must
 * rise where it is the third of a chord built on the dominant degree, or the
 * root of a leading-tone chord, which are the two places it carries dominant
 * function. The same pitch class is an ordinary chord tone elsewhere — the
 * fifth of iii, or the seventh of Imaj7 — and is free to move as the line asks,
 * which for a seventh means falling by step.
 */
export function isFunctioningLeadingTone(chord: Chord, key: KeyScale): boolean {
  const role = chordToneRole(leadingTonePcOf(key), chord);
  if (role === 'third') {
    return pitchClassOf(chord.rootPc) === pitchClassOf(key.rootPc + 7);
  }
  if (role === 'root') {
    return LEADING_TONE_QUALITIES.has(chord.quality);
  }
  return false;
}

/**
 * The chord's own seventh as a pitch class, or undefined when it has none.
 *
 * "Seventh" means the tone the chord itself writes as one, which is what
 * {@link chordToneRole} answers: a chord carrying its own spelling is read by
 * that spelling, so the augmented sixth of an Italian or German sixth — ten
 * semitones above the root but five letters up — is a sixth resolving outward
 * and owes nothing to the seventh's downward rule. The French sixth is rooted
 * on the supertonic, where its ten semitones really are a chordal seventh, and
 * keeps that obligation.
 */
export function seventhPcOf(chord: Chord): number | undefined {
  for (const interval of chord.intervals) {
    const pc = pitchClassOf(chord.rootPc + interval);
    if (chordToneRole(pc, chord) === 'seventh') {
      return pc;
    }
  }
  return undefined;
}
