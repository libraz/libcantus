import { hasHit } from './euclid.js';
import type { DrumStyle, SectionType } from './internal.js';
import type { DrumRng } from './rng.js';

/** Kick presence flags across the eight 8th-note slots of a bar. */
export type KickPattern = {
  beat1: boolean;
  beat1and: boolean;
  beat2: boolean;
  beat2and: boolean;
  beat3: boolean;
  beat3and: boolean;
  beat4: boolean;
  beat4and: boolean;
};

const EMPTY: KickPattern = {
  beat1: false,
  beat1and: false,
  beat2: false,
  beat2and: false,
  beat3: false,
  beat3and: false,
  beat4: false,
  beat4and: false,
};

/**
 * Whether a pre-chorus bar sits in the two-bar lift into the chorus.
 *
 * @param section Current section.
 * @param bar Bar index within the section.
 * @param sectionBars Total bars in the section.
 * @param nextIsChorus Whether the following section is a chorus.
 */
export function isInPreChorusLift(
  section: SectionType,
  bar: number,
  sectionBars: number,
  nextIsChorus: boolean,
): boolean {
  if (section !== 'b' || !nextIsChorus || sectionBars < 3) {
    return false;
  }
  return bar >= sectionBars - 2;
}

/** Convert a 16-step euclidean bitmask into an 8th-slot kick pattern. */
export function euclideanToKickPattern(mask: number): KickPattern {
  const slot = (step: number) => hasHit(mask, step) || hasHit(mask, (step + 15) % 16);
  return {
    beat1: slot(0),
    beat1and: slot(2),
    beat2: slot(4),
    beat2and: slot(6),
    beat3: slot(8),
    beat3and: slot(10),
    beat4: slot(12),
    beat4and: slot(14),
  };
}

/**
 * Build a section- and style-aware kick pattern.
 *
 * @param section Current section.
 * @param style Internal drum style.
 * @param bar Bar index (drives variation for a few styles).
 * @param rng Deterministic PRNG for probabilistic accents.
 */
export function getKickPattern(
  section: SectionType,
  style: DrumStyle,
  bar: number,
  rng: DrumRng,
): KickPattern {
  const p: KickPattern = { ...EMPTY };

  if (section === 'outro') {
    p.beat1 = true;
    p.beat3 = true;
    return p;
  }

  switch (style) {
    case 'sparse':
      p.beat1 = true;
      if (section === 'chorus' && bar % 2 === 1) {
        p.beat3 = true;
      }
      break;

    case 'fourOnFloor':
      p.beat1 = p.beat2 = p.beat3 = p.beat4 = true;
      if (section === 'chorus' && rng.prob(0.2)) {
        p.beat2and = true;
      }
      break;

    case 'upbeat':
      p.beat1 = true;
      p.beat3 = true;
      if (section === 'b' || section === 'chorus') {
        p.beat2and = rng.prob(0.7);
      }
      if (section === 'chorus') {
        p.beat4and = rng.prob(0.6);
      }
      break;

    case 'rock':
      p.beat1 = true;
      p.beat3 = true;
      if (section === 'chorus') {
        p.beat2and = rng.prob(0.65);
        p.beat4and = rng.prob(0.4);
      } else if (section === 'b') {
        p.beat2and = rng.prob(0.3);
      }
      break;

    case 'synth':
      p.beat1 = true;
      p.beat3 = true;
      if (section === 'b' || section === 'chorus') {
        p.beat2and = rng.prob(0.75);
      }
      if (section === 'chorus') {
        p.beat4and = rng.prob(0.65);
      }
      break;

    case 'trap':
      p.beat1 = true;
      p.beat2and = rng.prob(0.8);
      p.beat3 = rng.prob(0.3);
      p.beat4and = rng.prob(0.7);
      break;

    case 'latin':
      p.beat1 = true;
      p.beat2and = true;
      p.beat3 = true;
      p.beat4and = rng.prob(0.5);
      break;

    default:
      p.beat1 = true;
      p.beat3 = true;
      if (section === 'b') {
        p.beat2and = rng.prob(0.5);
      } else if (section === 'chorus') {
        p.beat2and = rng.prob(0.55);
        p.beat4and = rng.prob(0.35);
      }
      break;
  }

  return p;
}
