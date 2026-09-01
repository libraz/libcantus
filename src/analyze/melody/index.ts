/**
 * Melody as a shape, rather than as a run of notes.
 *
 * A motif is held here as an interval contour plus a rhythmic profile, which is
 * what makes a restatement at another pitch level the same motif; the absolute
 * pitches only ever describe one statement of it. On that footing two statements
 * can be compared and the transformation between them named — repetition,
 * transposition, inversion, retrograde, augmentation — and phrases that stand in
 * no such relation can still be scored for similarity.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { SpelledInterval } from '../../core/pitch/index.js';
import { midiToNote, pitchClassOf as pitchClass, spelledInterval } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertInteger,
  assertNoteEvents,
} from '../../core/validation/index.js';
import {
  type KeyLike,
  keySignatureFifths,
  type ResolvedKey,
  resolveKey,
  scaleTonesInDegreeOrder,
} from '../../theory/scale/index.js';

/** Tolerance for beat, ratio, and interval comparisons. */
const EPS = 1e-9;

/**
 * Grid the rhythmic profile is compared on, as a divisor of the cell's first
 * onset gap.
 *
 * Two statements of a motif have to agree on their rhythm exactly, and floating
 * beat arithmetic does not: 1/3 of a beat written two different ways differs in
 * the last bits. Rounding the ratios onto a grid this fine keeps a dotted figure
 * distinct from an even one while absorbing that error. Onsets are still
 * expected to be quantised — a humanized MIDI take should be quantised before it
 * is searched for motifs.
 */
const RHYTHM_GRID = 64;

/**
 * Shortest cell the search reports, in notes.
 *
 * Two notes carry a single interval, and a lone rising fourth recurs in almost
 * any melody without naming anything. Three notes are the shortest cell with a
 * shape: two intervals, so it can turn.
 */
const MIN_CELL_NOTES = 3;

/**
 * Longest cell the search reports, in notes.
 *
 * Eight notes span two bars of eighths, or four bars of quarters. Recurring
 * material longer than that is a phrase rather than a motif and wants a
 * phrase-level reading; the bound also keeps the number of windows examined
 * linear in the length of the melody.
 */
const MAX_CELL_NOTES = 8;

/**
 * How many statements make a cell a motif.
 *
 * A motif is by definition restated, so two is the floor. Raising it is how a
 * caller asks for only the material the piece is actually built from.
 */
const MIN_OCCURRENCES = 2;

/**
 * Largest gap, in beats, between one statement ending and the next beginning for
 * the pair to be heard as a sequence.
 *
 * A sequence follows its model immediately; anything further off is a
 * restatement somewhere else in the piece. The tolerance is the same order as
 * the timing slack a MIDI take carries, so a statement that starts a hair early
 * still counts.
 */
const SEQUENCE_GAP = 0.05;

/**
 * Interval difference, in semitones, at which two steps count as wholly
 * different in {@link melodicSimilarity}.
 *
 * A third answered by a fourth is nearly the same gesture; a third answered by a
 * minor seventh is not. The tritone is where the graded cost saturates, so
 * anything wider than half an octave apart costs the same as an outright
 * mismatch.
 */
const INTERVAL_TOLERANCE = 6;

/** Share of {@link melodicSimilarity} carried by the interval sequence. */
const PITCH_WEIGHT = 0.75;

/** Share of {@link melodicSimilarity} carried by the rhythmic profile. */
const RHYTHM_WEIGHT = 0.25;

/**
 * Share of a line's total motion that has to run one way before the line is
 * called ascending, descending, or an arch.
 *
 * A melody that climbs an octave with one dip on the way is heard as ascending,
 * so the classification is a dominance test rather than a strict-monotonicity
 * one. Below this share the line is reported as a wave, which is the honest
 * answer for something that changes direction repeatedly.
 */
const DIRECTIONAL_SHARE = 0.75;

/**
 * Step direction between two consecutive notes.
 *
 * @category Arrangement & Analysis
 */
export type ContourDirection = 'up' | 'down' | 'same';

