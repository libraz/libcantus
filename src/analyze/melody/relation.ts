/**
 * The transformation between two statements of a motif, named.
 *
 * Two cells stand in a relation when one is the other put through a device the
 * repertoire has a name for — repetition, transposition, inversion, retrograde,
 * augmentation — and naming it is what turns a pair of similar phrases into an
 * account of how the second was made from the first.
 */

import type { SpelledInterval } from '../../core/pitch/index.js';
import { midiToNote, pitchClassOf as pitchClass, spelledInterval } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  keySignatureFifths,
  type ResolvedKey,
  resolveKey,
  type SpelledKeyLike,
  scaleTonesInDegreeOrder,
} from '../../theory/scale/index.js';
import { BEAT_EPS, HUMANIZE_ADJACENCY } from '../adjacency.js';
import {
  endBeatOf,
  intervalsOf,
  onsetGaps,
  retrogradeGaps,
  rhythmProfile,
  roundTo,
  sameNumbers,
} from './internal.js';
import type { MotifData } from './motifs.js';

/**
 * How one statement of a motif stands to another.
 *
 * `'transposition'` is the literal one — every interval preserved, which is what
 * makes a sequence built on it a *real* sequence. `'tonalTransposition'` shifts
 * by scale degrees instead and lets the key resize the intervals, which is what
 * makes a sequence built on it a *tonal* sequence; the two are different devices
 * and are never reported as one. `'augmentation'` and `'diminution'` name the
 * relation only when the pitches are untouched, so an inversion in doubled note
 * values reads as `'inversion'` with a `timeRatio` of 2 rather than losing the
 * inversion to the stretch.
 *
 * @category Arrangement & Analysis
 */
export type MotifRelationKind =
  | 'repetition'
  | 'transposition'
  | 'tonalTransposition'
  | 'inversion'
  | 'retrograde'
  | 'retrogradeInversion'
  | 'augmentation'
  | 'diminution';
/**
 * The transformation that turns one motif into another.
 *
 * @category Arrangement & Analysis
 */
export type MotifRelation = {
  /** The named transformation. */
  kind: MotifRelationKind;
  /**
   * Whether the second statement begins where the first ends, which is what
   * separates a sequence from a restatement elsewhere in the piece: a
   * `'transposition'` that is one is a real sequence, a `'tonalTransposition'`
   * that is one is a tonal sequence.
   */
  sequence: boolean;
  /** Semitones from the first statement's first note to the second's. */
  semitones: number;
  /** The same distance named as a spelled interval. */
  interval: SpelledInterval;
  /** Scale degrees the second statement stands above the first, when tonal. */
  degrees?: number;
  /**
   * How much the second statement is stretched against the first: 2 for doubled
   * note values, 0.5 for halved, 1 for unchanged.
   *
   * Measured in the direction the relation names, so a retrograde that kept
   * every note value reports 1 however uneven those values are: it is compared
   * against the model played backwards, not against the model as written.
   */
  timeRatio: number;
  /** Why the pair was given that name. */
  rationale: string;
};
/** Whether a key writes its accidentals as flats. */
function spellingOf(key?: ResolvedKey): 'sharp' | 'flat' {
  if (key === undefined) {
    return 'sharp';
  }
  return keySignatureFifths(key.tonic, key.scale) < 0 ? 'flat' : 'sharp';
}
/** Name the distance between two pitches as a spelled interval. */
function intervalBetween(from: number, to: number, key?: ResolvedKey): SpelledInterval {
  const spelling = spellingOf(key);
  return spelledInterval(midiToNote(from, spelling), midiToNote(to, spelling));
}
/** An interval name in the grammar `parseInterval` reads, such as `-m3`. */
function intervalName(interval: SpelledInterval): string {
  return `${interval.descending && interval.semitones !== 0 ? '-' : ''}${interval.quality}${interval.number}`;
}
/**
 * Position of every note on the key's diatonic ladder, counted in scale degrees
 * from the root and continuing across octaves.
 *
 * This is what a tonal transposition moves by, and it only exists for a line
 * that stays in the key: one chromatic note and the answer is null, because a
 * degree cannot be named for a pitch the scale does not contain.
 */
