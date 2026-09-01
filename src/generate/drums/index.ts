import { InvalidInputError } from '../../core/errors/index.js';
import { canSound, type InstrumentProfile } from '../../core/instrument/index.js';
import { beatsPerBar, type MeterLike, meterAt, toMeterData } from '../../core/meter/index.js';
import {
  assertGenerationBudget,
  assertInteger,
  assertOneOf,
  assertPositiveInt,
} from '../../core/validation/index.js';
import { type GenerationContextInput, resolveContext, sustainsStrokes } from '../context/index.js';
import { selectVocabulary, vocabularyOfKind } from '../vocabulary/index.js';
import {
  type BeatCtx,
  generateGhostNotesForBeat,
  generateHiHatForBeat,
  generateKickForBeat,
  generatePreChorusBuildup,
  generateSnareForBeat,
  type SectionCtx,
  swing16,
} from './beat.js';
import { euclideanRhythm } from './euclid.js';
import {
  FILL_ARCHETYPES,
  type FillArchetype,
  fillArchetypeFor,
  fillWithinCeiling,
  generateFill,
  getFillStartBeat,
  isFillArchetype,
  selectFillType,
} from './fills.js';
import {
  footHiHatVelocity,
  getHiHatLevel,
  openHiHatBarInterval,
  openHiHatBeat,
  shouldPlayHiHat,
  shouldUseFootHiHat,
  shouldUseRideForSection,
} from './hihat.js';
import { type DrumHit, HitList, onsetKey } from './hit.js';
import {
  backingScale,
  calculateVelocity,
  DEFAULT_RHYTHMIC,
  DRUM_FEELS,
  DRUM_ROLES,
  type DrumRole,
  type Feel,
  feelSwingAmount,
  GM,
  GROOVE_STYLES,
  type GrooveFeel,
  type GrooveStyle,
  ghostMoodCategory,
  mapSection,
  mapStyle,
  PUBLIC_SECTIONS,
  percMoodCategory,
  type Section,
  sectionDensityMultiplier,
  sectionEnergy,
} from './internal.js';
import { getKickPattern, isInPreChorusLift, type KickPattern } from './kick.js';
import { generateAuxPercussionForBar, getPercussionConfig } from './percussion.js';

export type { FillArchetype, FillStroke, FillType, FillVelocity } from './fills.js';
export { FILL_ARCHETYPES, FILL_TYPES, isFillArchetype } from './fills.js';
/**
 * A single drum onset emitted by {@link generateDrums}.
 *
 * @category Composition
 */
export type { DrumHit, DrumVoice } from './hit.js';
export { DRUM_NOTES, drumVoiceOf } from './hit.js';
/**
 * Groove feel (the swing/straight rhythmic character) for {@link generateDrums}
 * and {@link placeDrumPattern}.
 *
 * @category Composition
 */
/**
 * Drum voicing role and groove style identifiers for {@link generateDrums}.
 *
 * @category Composition
 */
export type { DrumRole, DrumStyle, GrooveFeel, GrooveStyle, Section } from './internal.js';
export type { KickFigure, KickPattern, KickSlot } from './kick.js';
export { KICK_FIGURES, KICK_STEPS } from './kick.js';
export { DRUM_KIT } from './kit.js';
export type {
  DrumPattern,
  DrumPatternOptions,
  DrumStroke,
  DrumVocabulary,
} from './vocabulary.js';
export { DRUM_PATTERNS, isDrumPattern, placeDrumPattern } from './vocabulary.js';

/**
 * A Euclidean (Bjorklund) kick pattern for {@link generateDrums}.
 *
 * @category Composition
 */
export type EuclideanKick = {
  /** Number of kick onsets, clamped to `[0, steps]`. */
  pulses: number;
  /**
   * Total steps in the bar (1..16).
   *
   * @defaultValue 16
   */
  steps?: number;
  /**
   * Steps to rotate the onsets toward later positions.
   *
   * @defaultValue 0
   */
  rotation?: number;
};