/**
 * The overall shape of a line.
 *
 * The first four names are the vocabulary the motif generator's contours are
 * written in, and mean the same here. `'static'` is the shape a generator never
 * asks for and an analysis regularly meets: a line that does not move. A line
 * that dips and comes back — an arch upside down — reads as `'wave'`, since the
 * shared vocabulary has no name of its own for it.
 *
 * A wave has to turn more than once to be heard as one, so a cell the generator
 * writes for `'wave'` reads back as `'wave'` only from three bars up; the one-
 * and two-bar cells turn once and read as `'arch'`. The other three shapes come
 * back under their own name at every length.
 *
 * @category Arrangement & Analysis
 */
export type MelodicContourShape = 'arch' | 'ascending' | 'descending' | 'wave' | 'static';

/**
 * The abstract shape of a line: its step directions and what they add up to.
 *
 * @category Arrangement & Analysis
 */
export type MelodicContour = {
  /** One direction per adjacent pair of notes, in time order. */
  directions: ContourDirection[];
  /** What the directions add up to. */
  shape: MelodicContourShape;
  /** Index of the highest note; ties keep the earliest, and -1 for a line with no notes. */
  peakIndex: number;
  /** Index of the lowest note; ties keep the earliest, and -1 for a line with no notes. */
  troughIndex: number;
  /** Semitone distance from the lowest note to the highest. */
  range: number;
  /** Why the line was given that shape. */
  rationale: string;
};

/**
 * One statement of a motif, addressed in the melody it was found in.
 *
 * The notes themselves are not repeated here: a statement is the motif's notes
 * moved by `transpose` and stretched by `timeRatio`, and `noteIndex` addresses
 * the original array for a caller that wants them exactly.
 *
 * @category Arrangement & Analysis
 */
export type MotifOccurrence = {
  /**
   * Index of the statement's first note among the sounding notes of the melody,
   * in time order. Notes that never sound are dropped before the search, so this
   * is not an index into the caller's array unless the caller's array has none.
   */
  noteIndex: number;
  /** Onset of the statement's first note. */
  startBeat: number;
  /** End of the statement's last note, exclusive. */
  endBeat: number;
  /** Semitones this statement stands above the motif's first statement. */
  transpose: number;
  /**
   * How much this statement is stretched against the motif's first: 2 for a
   * statement in doubled note values, 0.5 for one in halved values, 1 for one in
   * the same values.
   */
  timeRatio: number;
};

/**
 * A recurring melodic cell.
 *
 * Identity is the interval sequence plus the rhythmic profile, so every
 * statement of the motif carries the same `intervals` and `rhythm` however far
 * it has been transposed or however wide its note values are written. `notes`
 * holds one statement — the first — exactly as it sounds.
 *
 * @category Arrangement & Analysis
 */
export type MotifData = {
  /** The first statement, exactly as it sounds in the melody. */
  notes: NoteEvent[];
  /**
   * Semitones between consecutive notes. This is the transposition-invariant
   * identity of the cell: two statements a fifth apart share it.
   */
  intervals: number[];
  /**
   * Onset-to-onset gaps as multiples of the first gap, so an even cell reads
   * `[1, 1, 1]` whatever the tempo or note values it is written in.
   */
  rhythm: number[];
  /** Every statement found, in time order; the first is `notes`. */
  occurrences: MotifOccurrence[];
  /** Why this counts as a motif. */
  rationale: string;
};

/**
 * Options controlling {@link extractMotifs}.
 *
 * @category Arrangement & Analysis
 */