function ladderIndices(notes: readonly NoteEvent[], key: KeyScale): number[] | null {
  const root = pitchClass(key.rootPc);
  const offsets = scaleTonesInDegreeOrder(key).map((pc) => pitchClass(pc - root));
  if (offsets.length === 0) {
    return null;
  }
  const out: number[] = [];
  for (const note of notes) {
    const semitones = note.pitch - root;
    const octave = Math.floor(semitones / 12);
    const degree = offsets.indexOf(semitones - octave * 12);
    if (degree < 0) {
      return null;
    }
    out.push(octave * offsets.length + degree);
  }
  return out;
}
/** Differences between consecutive ladder positions. */
function ladderSteps(indices: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < indices.length; i += 1) {
    out.push((indices[i] ?? 0) - (indices[i - 1] ?? 0));
  }
  return out;
}
/** The pitch shapes one motif can stand in to another, before timing. */
type PitchShape = 'exact' | 'inversion' | 'retrograde' | 'retrogradeInversion';
/**
 * Which pitch transformations carry `a`'s intervals onto `b`'s, simplest first.
 *
 * A pair can answer to more than one name at once — the retrograde of a cell
 * whose intervals read the same upside down is also its inversion — and the
 * pitches cannot say which name is the pair's. Only the rhythm can: an
 * inversion runs the same way round as its model and a retrograde runs
 * backwards. So every shape that holds is reported and the caller, which
 * already knows which way round the rhythm runs, picks among them; answering
 * with the simplest alone would leave a cell like that unnamed whenever its
 * rhythm rules the simplest name out.
 *
 * Only the readings that survive without a key are here. The tonal one is
 * decided by the caller of this, since it needs the scale, and a pattern that
 * is a tonal transposition and a retrograde inversion at once reaches here as
 * the second of those.
 */
function pitchShapes(a: readonly number[], b: readonly number[]): PitchShape[] {
  const shapes: PitchShape[] = [];
  if (sameNumbers(a, b)) {
    shapes.push('exact');
  }
  if (
    sameNumbers(
      b,
      a.map((step) => -step),
    )
  ) {
    shapes.push('inversion');
  }
  const reversed = [...a].reverse();
  if (
    sameNumbers(
      b,
      reversed.map((step) => -step),
    )
  ) {
    shapes.push('retrograde');
  }
  if (sameNumbers(b, reversed)) {
    shapes.push('retrogradeInversion');
  }
  return shapes;
}
/** Total distance a run of gaps covers. */
function totalGap(gaps: readonly number[]): number {
  return gaps.reduce((sum, gap) => sum + gap, 0);
}
/**
 * How far the answer's note values are stretched against the model's, measured
 * in the direction the relation names.
 *
 * A retrograde is measured against the model played backwards, whose gaps are
 * the distances between note ends. Measuring one forwards instead reports a
 * stretch for an answer that kept every note value — a search for augmentations
 * then picks up a plain retrograde of an uneven cell — because the two ways of
 * measuring coincide only when every note is the same length.
 */
function stretchRatio(modelGaps: readonly number[], answerGaps: readonly number[]): number {
  const span = totalGap(modelGaps);
  return span > BEAT_EPS ? totalGap(answerGaps) / span : 1;
}
/** Sentence naming a stretch, for the rationales that mention one. */
function stretchPhrase(ratio: number): string {
  return `note values ${roundTo(ratio, 3)}x the model's`;
}
/**
 * Name how two statements of a motif relate.
 *
 * The two are compared as shapes, not as pitches: the interval sequences say
 * which transformations could name the pair and the onset gaps say which of
 * them does, so a statement a fourth higher in doubled note values is
 * recognised for what it is, and a cell that reads as both an inversion and a
 * retrograde is named by the way its rhythm runs rather than by which name came
 * to hand first. A pair whose rhythms correspond in neither direction — the same
 * way round for a repetition or a transposition, the model played backwards for
 * a retrograde, note values and all — is not a transformation of the motif but a
 * different figure, and answers null; {@link melodicSimilarity} is what scores
 * those.
 *
 * With a `key` in hand the search also asks whether the second statement is the
 * first moved by scale degrees rather than by semitones. That is the tonal
 * answer to the real one, and the two are kept apart: a real transposition keeps
 * every interval literally, a tonal one lets the key resize them, so a subject
 * answered a step higher reads as `'transposition'` when its major second stays
 * major and as `'tonalTransposition'` when the scale turns it minor.
 *
 * @param a The model statement.
 * @param b The statement to name against it.
 * @param key Key context for the tonal reading. Without one that reading is
 *   unavailable, and a statement holding only diatonically is left unnamed
 *   unless its interval pattern also fits a member of the retrograde family, in
 *   which case it is named there: a triad restated a degree higher swaps two
 *   adjacent interval sizes, which is what a retrograde inversion does to it as
 *   well, and equal note values read the same way round in both directions, so
 *   the notes alone cannot separate the two. A key separates them.
 * @returns The relation, or null when the two stand in none.
 * @example
 * ```ts
 * import { majorKey, motifFromNotes, relateMotifs } from '@libraz/libcantus';
 * const model = motifFromNotes([
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 62, startBeat: 1, durationBeat: 1 },
 *   { pitch: 64, startBeat: 2, durationBeat: 1 },
 * ]);
 * const answer = motifFromNotes([
 *   { pitch: 62, startBeat: 3, durationBeat: 1 },
 *   { pitch: 64, startBeat: 4, durationBeat: 1 },
 *   { pitch: 65, startBeat: 5, durationBeat: 1 },
 * ]);
 * relateMotifs(model, answer, majorKey(0))?.kind; // 'tonalTransposition'
 * ```
 * @category Arrangement & Analysis
 */