/**
 * Options controlling {@link generateDrums}.
 *
 * @category Composition
 */
export type DrumsOptions = {
  /**
   * Number of bars to generate.
   */
  bars: number;
  style: GrooveStyle;
  section: Section;
  /**
   * Time signature.
   *
   * Only 4/4 is accepted: every shape this generator writes — the backbeat, the
   * hi-hat subdivisions, the open-hat and crash beats, the beat a fill starts on
   * — is written against a four-beat bar, so another meter would come back with
   * 4/4 accents in a bar of the wrong length and no sign that anything was
   * wrong. A meter it cannot place is refused rather than mis-placed. Use
   * {@link generateRhythm} or {@link placeDrumPattern} for other meters.
   *
   * @defaultValue `{ numerator: 4, denominator: 4 }`
   */
  ts?: MeterLike;
  /**
   * Replace the final bar with a fill.
   *
   * A pre-chorus leading into a chorus builds instead: the two-bar lift takes
   * precedence over the fill, since the buildup already marks the phrase end.
   * Set `nextSection` to anything but `'chorus'` to get the fill.
   *
   * @defaultValue false
   */
  fills?: boolean;
  /**
   * The swing the groove is played with. Naming one is taken at its word by
   * every style, including the ones whose own character is straight: a feel the
   * caller asked for and did not get is worse than one it has to ask for twice.
   * Left out, the style's own feel applies.
   */
  feel?: GrooveFeel;
  /**
   * Voicing role, from busiest to sparsest:
   *
   * - `'full'`: every voice, backbeat snare at full weight.
   * - `'ambient'`: side-stick backbeat, ride instead of hi-hat.
   * - `'minimal'`: side-stick backbeat quieter still, pedal hi-hat, no
   *   auxiliary percussion.
   * - `'fxOnly'`: no kick, snare, ghost notes, timekeeping hi-hat, or fills —
   *   only the fx and auxiliary voices.
   *
   * Roles express orchestration priority and peak dynamics, not a strict hit
   * count: style-specific ride, foot-hi-hat, and auxiliary patterns may make a
   * sparser role emit more individual onsets in a particular bar.
   *
   * @defaultValue `'full'`
   */
  role?: DrumRole;
  /**
   * The generation context: the tempo, the complexity dials, and the kit this
   * part is written for.
   *
   * `bpm` is the tempo in quarter-note beats per minute. `complexity.rhythmic`
   * is how busy the backing is, in [0, 1]; the dial is continuous, so every
   * value moves the result and raising it only adds onsets — the ones already
   * sounding stay where they were. `complexity.ornament` sets how many ghost
   * notes survive, `complexity.difficulty` caps how fast the generator writes,
   * `instruments.drums` — a percussion profile — restricts the output to voices
   * that kit actually has, and `seed` fixes every deterministic choice.
   *
   * @defaultValue `{ seed: 0, bpm: 120, complexity: { rhythmic: 0.5 } }`
   */
  ctx?: GenerationContextInput;
  /**
   * Section the final-bar fill leads into. Shapes which fill archetype is
   * chosen (into-chorus and out-of-intro fills differ from generic ones).
   * Defaults to `section`, i.e. a within-section fill.
   */
  nextSection?: Section;
  /**
   * When set, the kick follows this Euclidean rhythm instead of the
   * style/section pattern, giving direct access to evenly spread onsets.
   */
  euclideanKick?: EuclideanKick;
  /**
   * Maximum number of onsets {@link generateDrums} may write. Generation is
   * linear in bar count, so this is the guard against an unbounded caller
   * rather than a limit on any search.
   *
   * @defaultValue 1000000
   */
  budget?: number;
};

/** Generous upper bound on onsets emitted for a single bar, used for budgeting. */
const MAX_HITS_PER_BAR = 128;