export type ExtractMotifsOptions = {
  /**
   * Shortest cell to report, in notes.
   *
   * @defaultValue 3
   */
  minNotes?: number;
  /**
   * Longest cell to report, in notes.
   *
   * @defaultValue 8
   */
  maxNotes?: number;
  /**
   * How many statements a cell needs before it is reported.
   *
   * @defaultValue 2
   */
  minOccurrences?: number;
  /**
   * Upper bound on the work this call may do.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

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

/**
 * Anything that can be read as a melodic line: a motif, or plain note events.
 *
 * @category Arrangement & Analysis
 */
export type MelodicPhrase = MotifData | readonly NoteEvent[];

/**
 * How alike two lines are, and how the answer was reached.
 *
 * @category Arrangement & Analysis
 */
export type MelodicComparison = {
  /** Overall likeness in [0, 1]; 1 for the same line, transposition included. */
  similarity: number;
  /** Likeness of the interval sequences alone, in [0, 1]. */
  pitchSimilarity: number;
  /** Likeness of the rhythmic profiles alone, in [0, 1]. */
  rhythmSimilarity: number;
  /** Why the lines scored what they did. */
  rationale: string;
};

/** The notes of anything that can be read as a line. */
function phraseNotes(phrase: MelodicPhrase): readonly NoteEvent[] {
  return 'notes' in phrase ? phrase.notes : phrase;
}

/**
 * The sounding notes of a melody in time order, one note per onset.
 *
 * The line is expected to be monophonic, as {@link analyzeVoice} expects one.
 * Notes struck together are one event all the same, and the highest of them
 * stands for it — the voice a listener follows through a chord. Keeping them
 * all would let a chord read as a line: a triad and the note after it would
 * measure three rising steps of melodic motion the music never made, and would
 * be reported as an ascending line with every bit as much confidence as a real
 * one.
 */
function orderedNotes(
  notes: readonly NoteEvent[],
  name: string,
  budget?: number,
): readonly NoteEvent[] {
  assertNoteEvents(notes, name, { allowNonPositiveDuration: true, budget });
  const sounding = notes
    .filter((note) => note.durationBeat > 0)
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  const line: NoteEvent[] = [];
  for (const note of sounding) {
    const previous = line[line.length - 1];
    // Sorted low to high within an onset, so the last note to arrive at one is
    // its top voice.
    if (previous !== undefined && Math.abs(note.startBeat - previous.startBeat) <= EPS) {
      line[line.length - 1] = note;
      continue;
    }
    line.push(note);
  }
  return line;
}

/** Semitones between consecutive notes. */
function intervalsOf(notes: readonly NoteEvent[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < notes.length; i += 1) {
    out.push((notes[i]?.pitch ?? 0) - (notes[i - 1]?.pitch ?? 0));
  }
  return out;
}

/** Onset-to-onset gaps between consecutive notes. */
function onsetGaps(notes: readonly NoteEvent[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < notes.length; i += 1) {
    out.push((notes[i]?.startBeat ?? 0) - (notes[i - 1]?.startBeat ?? 0));
  }
  return out;
}

/**
 * The onset gaps a line read back to front would have.
 *
 * Playing a cell backwards keeps each note as long as it was, so the gap that
 * opens before a note in the retrograde is the gap that followed it in the
 * model — the distance between the two notes' ends, not between their onsets.
 * The two coincide only when every note is the same length, which is why the
 * onset gaps reversed cannot stand in for this.
 */
function retrogradeGaps(notes: readonly NoteEvent[]): number[] {
  const out: number[] = [];
  for (let i = notes.length - 1; i >= 1; i -= 1) {
    const later = notes[i];
    const earlier = notes[i - 1];
    out.push(
      (later?.startBeat ?? 0) +
        (later?.durationBeat ?? 0) -
        ((earlier?.startBeat ?? 0) + (earlier?.durationBeat ?? 0)),
    );
  }
  return out;
}

/**
 * Onset gaps as multiples of the first gap, rounded onto the comparison grid.
 *
 * Gaps rather than durations, because how long a note is held is a matter of
 * articulation — the same figure played staccato and legato is the same figure —
 * while where the next note falls is the rhythm itself. Normalising by the first
 * gap is what lets a statement in doubled note values match the motif it doubles;
 * the stretch is reported separately as a time ratio.
 *
 * A cell whose first gap is not positive has no profile to normalise by, and
 * answers null.
 */
function rhythmProfile(gaps: readonly number[]): number[] | null {
  const unit = gaps[0] ?? 0;
  if (!(unit > EPS)) {
    return gaps.length === 0 ? [] : null;
  }
  return gaps.map((gap) => Math.round((gap / unit) * RHYTHM_GRID) / RHYTHM_GRID);
}

/** Compare two numeric sequences elementwise. */
function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > EPS) {
      return false;
    }
  }
  return true;
}

