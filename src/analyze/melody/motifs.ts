/**
 * The recurring cells a melody is built from.
 *
 * A motif is the interval contour plus the rhythmic profile, so every statement
 * of it carries the same identity however far it has been transposed or however
 * wide its note values are written. What this module does is find them: every
 * window of the melody is reduced to that identity, windows that agree are
 * grouped, and a group stated often enough is a motif.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { NoteEvent } from '../../core/types.js';
import { assertGenerationBudget, assertInteger } from '../../core/validation/index.js';
import { BEAT_EPS } from '../adjacency.js';
import { melodicContour } from './contour.js';
import {
  endBeatOf,
  intervalsOf,
  onsetGaps,
  onsetSpan,
  orderedNotes,
  rhythmProfile,
  roundTo,
} from './internal.js';

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
/**
 * Whether every statement of `inner` sits inside one statement of `outer`.
 *
 * Both runs of onsets are ascending, so the two are walked together rather than
 * searched: the statement of `outer` that can hold an inner one is the latest
 * that starts at or before it, since a later start reaches further right.
 */
function subsumes(
  outer: { starts: number[]; length: number },
  inner: { starts: number[]; length: number },
): boolean {
  let at = 0;
  for (const start of inner.starts) {
    while (at + 1 < outer.starts.length && (outer.starts[at + 1] ?? 0) <= start) {
      at += 1;
    }
    const from = outer.starts[at];
    if (from === undefined || start < from || start + inner.length > from + outer.length) {
      return false;
    }
  }
  return true;
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
      timeRatio: primeSpan > BEAT_EPS ? span / primeSpan : 1,
    };
  });
  const shape = melodicContour(prime).shape;
  const transposed = occurrences.some((occurrence) => occurrence.transpose !== 0);
  const stretched = occurrences.some((occurrence) => Math.abs(occurrence.timeRatio - 1) > BEAT_EPS);
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

  // A candidate is dropped when a longer motif already kept states it inside
  // every one of its own statements, so the only groups worth asking are the
  // ones whose statements cover the candidate's first onset — a window that
  // misses that onset cannot hold all of them. One window of a given length
  // starting at a given note is one cell, so the kept groups are indexed by
  // exactly that and the candidate probes the few starts that could reach it,
  // instead of every motif kept so far. A melody that states its verse and
  // chorus twice keeps tens of thousands of groups, and asking each candidate
  // about all of them is what made the pass take seconds on one track.
  const keptByLength = new Map<number, Map<number, WindowGroup>>();
  const kept: WindowGroup[] = [];
  let comparisons = 0;
  for (const candidate of candidates) {
    const first = candidate.starts[0] ?? 0;
    let covered = false;
    for (let length = candidate.length + 1; length <= maxNotes && !covered; length += 1) {
      const byStart = keptByLength.get(length);
      if (byStart === undefined) {
        continue;
      }
      for (let from = Math.max(0, first - (length - candidate.length)); from <= first; from += 1) {
        comparisons += 1;
        const outer = byStart.get(from);
        if (outer === undefined || outer.starts.length < candidate.starts.length) {
          continue;
        }
        comparisons += outer.starts.length + candidate.starts.length;
        if (subsumes(outer, candidate)) {
          covered = true;
          break;
        }
      }
    }
    // Charged as it is spent rather than estimated: what the pass costs is the
    // statements the candidates hold, which the window count alone does not say.
    assertGenerationBudget(comparisons, 'motif subsumption comparisons', opts.budget);
    if (!covered) {
      kept.push(candidate);
      let byStart = keptByLength.get(candidate.length);
      if (byStart === undefined) {
        byStart = new Map<number, WindowGroup>();
        keptByLength.set(candidate.length, byStart);
      }
      for (const start of candidate.starts) {
        byStart.set(start, candidate);
      }
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
