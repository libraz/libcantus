import type { HitList } from './hit.js';
import type { DrumStyle, SectionEnergy, SectionType } from './internal.js';
import { EIGHTH, GM, SIXTEENTH } from './internal.js';
import type { DrumRng } from './rng.js';

/** The thirteen fill archetypes for section transitions. */
export type FillType =
  | 'snareRoll'
  | 'tomDescend'
  | 'tomAscend'
  | 'snareTomCombo'
  | 'simpleCrash'
  | 'linearFill'
  | 'ghostToAccent'
  | 'bdSnareAlternate'
  | 'hiHatChoke'
  | 'tomShuffle'
  | 'breakdownFill'
  | 'flamsAndDrags'
  | 'halfTimeFill';

/** Beat at which a fill begins, widening with section energy. */
export function getFillStartBeat(energy: SectionEnergy): number {
  switch (energy) {
    case 'low':
      return 3;
    case 'medium':
      return 2;
    case 'high':
    case 'peak':
      return 0;
  }
}

/**
 * Pick a fill archetype for a section transition.
 *
 * The transition-specific archetypes (into a chorus, out of an intro) are
 * checked before the generic energy fills so every variation stays reachable;
 * with `from === to` the caller effectively asks for a within-section fill.
 *
 * @param from Section the fill leaves.
 * @param to Section the fill leads into.
 * @param style Internal drum style.
 * @param nextEnergy Energy of the section the fill leads into.
 * @param rng Deterministic PRNG.
 */
export function selectFillType(
  from: SectionType,
  to: SectionType,
  style: DrumStyle,
  nextEnergy: SectionEnergy,
  rng: DrumRng,
): FillType {
  if (style === 'sparse') {
    return rng.range(0, 1) === 0 ? 'simpleCrash' : 'breakdownFill';
  }

  const toChorus = to === 'chorus';
  const fromIntro = from === 'intro';
  const highEnergy = style === 'rock' || style === 'fourOnFloor';

  // Dropping into a low-energy section: keep the phrase end gentle.
  if (nextEnergy === 'low') {
    switch (rng.range(0, 2)) {
      case 0:
        return 'simpleCrash';
      case 1:
        return 'breakdownFill';
      default:
        return 'halfTimeFill';
    }
  }

  // Big lead-ins to a chorus take precedence over the generic energy fills.
  if (toChorus) {
    const choice = rng.range(0, 7);
    if (highEnergy) {
      switch (choice) {
        case 0:
        case 1:
          return 'tomDescend';
        case 2:
          return 'snareRoll';
        case 3:
          return 'linearFill';
        case 4:
          return 'bdSnareAlternate';
        case 5:
          return 'flamsAndDrags';
        case 6:
          return 'tomShuffle';
        default:
          return 'ghostToAccent';
      }
    }
    switch (choice) {
      case 0:
      case 1:
        return 'snareTomCombo';
      case 2:
        return 'tomDescend';
      case 3:
        return 'ghostToAccent';
      case 4:
        return 'hiHatChoke';
      case 5:
        return 'linearFill';
      default:
        return 'snareRoll';
    }
  }

  // Leaving the intro: lighter, building character.
  if (fromIntro) {
    switch (rng.range(0, 5)) {
      case 0:
      case 1:
        return 'snareRoll';
      case 2:
        return 'simpleCrash';
      case 3:
        return 'ghostToAccent';
      case 4:
        return 'breakdownFill';
      default:
        return 'halfTimeFill';
    }
  }

  // Generic medium/high/peak fills, split by style energy.
  const choice = rng.range(0, 7);
  if (highEnergy) {
    switch (choice) {
      case 0:
        return 'tomDescend';
      case 1:
        return 'snareRoll';
      case 2:
        return 'tomAscend';
      case 3:
        return 'snareTomCombo';
      case 4:
        return 'linearFill';
      case 5:
        return 'bdSnareAlternate';
      case 6:
        return 'flamsAndDrags';
      default:
        return 'tomShuffle';
    }
  }

  switch (choice) {
    case 0:
    case 1:
      return 'snareRoll';
    case 2:
      return 'snareTomCombo';
    case 3:
      return 'ghostToAccent';
    case 4:
      return 'hiHatChoke';
    case 5:
      return 'halfTimeFill';
    default:
      return 'breakdownFill';
  }
}