/** Round for display, so a rationale never carries floating-point noise. */
function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Beat of the last note's end. */
function endBeatOf(notes: readonly NoteEvent[]): number {
  let end = 0;
  for (const note of notes) {
    end = Math.max(end, note.startBeat + note.durationBeat);
  }
  return end;
}

/** Distance from the first onset to the last, which is what a stretch scales. */
function onsetSpan(notes: readonly NoteEvent[]): number {
  if (notes.length < 2) {
    return 0;
  }
  return (notes[notes.length - 1]?.startBeat ?? 0) - (notes[0]?.startBeat ?? 0);
}

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

/**
 * The identity of one window: its intervals and its rhythmic profile.
 *
 * Two windows sharing this string are the same cell, wherever they sit and
 * whatever pitch level they sit at. A window with no usable rhythmic profile has
 * no identity and answers null.
 */
function windowSignature(notes: readonly NoteEvent[]): string | null {
  const profile = rhythmProfile(onsetGaps(notes));
  if (profile === null) {
    return null;
  }
  return `${notes.length}|${intervalsOf(notes).join(',')}|${profile.join(',')}`;
}

/** A group of identical windows, before it is decided whether it is a motif. */
type WindowGroup = {
  signature: string;
  length: number;
  /** Index of the first note of each window, ascending. */
  starts: number[];
};

/**
 * Keep the statements that do not overlap, earliest first.
 *
 * A cell of even notes matches itself one note along, so the raw matches of a
 * repetitive figure overlap heavily; counting those as separate statements would
 * report a motif as recurring far more often than it is heard to.
 */
function nonOverlapping(starts: readonly number[], length: number): number[] {
  const picked: number[] = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const start of starts) {
    if (start > lastEnd) {
      picked.push(start);
      lastEnd = start + length - 1;
    }
  }
  return picked;
}

/** Whether every statement of `inner` sits inside one statement of `outer`. */
function subsumes(
  outer: { starts: number[]; length: number },
  inner: { starts: number[]; length: number },
): boolean {
  return inner.starts.every((start) =>
    outer.starts.some((from) => start >= from && start + inner.length <= from + outer.length),
  );
}

/** List the statement onsets for a rationale without letting it run away. */
function listBeats(occurrences: readonly MotifOccurrence[]): string {
  const shown = occurrences.slice(0, 5).map((occurrence) => roundTo(occurrence.startBeat, 3));
  return occurrences.length > shown.length
    ? `${shown.join(', ')}, and ${occurrences.length - shown.length} more`
    : shown.join(', ');
}

/** Build the motif a group of identical windows stands for. */
function motifFromGroup(group: WindowGroup, notes: readonly NoteEvent[]): MotifData {
  const first = group.starts[0] ?? 0;
  const prime = notes.slice(first, first + group.length).map((note) => ({ ...note }));
  const primePitch = prime[0]?.pitch ?? 0;
  const primeSpan = onsetSpan(prime);
  const occurrences: MotifOccurrence[] = group.starts.map((start) => {
    const statement = notes.slice(start, start + group.length);
    const span = onsetSpan(statement);
    return {
      noteIndex: start,
      startBeat: statement[0]?.startBeat ?? 0,
      endBeat: endBeatOf(statement),
      transpose: (statement[0]?.pitch ?? 0) - primePitch,
      timeRatio: primeSpan > EPS ? span / primeSpan : 1,
    };
  });
  const shape = melodicContour(prime).shape;
  const transposed = occurrences.some((occurrence) => occurrence.transpose !== 0);
  const stretched = occurrences.some((occurrence) => Math.abs(occurrence.timeRatio - 1) > EPS);
  const detail = [
    transposed ? 'at more than one pitch level' : 'at the same pitch level',
    stretched ? 'and in more than one set of note values' : '',
  ]
    .filter((part) => part !== '')
    .join(' ');
  return {
    notes: prime,
    intervals: intervalsOf(prime),
    rhythm: rhythmProfile(onsetGaps(prime)) ?? [],
    occurrences,
    rationale:
      `${group.length}-note ${shape} cell stated ${occurrences.length} ` +
      `${occurrences.length === 1 ? 'time' : 'times'} (beats ${listBeats(occurrences)}), ${detail}`,
  };
}