export function relateMotifs(
  a: MotifData,
  b: MotifData,
  keyLike?: SpelledKeyLike,
): MotifRelation | null {
  // Read whole, so the interval names a motif relation is reported under follow
  // the key the caller named rather than the side its pitch classes read best as.
  const key = keyLike === undefined ? undefined : resolveKey(keyLike);
  const model = a.notes;
  const answer = b.notes;
  if (model.length === 0 || model.length !== answer.length) {
    return null;
  }
  const modelGaps = onsetGaps(model);
  const answerGaps = onsetGaps(answer);
  const modelProfile = rhythmProfile(modelGaps);
  const answerProfile = rhythmProfile(answerGaps);
  // The rhythm the model would have if it were played backwards, which is what
  // a retrograde has to match — note values kept, their order reversed.
  const retroGaps = retrogradeGaps(model);
  const retroProfile = rhythmProfile(retroGaps);
  if (modelProfile === null || answerProfile === null) {
    return null;
  }
  const forward = sameNumbers(modelProfile, answerProfile);
  const backward = retroProfile !== null && sameNumbers(retroProfile, answerProfile);
  const semitones = (answer[0]?.pitch ?? 0) - (model[0]?.pitch ?? 0);
  const interval = intervalBetween(model[0]?.pitch ?? 0, answer[0]?.pitch ?? 0, key);
  const gap = (answer[0]?.startBeat ?? 0) - endBeatOf(model);
  // A sequence follows its model immediately; anything further off is a
  // restatement somewhere else in the piece. Immediately is what the adjacency
  // test already means by it, so a statement that starts a hair early counts.
  const sequence = gap >= -HUMANIZE_ADJACENCY && gap <= HUMANIZE_ADJACENCY;
  const timeRatio = stretchRatio(modelGaps, answerGaps);
  const stretched = Math.abs(timeRatio - 1) > BEAT_EPS;
  const shapes = pitchShapes(intervalsOf(model), intervalsOf(answer));
  const base = { sequence, semitones, interval, timeRatio };
  // A relation of the retrograde family is a stretch of the model played
  // backwards, so that is what its own ratio is measured against.
  const backwardBase = { ...base, timeRatio: stretchRatio(retroGaps, answerGaps) };

  if (forward && shapes.includes('exact')) {
    if (semitones === 0) {
      if (!stretched) {
        return {
          ...base,
          kind: 'repetition',
          rationale: 'Exact repetition: the same pitches in the same rhythm',
        };
      }
      const augmented = timeRatio > 1;
      return {
        ...base,
        kind: augmented ? 'augmentation' : 'diminution',
        rationale: `${augmented ? 'Augmentation' : 'Diminution'}: the same pitches in ${stretchPhrase(timeRatio)}`,
      };
    }
    const name = intervalName(interval);
    return {
      ...base,
      kind: 'transposition',
      rationale: sequence
        ? `Real sequence: the cell restated ${name} away with every interval kept literally` +
          (stretched ? `, in ${stretchPhrase(timeRatio)}` : '')
        : `Transposition by ${name}: every interval kept literally` +
          (stretched ? `, in ${stretchPhrase(timeRatio)}` : ''),
    };
  }

  if (forward && key !== undefined) {
    const modelLadder = ladderIndices(model, key.scale);
    const answerLadder = ladderIndices(answer, key.scale);
    if (modelLadder !== null && answerLadder !== null) {
      const degrees = (answerLadder[0] ?? 0) - (modelLadder[0] ?? 0);
      if (degrees !== 0 && sameNumbers(ladderSteps(modelLadder), ladderSteps(answerLadder))) {
        const direction = degrees > 0 ? 'higher' : 'lower';
        const count = Math.abs(degrees);
        return {
          ...base,
          kind: 'tonalTransposition',
          degrees,
          rationale:
            `${sequence ? 'Tonal sequence' : 'Tonal transposition'}: the cell restated ` +
            `${count} scale ${count === 1 ? 'degree' : 'degrees'} ${direction} inside the key, ` +
            `so the key resizes its intervals — a real one would have kept them literal`,
        };
      }
    }
  }

  if (forward && shapes.includes('inversion')) {
    return {
      ...base,
      kind: 'inversion',
      rationale:
        'Inversion: every interval turned upside down about the first note' +
        (stretched ? `, in ${stretchPhrase(timeRatio)}` : ''),
    };
  }
  if (backward && shapes.includes('retrograde')) {
    return {
      ...backwardBase,
      kind: 'retrograde',
      rationale: 'Retrograde: the cell read back to front, rhythm included',
    };
  }
  if (backward && shapes.includes('retrogradeInversion')) {
    return {
      ...backwardBase,
      kind: 'retrogradeInversion',
      rationale: 'Retrograde inversion: the cell read back to front and turned upside down',
    };
  }
  return null;
}