/** Tempo assumed when neither the context nor the options name one. */
const DEFAULT_BPM = 120;

/**
 * Generate a drum performance as a flat list of onsets.
 *
 * Every voice (kick, snare, ghost snares, closed/open/foot hi-hats, ride, toms,
 * crash, and auxiliary percussion) is emitted as a {@link DrumHit} distinguished
 * by its General MIDI pitch. Groove style selects an internal style and feel;
 * `complexity.rhythmic` sets the backing-density level; `section` shapes kick,
 * hi-hat, ghost, and percussion density. 16th-note hi-hats drop to 8ths at or
 * above 150 BPM. When `fills` is true the final bar is replaced with a fill whose
 * archetype is shaped by `nextSection`; a fill that would emit nothing on its
 * beat falls back to the normal groove so the phrase end is never silent.
 * `euclideanKick` overrides the kick with an evenly-spread Euclidean pattern.
 * Output is fully determined by the options plus the context's seed.
 *
 * The patterns are 4/4 only — backbeats, hi-hat subdivisions, and fills are all
 * written against a four-beat bar — so beat positions are quarter notes and bar
 * `n` starts at beat `4n`.
 *
 * @param opts Generation options.
 * @returns Percussion onsets in onset order, ties broken by pitch.
 *
 * @example
 * ```ts
 * import { generateDrums } from '@libraz/libcantus';
 * const hits = generateDrums({
 *   bars: 4,
 *   style: 'standard',
 *   section: 'chorus',
 *   fills: true,
 *   ctx: { seed: 0, bpm: 120, complexity: { rhythmic: 0.6 } },
 * });
 * // Fully determined by the options plus the context's seed (defaults to 0).
 * ```
 *
 * @category Composition
 */