/**
 * Find the cells a melody keeps coming back to.
 *
 * Every window of `minNotes` to `maxNotes` consecutive notes is reduced to its
 * interval sequence and its rhythmic profile, and windows sharing both are
 * statements of one motif — so a restatement a fifth higher, or one written in
 * doubled note values, is found as the same cell rather than as a new one.
 * Overlapping statements of a repetitive figure are counted once, and a cell
 * whose statements all sit inside the statements of a longer cell that recurs at
 * least as often is dropped, so the answer names the longest thing that recurs
 * rather than every fragment of it.
 *
 * The melody is expected to be monophonic, as {@link analyzeVoice} expects a
 * voice to be; split polyphonic material into lines first. Notes struck together
 * are read as one event, the highest of them standing for it, so a chord is
 * reduced to its top voice rather than read as a line of its own. Onsets are
 * expected to be quantised, since two statements must agree on their rhythm to
 * be recognised as one motif.
 *
 * @param notes The melody, in time order. Notes that never sound are dropped.
 * @param opts Cell-length bounds and the recurrence threshold; see
 *   {@link ExtractMotifsOptions}.
 * @returns The motifs found, longest first, then by how often they recur, then
 *   by where they first appear. Empty when nothing recurs.
 * @example
 * ```ts
 * import { extractMotifs } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 62, startBeat: 1, durationBeat: 1 },
 *   { pitch: 64, startBeat: 2, durationBeat: 1 },
 *   { pitch: 67, startBeat: 4, durationBeat: 1 },
 *   { pitch: 69, startBeat: 5, durationBeat: 1 },
 *   { pitch: 71, startBeat: 6, durationBeat: 1 },
 * ];
 * const motifs = extractMotifs(notes);
 * motifs[0]?.occurrences.map((o) => o.startBeat); // [0, 4]
 * ```
 * @category Arrangement & Analysis
 */
export function extractMotifs(
  notes: readonly NoteEvent[],
  opts: ExtractMotifsOptions = {},
): MotifData[] {
  const minNotes = assertInteger(opts.minNotes ?? MIN_CELL_NOTES, 'motif minNotes', 2, 64);
  const maxNotes = assertInteger(opts.maxNotes ?? MAX_CELL_NOTES, 'motif maxNotes', 2, 64);
  if (maxNotes < minNotes) {
    throw new InvalidInputError(
      `motif maxNotes must be at least minNotes ${minNotes}; received ${maxNotes}`,
    );
  }
  const minOccurrences = assertInteger(
    opts.minOccurrences ?? MIN_OCCURRENCES,
    'motif minOccurrences',
    2,
  );
  const sounding = orderedNotes(notes, 'melody notes', opts.budget);
  if (sounding.length < minNotes) {
    return [];
  }
  assertGenerationBudget(sounding.length * (maxNotes - minNotes + 1), 'motif windows', opts.budget);

  const groups = new Map<string, WindowGroup>();
  for (let length = minNotes; length <= maxNotes; length += 1) {
    for (let start = 0; start + length <= sounding.length; start += 1) {
      const signature = windowSignature(sounding.slice(start, start + length));
      if (signature === null) {
        continue;
      }
      const group = groups.get(signature);
      if (group === undefined) {
        groups.set(signature, { signature, length, starts: [start] });
      } else {
        group.starts.push(start);
      }
    }
  }

  const candidates = [...groups.values()]
    .map((group) => ({ ...group, starts: nonOverlapping(group.starts, group.length) }))
    .filter((group) => group.starts.length >= minOccurrences)
    // Longest first, then most often stated, then earliest; the signature settles
    // any remaining tie so the order never depends on the map's insertion order.
    .sort(
      (a, b) =>
        b.length - a.length ||
        b.starts.length - a.starts.length ||
        (a.starts[0] ?? 0) - (b.starts[0] ?? 0) ||
        (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0),
    );

  const kept: WindowGroup[] = [];
  for (const candidate of candidates) {
    const covered = kept.some(
      (outer) =>
        outer.length > candidate.length &&
        outer.starts.length >= candidate.starts.length &&
        subsumes(outer, candidate),
    );
    if (!covered) {
      kept.push(candidate);
    }
  }
  return kept.map((group) => motifFromGroup(group, sounding));
}