/**
 * Emit a fill for a single beat of the fill bar.
 *
 * @param track Hit accumulator.
 * @param beatTick Absolute beat position of this beat.
 * @param beat Beat index within the bar (0-3).
 * @param fillType Selected fill archetype.
 * @param velocity Base velocity for the beat.
 */
export function generateFill(
  track: HitList,
  beatTick: number,
  beat: number,
  fillType: FillType,
  velocity: number,
): void {
  const fillVel = velocity * 0.9;
  const accentVel = velocity * 0.95;
  const S = SIXTEENTH;
  const E = EIGHTH;

  if (beat === 0) {
    track.add(GM.BD, beatTick, E, fillVel);
    track.add(GM.SD, beatTick + E, E, fillVel - 5);
    return;
  }
  if (beat === 1) {
    track.add(GM.SD, beatTick, E, fillVel);
    track.add(GM.TOM_H, beatTick + E, E, fillVel - 3);
    return;
  }

  switch (fillType) {
    case 'snareRoll':
      if (beat === 2) {
        for (let i = 0; i < 4; i += 1) {
          track.add(GM.SD, beatTick + i * S, S, fillVel * (0.6 + 0.1 * i));
        }
      } else {
        for (let i = 0; i < 3; i += 1) {
          track.add(GM.SD, beatTick + i * S, S, fillVel * (0.7 + 0.1 * i));
        }
        track.add(GM.SD, beatTick + 3 * S, S, accentVel);
      }
      break;

    case 'tomDescend':
      if (beat === 2) {
        track.add(GM.SD, beatTick, E, fillVel);
        track.add(GM.TOM_H, beatTick + E, E, fillVel - 5);
      } else {
        track.add(GM.TOM_H, beatTick, S, fillVel);
        track.add(GM.TOM_M, beatTick + S, S, fillVel - 3);
        track.add(GM.TOM_M, beatTick + E, S, fillVel - 5);
        track.add(GM.TOM_L, beatTick + E + S, S, accentVel);
      }
      break;

    case 'tomAscend':
      if (beat === 2) {
        track.add(GM.SD, beatTick, E, fillVel);
        track.add(GM.TOM_L, beatTick + E, E, fillVel - 5);
      } else {
        track.add(GM.TOM_L, beatTick, S, fillVel);
        track.add(GM.TOM_M, beatTick + S, S, fillVel + 3);
        track.add(GM.TOM_M, beatTick + E, S, fillVel + 5);
        track.add(GM.TOM_H, beatTick + E + S, S, accentVel);
      }
      break;

    case 'snareTomCombo':
      if (beat === 2) {
        track.add(GM.SD, beatTick, E, fillVel);
        track.add(GM.SD, beatTick + E, S, fillVel - 5);
        track.add(GM.TOM_H, beatTick + E + S, S, fillVel);
      } else {
        track.add(GM.TOM_M, beatTick, S, fillVel);
        track.add(GM.SD, beatTick + S, S, fillVel - 3);
        track.add(GM.TOM_L, beatTick + E, S, fillVel + 2);
        track.add(GM.BD, beatTick + E + S, S, accentVel);
      }
      break;

    case 'simpleCrash':
      if (beat === 3) {
        track.add(GM.BD, beatTick + E + S, S, accentVel);
        track.add(GM.CRASH, beatTick + E + S, E, accentVel);
      }
      break;

    case 'linearFill':
      if (beat === 2) {
        track.add(GM.BD, beatTick, S, fillVel);
        track.add(GM.SD, beatTick + S, S, fillVel);
        track.add(GM.TOM_H, beatTick + 2 * S, S, fillVel);
        track.add(GM.TOM_M, beatTick + 3 * S, S, fillVel);
      } else {
        track.add(GM.TOM_L, beatTick, S, fillVel + 3);
        track.add(GM.SD, beatTick + S, S, fillVel + 5);
        track.add(GM.BD, beatTick + 2 * S, S, fillVel + 7);
        track.add(GM.SD, beatTick + 3 * S, S, accentVel);
      }
      break;

    case 'ghostToAccent':
      if (beat === 2) {
        const ghost = fillVel * 0.4;
        track.add(GM.SD, beatTick, S, ghost);
        track.add(GM.SD, beatTick + S, S, ghost + 10);
        track.add(GM.SD, beatTick + 2 * S, S, ghost + 20);
        track.add(GM.SD, beatTick + 3 * S, S, ghost + 30);
      } else {
        track.add(GM.SD, beatTick, E, fillVel);
        track.add(GM.SD, beatTick + E, E, accentVel);
      }
      break;

    case 'bdSnareAlternate':
      if (beat === 2) {
        track.add(GM.BD, beatTick, S, fillVel);
        track.add(GM.SD, beatTick + S, S, fillVel);
        track.add(GM.BD, beatTick + 2 * S, S, fillVel + 3);
        track.add(GM.SD, beatTick + 3 * S, S, fillVel + 3);
      } else {
        track.add(GM.BD, beatTick, S, fillVel + 5);
        track.add(GM.SD, beatTick + S, S, fillVel + 5);
        track.add(GM.BD, beatTick + 2 * S, S, accentVel);
        track.add(GM.SD, beatTick + 3 * S, S, accentVel);
      }
      break;

    case 'hiHatChoke':
      if (beat === 2) {
        track.add(GM.OHH, beatTick, E, fillVel);
        track.add(GM.OHH, beatTick + E, E, fillVel + 5);
      } else {
        track.add(GM.OHH, beatTick, S, fillVel + 8);
        track.add(GM.CHH, beatTick + S, S, accentVel);
        track.add(GM.SD, beatTick + E, E, accentVel);
      }
      break;

    case 'tomShuffle':
      if (beat === 2) {
        track.add(GM.TOM_H, beatTick, E, fillVel);
        track.add(GM.TOM_M, beatTick + E + S / 2, S, fillVel - 5);
      } else {
        track.add(GM.TOM_M, beatTick, E, fillVel);
        track.add(GM.TOM_L, beatTick + E + S / 2, S, fillVel + 5);
      }
      break;

    case 'breakdownFill':
      if (beat === 3) {
        track.add(GM.SD, beatTick + E, S, accentVel);
      }
      break;

    case 'flamsAndDrags':
      if (beat === 2) {
        track.add(GM.SD, beatTick - S / 4, S / 4, fillVel * 0.5);
        track.add(GM.SD, beatTick, E, fillVel);
        track.add(GM.SD, beatTick + E, S / 2, fillVel * 0.6);
        track.add(GM.SD, beatTick + E + S / 2, S / 2, fillVel * 0.6);
        track.add(GM.SD, beatTick + E + S, E, fillVel);
      } else {
        track.add(GM.SD, beatTick - S / 4, S / 4, fillVel * 0.5);
        track.add(GM.SD, beatTick, 1, accentVel);
      }
      break;

    case 'halfTimeFill':
      if (beat === 2) {
        track.add(GM.SD, beatTick, 1, accentVel);
        track.add(GM.BD, beatTick, 1, fillVel);
      } else if (beat === 3) {
        // At low energy the fill spans only beat 3, so this branch keeps the
        // phrase end from going silent: a broad half-time backbeat snare with a
        // light pickup into the next section.
        track.add(GM.SD, beatTick, EIGHTH, accentVel);
        track.add(GM.SD, beatTick + E, S, fillVel * 0.6);
        track.add(GM.SD, beatTick + E + S, S, accentVel);
      }
      break;
  }
}