export function generateDrums(opts: DrumsOptions): DrumHit[] {
  assertPositiveInt(opts.bars, 'drum bars');
  // Generation is linear in bar count — every lookup inside the bar loop is
  // indexed — so the estimate is the hit count itself.
  assertGenerationBudget(opts.bars * MAX_HITS_PER_BAR, 'drum hits', opts.budget);
  if (opts.euclideanKick) {
    const steps = opts.euclideanKick.steps ?? 16;
    assertInteger(steps, 'euclidean steps', 1, 16);
    assertInteger(opts.euclideanKick.pulses, 'euclidean pulses');
    assertInteger(opts.euclideanKick.rotation ?? 0, 'euclidean rotation');
  }
  // The string options are checked at runtime as well as at compile time: a
  // name from a config file or a JavaScript caller would otherwise be read
  // against a table with no entry for it and yield NaN velocities.
  const publicStyle = assertOneOf(opts.style, GROOVE_STYLES, 'drum style');
  const publicSection = assertOneOf(opts.section, PUBLIC_SECTIONS, 'drum section');
  if (opts.nextSection !== undefined) {
    assertOneOf(opts.nextSection, PUBLIC_SECTIONS, 'drum nextSection');
  }
  const track = new HitList();
  const resolved = resolveContext(opts.ctx);
  const draw = resolved.part('drums');
  const bpm = resolved.bpm ?? DEFAULT_BPM;
  const rhythmic = resolved.rhythmic ?? DEFAULT_RHYTHMIC;
  // Ghosts follow the ornament dial; with none named the rhythmic dial stands
  // in, so a caller who only ever moves `density` still gets one knob.
  const ornamentDial = resolved.ornament ?? rhythmic;
  const difficulty = resolved.difficulty;
  const mapping = mapStyle(publicStyle);
  const style = mapping.style;
  const feel: Feel =
    opts.feel === undefined ? mapping.feel : assertOneOf(opts.feel, DRUM_FEELS, 'drum feel');
  const role: DrumRole =
    opts.role === undefined ? 'full' : assertOneOf(opts.role, DRUM_ROLES, 'drum role');
  const ts = meterAt(0, toMeterData(opts.ts ?? { numerator: 4, denominator: 4 }, 'ts'));
  // The groove is written against a four-beat bar throughout. Accepting another
  // meter placed 4/4 accents inside a bar of a different length and reported
  // nothing, which is the one outcome a caller cannot detect.
  if (ts.numerator !== 4 || ts.denominator !== 4) {
    throw new InvalidInputError(
      `drum time signature must be 4/4; received ${ts.numerator}/${ts.denominator}`,
    );
  }
  const barBeats = beatsPerBar(ts);
  // fxOnly leaves only fx/aux voices: the main kick, snare, ghost, and fill
  // voices are suppressed just as timekeeping hi-hats already are.
  const playMainVoices = role !== 'fxOnly';
  const section = mapSection(publicSection);
  const swingAmount = feelSwingAmount(feel);
  const densityMult = sectionDensityMultiplier(section) * backingScale(rhythmic);

  const sec: SectionCtx = {
    style,
    feel,
    feelRequested: opts.feel !== undefined,
    densityMult,
    rhythmic,
    ornament: ornamentDial,
    difficulty,
    // Ghost notes decorate a backbeat played on the snare head. A latin groove
    // states its backbeat as a rim-click clave, so the snare drum is not the
    // voice being decorated and ghosts would answer a stroke that is not there.
    useGhostNotes:
      (section === 'b' || section === 'chorus' || section === 'bridge') &&
      style !== 'sparse' &&
      style !== 'latin',
    ghostBoost: mapping.ghostBoost,
    useRide: shouldUseRideForSection(section, style),
    useFootHh: shouldUseFootHiHat(section, role),
    role,
    ghostMood: ghostMoodCategory(style),
    snareBeat3: mapping.snareBeat3,
  };

  const ohhBarInterval = openHiHatBarInterval(section, style);
  const energy = sectionEnergy(section);
  const fillStartBeat = getFillStartBeat(energy);
  const fillVelocity = calculateVelocity(section, fillStartBeat);
  const percMood = percMoodCategory(style);

  // The final-bar fill is shaped by the section it leads into. When no next
  // section is given the fill is treated as within-section (from === to).
  const nextSection = opts.nextSection ? mapSection(opts.nextSection) : section;
  const nextEnergy = sectionEnergy(nextSection);

  // Fills a caller brought for this piece. They are filtered by the conditions
  // they state — section, tempo, and the difficulty ceiling — and then offered
  // after the built-in table, so the built-in choices keep the draws they had.
  const callerFillEntries = selectVocabulary(
    vocabularyOfKind(resolved.vocabulary, isFillArchetype),
    { section: publicSection, bpm, difficulty },
  );
  const callerFills = new Map(callerFillEntries.map((entry) => [entry.id, entry.material]));
  const callerFillIds = callerFillEntries.map((entry) => entry.id);

  const euclidSteps = opts.euclideanKick?.steps ?? 16;
  const euclidKick = opts.euclideanKick
    ? euclideanRhythm(opts.euclideanKick.pulses, euclidSteps, opts.euclideanKick.rotation ?? 0)
    : undefined;

  const reuseSectionKick = (section === 'b' || section === 'chorus') && style !== 'sparse';
  let sectionKick: KickPattern | undefined;

  /** Onsets written from a pattern the caller named, which the ceiling spares. */
  const exemptOnsets = new Set<string>();

  for (let bar = 0; bar < opts.bars; bar += 1) {
    const barStart = bar * barBeats;
    const isLastBar = bar === opts.bars - 1;
    const hhLevel = getHiHatLevel(section, style, rhythmic, bpm, draw, difficulty, bar);

    if (bar === 0 && section === 'chorus') {
      track.add(GM.CRASH, barStart, 0.5, 100 * densityMult);
    }

    let barHasOpenHh = false;
    let openHhBeatIndex = 3;
    if (ohhBarInterval > 0 && bar % ohhBarInterval === ohhBarInterval - 1) {
      openHhBeatIndex = openHiHatBeat(section, draw, bar);
      barHasOpenHh = !track.hasCrashNear(barStart + openHhBeatIndex);
    }

    let kick: KickPattern | undefined;
    if (!euclidKick && reuseSectionKick) {
      sectionKick ??= getKickPattern(section, style, 0, draw, rhythmic);
      kick = sectionKick;
    } else if (!euclidKick) {
      kick = getKickPattern(section, style, bar, draw, rhythmic);
    }

    // The lift is a build into a chorus, so what follows decides it. Passing
    // `section === 'b'` made the predicate test the section against itself,
    // which is always true inside a pre-chorus: the lift then fired whatever
    // `nextSection` said, and suppressed the fill the caller asked for.
    const inLift = isInPreChorusLift(section, bar, opts.bars, nextSection === 'chorus');
    let currentFill: FillArchetype | undefined = FILL_ARCHETYPES.snareRoll;

    for (let beat = 0; beat < barBeats; beat += 1) {
      const beatTick = barStart + beat;
      const velocity = calculateVelocity(section, beat);

      if (opts.fills && isLastBar && !inLift && beat >= fillStartBeat) {
        if (beat === fillStartBeat) {
          // The ceiling applies to the phrase end as it does to the groove: an
          // archetype whose strokes run faster than a player at this ceiling
          // sustains is taken out of the table, and the draw runs over the rest.
          const chosen = selectFillType(
            section,
            nextSection,
            style,
            nextEnergy,
            draw,
            bar,
            callerFillIds,
            (id) => {
              const candidate = fillArchetypeFor(id, callerFills);
              return (
                candidate !== undefined &&
                fillWithinCeiling(candidate, fillStartBeat, barBeats, bpm, difficulty)
              );
            },
          );
          currentFill = chosen === undefined ? undefined : fillArchetypeFor(chosen, callerFills);
        }
        if (playMainVoices) {
          const before = track.hits.length;
          if (currentFill) {
            // One base velocity for the whole fill, read at the beat it starts
            // on: a crescendo written across two beats is one gesture, and
            // rereading the beat velocity partway through drops it.
            generateFill(track, beatTick, beat, currentFill, fillVelocity);
          }
          if (track.hits.length > before) {
            continue;
          }
          // Safety net: an archetype that contributes nothing on this beat would
          // leave a silent phrase end, so fall through to the normal groove.
        } else {
          // fxOnly deliberately emits no main voices on the fill beats.
          continue;
        }
      }

      const ctx: BeatCtx = {
        track,
        beatTick,
        beat,
        velocity,
        section,
        bpm,
        bar,
        sectionBars: opts.bars,
        inPrechorusLift: inLift,
        swingAmount,
        barHasOpenHh,
        openHhBeat: openHhBeatIndex,
        hhLevel,
        draw,
      };

      if (playMainVoices) {
        if (inLift) {
          generatePreChorusBuildup(ctx, sec, isLastBar);
        }
        if (euclidKick && !inLift) {
          const stepLength = barBeats / euclidSteps;
          for (let step = 0; step < euclidKick.length; step += 1) {
            const onset = step * stepLength;
            if (euclidKick[step] && Math.floor(onset) === beat) {
              const wholeBeat = Math.abs(onset - Math.round(onset)) < 1e-9;
              const tick = swing16(barStart + onset, sec, swingAmount);
              // Naming the pattern is the request that it be written as given,
              // so these strokes are the ones the ceiling does not touch.
              exemptOnsets.add(onsetKey(GM.BD, tick));
              track.add(GM.BD, tick, Math.min(0.5, stepLength), velocity * (wholeBeat ? 1 : 0.85));
            }
          }
        } else if (kick) {
          generateKickForBeat(ctx, sec, kick);
        }
        generateSnareForBeat(ctx, sec, section === 'intro' && bar === 0);
        if (sec.useGhostNotes && !inLift) {
          generateGhostNotesForBeat(ctx, sec);
        }
      }
      generateHiHatForBeat(ctx, sec);
    }

    if (sec.useFootHh && shouldPlayHiHat(role)) {
      for (let fhhBeat = 0; fhhBeat < barBeats; fhhBeat += 2) {
        const fhhTick = barStart + fhhBeat;
        if (!track.hasOnset(GM.FHH, fhhTick)) {
          track.add(GM.FHH, fhhTick, 0.5, footHiHatVelocity(draw, bar, fhhBeat));
        }
      }
    }

    let percussionConfig = getPercussionConfig(percMood, section);
    if (
      role === 'fxOnly' &&
      !percussionConfig.tambourine &&
      !percussionConfig.shaker &&
      !percussionConfig.handclap
    ) {
      percussionConfig = {
        tambourine: false,
        shaker: true,
        handclap: false,
        shaker16th: false,
      };
    }
    generateAuxPercussionForBar(
      track,
      barStart,
      percussionConfig,
      role,
      densityMult,
      draw,
      bpm,
      sec,
      swingAmount,
      barBeats,
    );
  }

  // Foot hi-hats and auxiliary percussion are appended after the beat loop, so
  // the accumulated list is not monotonic within a bar. A consumer writing MIDI
  // reads these in order and would emit a negative delta time.
  const endBeat = opts.bars * barBeats;
  const kit = resolved.instrument('drums');
  const written = track.hits
    .filter((hit) => hit.startBeat < endBeat && playableOn(kit, hit.pitch))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  return underCeiling(written, bpm, difficulty, exemptOnsets);
}