/**
 * Read a run of notes as a single-statement motif.
 *
 * {@link extractMotifs} answers with motifs it found recurring; this is how a
 * caller names one it already has — a subject, an answer, a phrase lifted out of
 * a score — so that it can be handed to {@link relateMotifs}.
 *
 * The cell is expected to be monophonic, as {@link analyzeVoice} expects a voice
 * to be. Notes struck together are read as one event, the highest of them
 * standing for it, so a chord is reduced to its top voice rather than read as a
 * line of its own.
 *
 * @param notes The cell, in time order. Notes that never sound are dropped, and
 *   notes sharing an onset are folded to their top voice.
 * @returns The motif, carrying exactly one occurrence.
 * @example
 * ```ts
 * import { motifFromNotes, relateMotifs } from '@libraz/libcantus';
 * const subject = motifFromNotes([
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 62, startBeat: 1, durationBeat: 1 },
 *   { pitch: 64, startBeat: 2, durationBeat: 1 },
 * ]);
 * const answer = motifFromNotes([
 *   { pitch: 67, startBeat: 3, durationBeat: 1 },
 *   { pitch: 69, startBeat: 4, durationBeat: 1 },
 *   { pitch: 71, startBeat: 5, durationBeat: 1 },
 * ]);
 * relateMotifs(subject, answer)?.kind; // 'transposition'
 * ```
 * @category Arrangement & Analysis
 */
export function motifFromNotes(notes: readonly NoteEvent[]): MotifData {
  const sounding = orderedNotes(notes, 'motif notes').map((note) => ({ ...note }));
  return motifFromGroup(
    { signature: windowSignature(sounding) ?? '', length: sounding.length, starts: [0] },
    sounding,
  );
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
  return span > EPS ? totalGap(answerGaps) / span : 1;
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
export function relateMotifs(a: MotifData, b: MotifData, keyLike?: KeyLike): MotifRelation | null {
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
  const sequence = gap >= -SEQUENCE_GAP && gap <= SEQUENCE_GAP;
  const timeRatio = stretchRatio(modelGaps, answerGaps);
  const stretched = Math.abs(timeRatio - 1) > EPS;
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

/**
 * Edit distance between two sequences under a graded substitution cost.
 *
 * A flat cost would make a third answered by a fourth as wrong as a third
 * answered by a ninth; `cost` grades that, while an insertion or a deletion — a
 * note added or dropped — always costs one whole step.
 */
function gradedEditDistance(
  a: readonly number[],
  b: readonly number[],
  cost: (x: number, y: number) => number,
): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array<number>(b.length + 1);
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + cost(a[i - 1] ?? 0, b[j - 1] ?? 0);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (row[j - 1] ?? 0) + 1;
      row[j] = Math.min(substitution, deletion, insertion);
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

/** Turn an edit distance into a likeness in [0, 1]. */
function distanceToSimilarity(distance: number, a: number, b: number): number {
  const longest = Math.max(a, b);
  if (longest === 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, 1 - distance / longest));
}

/** Cost of hearing one interval where another was expected. */
function intervalCost(x: number, y: number): number {
  return Math.min(1, Math.abs(x - y) / INTERVAL_TOLERANCE);
}

/**
 * Cost of hearing one onset gap where another was expected, measured in octaves
 * of tempo: a gap twice as long as expected costs a whole step, and the measure
 * is the same whichever of the two is the longer.
 */
function gapCost(x: number, y: number): number {
  if (!(x > EPS) || !(y > EPS)) {
    return Math.abs(x - y) > EPS ? 1 : 0;
  }
  return Math.min(1, Math.abs(Math.log2(x / y)));
}

/**
 * Compare two lines and say why they scored what they did.
 *
 * The metric is a normalised edit distance over the interval sequence, weighted
 * against the same over the rhythmic profile. Intervals rather than pitches,
 * because the same tune in another key is the same tune; edit distance rather
 * than a step-by-step correlation, because a variant that adds a passing note or
 * drops one still has to line up with its model, and only an alignment-based
 * measure can do that. Substituting one interval for another costs by how far
 * apart they are rather than a flat step, so an answer that widens a third to a
 * fourth stays close to its model while one that replaces it with a leap does
 * not. The rhythm carries the smaller share: a melody is recognised mostly by
 * its pitch shape, but a figure in a wholly different rhythm is a different
 * figure.
 *
 * Both lines are expected to be monophonic, as {@link analyzeVoice} expects a
 * voice to be. Notes struck together are read as one event, the highest of them
 * standing for it, so a chord is reduced to its top voice rather than read as a
 * line of its own.
 *
 * @param a The first line: a motif, or plain note events.
 * @param b The second line.
 * @returns The overall likeness, the two terms behind it, and a rationale.
 * @example
 * ```ts
 * import { compareMelodies } from '@libraz/libcantus';
 * const line = [
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 62, startBeat: 1, durationBeat: 1 },
 *   { pitch: 64, startBeat: 2, durationBeat: 1 },
 * ];
 * compareMelodies(line, line).similarity; // 1
 * ```
 * @category Arrangement & Analysis
 */
export function compareMelodies(a: MelodicPhrase, b: MelodicPhrase): MelodicComparison {
  const left = orderedNotes(phraseNotes(a), 'melody a');
  const right = orderedNotes(phraseNotes(b), 'melody b');
  const leftIntervals = intervalsOf(left);
  const rightIntervals = intervalsOf(right);
  const pitchSimilarity = distanceToSimilarity(
    gradedEditDistance(leftIntervals, rightIntervals, intervalCost),
    leftIntervals.length,
    rightIntervals.length,
  );
  const leftGaps = rhythmProfile(onsetGaps(left)) ?? onsetGaps(left);
  const rightGaps = rhythmProfile(onsetGaps(right)) ?? onsetGaps(right);
  const rhythmSimilarity = distanceToSimilarity(
    gradedEditDistance(leftGaps, rightGaps, gapCost),
    leftGaps.length,
    rightGaps.length,
  );
  const similarity = PITCH_WEIGHT * pitchSimilarity + RHYTHM_WEIGHT * rhythmSimilarity;
  return {
    similarity,
    pitchSimilarity,
    rhythmSimilarity,
    rationale:
      `Interval shapes ${Math.round(pitchSimilarity * 100)}% alike, ` +
      `rhythms ${Math.round(rhythmSimilarity * 100)}% alike, ` +
      `weighted ${PITCH_WEIGHT}/${RHYTHM_WEIGHT} into ${roundTo(similarity, 3)}`,
  };
}

/**
 * How alike two lines are, in [0, 1].
 *
 * The number {@link compareMelodies} reaches, for callers that only want to rank
 * phrases: 1 for the same line — a transposition of it included, since the
 * measure is built on intervals — and lower the further two lines are from being
 * each other's variant. Symmetric in its arguments, and deterministic.
 *
 * @param a The first line: a motif, or plain note events.
 * @param b The second line.
 * @returns The likeness in [0, 1].
 * @example
 * ```ts
 * import { melodicSimilarity } from '@libraz/libcantus';
 * const line = [
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 62, startBeat: 1, durationBeat: 1 },
 *   { pitch: 64, startBeat: 2, durationBeat: 1 },
 * ];
 * melodicSimilarity(line, line); // 1
 * ```
 * @category Arrangement & Analysis
 */
export function melodicSimilarity(a: MelodicPhrase, b: MelodicPhrase): number {
  return compareMelodies(a, b).similarity;
}

/**
 * Where the highest and lowest notes of a line sit; ties keep the earliest.
 *
 * A line with no notes has neither, and answers -1 for both rather than 0,
 * which would name a note the caller cannot reach.
 */
function extremes(notes: readonly NoteEvent[]): { peak: number; trough: number } {
  if (notes.length === 0) {
    return { peak: -1, trough: -1 };
  }
  let peak = 0;
  let trough = 0;
  for (let i = 1; i < notes.length; i += 1) {
    if ((notes[i]?.pitch ?? 0) > (notes[peak]?.pitch ?? 0)) {
      peak = i;
    }
    if ((notes[i]?.pitch ?? 0) < (notes[trough]?.pitch ?? 0)) {
      trough = i;
    }
  }
  return { peak, trough };
}

/**
 * Read the shape of a line.
 *
 * The step directions are the literal answer; the shape is what they add up to.
 * A line is called ascending or descending when most of its motion runs one way,
 * not only when every step does — a climb with one dip in it is still heard as a
 * climb — and an arch when it rises to an interior peak and comes back down.
 * Anything that keeps changing direction is a wave, and a line that does not move
 * is static.
 *
 * The line is expected to be monophonic, as {@link analyzeVoice} expects a voice
 * to be; split polyphonic material into lines first. Notes struck together are
 * read as one event, the highest of them standing for it — a chord and the note
 * after it trace one step, not a climb through the chord — so a piano part read
 * whole answers for its top voice rather than for a line no one plays.
 *
 * @param notes The line: a motif, or plain note events. Notes that never sound
 *   are dropped, and notes sharing an onset are folded to their top voice.
 * @returns The directions, the shape, the peak and trough, and a rationale. A
 *   line with no sounding notes is static with a range of 0, and its peak and
 *   trough are -1: there is no note for them to point at.
 * @example
 * ```ts
 * import { melodicContour } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 64, startBeat: 1, durationBeat: 1 },
 *   { pitch: 60, startBeat: 2, durationBeat: 1 },
 * ];
 * melodicContour(notes).shape; // 'arch'
 * ```
 * @category Arrangement & Analysis
 */
export function melodicContour(notes: MelodicPhrase): MelodicContour {
  const line = orderedNotes(phraseNotes(notes), 'contour notes');
  const intervals = intervalsOf(line);
  const directions: ContourDirection[] = intervals.map((step) =>
    step > 0 ? 'up' : step < 0 ? 'down' : 'same',
  );
  const { peak, trough } = extremes(line);
  const range = (line[peak]?.pitch ?? 0) - (line[trough]?.pitch ?? 0);
  const motion = intervals.reduce((sum, step) => sum + Math.abs(step), 0);
  if (motion === 0) {
    return {
      directions,
      shape: 'static',
      peakIndex: peak,
      troughIndex: trough,
      range: 0,
      rationale:
        line.length < 2
          ? 'Too short to have a direction, so the line is static'
          : 'Every note at the same pitch, so the line is static',
    };
  }

  const first = line[0]?.pitch ?? 0;
  const last = line[line.length - 1]?.pitch ?? 0;
  const net = last - first;
  const directness = Math.abs(net) / motion;
  const share = Math.round(directness * 100);
  if (directness >= DIRECTIONAL_SHARE) {
    const shape = net > 0 ? 'ascending' : 'descending';
    return {
      directions,
      shape,
      peakIndex: peak,
      troughIndex: trough,
      range,
      rationale: `${share}% of the motion runs ${net > 0 ? 'up' : 'down'}, so the line is ${shape}`,
    };
  }

  const peakPitch = line[peak]?.pitch ?? 0;
  const archMotion = peakPitch - first + (peakPitch - last);
  if (peak > 0 && peak < line.length - 1 && archMotion >= DIRECTIONAL_SHARE * motion) {
    return {
      directions,
      shape: 'arch',
      peakIndex: peak,
      troughIndex: trough,
      range,
      rationale: `Rises to its peak at note ${peak + 1} of ${line.length} and falls back, so the line is an arch`,
    };
  }
  return {
    directions,
    shape: 'wave',
    peakIndex: peak,
    troughIndex: trough,
    range,
    rationale: `Changes direction without settling either way (${share}% of the motion nets out), so the line is a wave`,
  };
}