/**
 * Drop the strokes a player at this ceiling could not reach in time.
 *
 * The ceiling is a property of the finished part rather than of any one voice
 * that proposed a stroke: the groove, the fill, the lift and the auxiliary
 * voices each judge their own material, and the bar where a fill meets the
 * groove before it belongs to neither of them. Applying it once at the end is
 * what makes "no voice repeats faster than the ceiling sustains" true of the
 * output instead of true of each generator separately.
 *
 * The earlier of two strokes too close together is the one kept, since it is
 * the one the passage was already committed to, and strokes at the same instant
 * are left alone — two voices layered on one onset are not a stream.
 *
 * @param hits The finished part, in onset order.
 * @param bpm Tempo.
 * @param difficulty The ceiling, or undefined for no ceiling.
 * @param exempt Onset keys the ceiling does not touch.
 * @returns The strokes that survive, in the order given.
 */
function underCeiling(
  hits: readonly DrumHit[],
  bpm: number,
  difficulty: number | undefined,
  exempt: ReadonlySet<string>,
): DrumHit[] {
  if (difficulty === undefined) {
    return [...hits];
  }
  const lastOnset = new Map<number, number>();
  const kept: DrumHit[] = [];
  for (const hit of hits) {
    const previous = lastOnset.get(hit.pitch);
    const reachable =
      previous === undefined ||
      exempt.has(onsetKey(hit.pitch, hit.startBeat)) ||
      sustainsStrokes(hit.startBeat - previous, bpm, difficulty);
    if (!reachable) {
      continue;
    }
    kept.push(hit);
    lastOnset.set(hit.pitch, hit.startBeat);
  }
  return kept;
}

/**
 * Whether a kit has the voice a hit asks for.
 *
 * Naming a kit is the request that the part be playable on it, so this holds
 * whatever the difficulty ceiling says: a voice the kit does not have is not a
 * hard stroke but an absent one. Without a kit there is no such constraint, and
 * the programmed case is unchanged.
 */
function playableOn(kit: InstrumentProfile | undefined, pitch: number): boolean {
  return kit === undefined || canSound(kit, pitch);
}
