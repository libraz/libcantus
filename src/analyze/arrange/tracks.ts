/**
 * Arrangement track-role analysis: a single harmony is inferred from every
 * track's notes pooled together, each track is then analysed against that shared
 * harmony, and notes that clash with the sounding chord are collected as
 * conflicts.
 */

import type { MeterMap, TimeSignature } from '../../core/meter/index.js';
import { isStrongBeat, resolveMeters } from '../../core/meter/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import type { NoteEventAssertOptions } from '../../core/validation/index.js';
import { assertGenerationBudget, assertRange } from '../../core/validation/index.js';
import {
  evaluateSafety,
  NoteSafety,
  type SafetyProfile,
  type VoiceSnapshot,
} from '../../theory/safety/index.js';
import { majorKey } from '../../theory/scale/index.js';
import {
  attachPivots,
  type KeyRegion,
  keyLookup,
  keyTimelineFromNotes,
  prevailingKeyOf,
} from '../keys/index.js';
import {
  analyzeTimeline,
  type CadenceHit,
  type ChordTimeline,
  type ChordTimelineResult,
  type DirtySlots,
  detectCadences,
  type TimelineEvidence,
} from '../timeline/index.js';
import {
  type AnalyzedNote,
  analyzeVoice,
  type TheoryLabel,
  type VoiceNote,
} from '../voice/index.js';
import {
  arrangementProfile,
  assertTrackNotes,
  EPS,
  harmonyTrackSet,
  isPercussion,
  type PreparedTrack,
  poolNotes,
  prepareTracks,
} from './internal.js';

/**
 * The musical role a track plays in the arrangement.
 *
 * Only `drums` changes the analysis: its pitches select instruments rather than
 * naming harmony, so such a track is excluded from chord and key inference and
 * from every voice-leading comparison, and is reported back with no
 * annotations. `harmony` is meaningful through
 * {@link ArrangementOptions.harmonyTracks}, which names the tracks the chords
 * are inferred from. The rest are labels carried through to
 * {@link TrackAnalysis.role} for the caller's own use; nothing is inferred, so
 * a track left unlabelled reports `'other'` rather than a guess.
 *
 * @category Arrangement & Analysis
 */
export type TrackRole = 'melody' | 'harmony' | 'bass' | 'drums' | 'other';

/**
 * One input track: its notes plus optional name and role.
 *
 * @category Arrangement & Analysis
 */
export type ArrangementTrack = {
  name?: string;
  role?: TrackRole;
  notes: readonly NoteEvent[];
};

/**
 * A track after analysis: its resolved name, role, and per-note annotations.
 *
 * @category Arrangement & Analysis
 */
export type TrackAnalysis = {
  name: string;
  role: TrackRole;
  /** One {@link AnalyzedNote} per note, labelled against the inferred chords. */
  notes: AnalyzedNote[];
};

/**
 * A note that clashes with the harmony sounding beneath it.
 *
 * @category Arrangement & Analysis
 */
export type Conflict = {
  beat: number;
  trackName: string;
  /** The clashing track's index in the caller's input array. */
  trackIndex: number;
  /** The note's index in that track's own note array. */
  originalIndex?: number;
  /** The id the note carries in {@link TrackAnalysis.notes}. */
  noteId: number;
  pitch: number;
  /**
   * The note's theory labels at its onset, so a caller can tell a genuine clash
   * from a passing tone, a neighbour, or a prepared suspension — all of which
   * are ordinary non-chord tones that still evaluate as unsafe.
   */
  labels: TheoryLabel[];
  /** The clash severity: {@link NoteSafety.Warning} or {@link NoteSafety.Dissonant}. */
  safety: NoteSafety;
  /** {@link SafetyResult.reasons} bitmask. */
  reasons: number;
  /** Preferred stepwise resolution, when the safety evaluator provides one. */
  resolveTo?: number;
  /** Nearby fully safe replacement pitches, nearest first. */
  suggestions?: number[];
  rationale?: string;
};

/**
 * Override an inferred result's key regions with ones the caller already had.
 *
 * The chords stay as inferred: they were found against the caller's regions
 * only if the caller also passed them down, and quietly re-deriving them here
 * would make the same options produce different chords depending on which pass
 * ran first.
 */
function withGivenKeys(
  result: ChordTimelineResult,
  given: KeyRegion[] | undefined,
): ChordTimelineResult {
  if (given === undefined) {
    return result;
  }
  return { ...result, keys: given, prevailingKey: prevailingKeyOf(given) ?? result.prevailingKey };
}

/**
 * Build the same result shape from a timeline the caller already had.
 *
 * The timeline was not inferred from these notes, so it carries no measured
 * confidence — reporting 1 would turn every confidence gate into an
 * unconditional pass. The key regions still come from the notes, because the
 * caller supplied chords, not an answer about the key; they are read against the
 * whole meter map and annotated with their pivots, exactly as the inferring path
 * reads and annotates its own.
 */
function callerTimeline(
  timeline: ChordTimeline,
  key: KeyScale | undefined,
  given: KeyRegion[] | undefined,
  pooled: NoteEvent[],
  meters: MeterMap,
  budget: number | undefined,
): {
  timeline: ChordTimeline;
  keys: KeyRegion[];
  prevailingKey: KeyScale;
  segmentConfidence: number[];
} {
  const totalBeats = timeline.segments.reduce((end, segment) => Math.max(end, segment.endBeat), 0);
  // Caller-supplied regions are the caller's answer and are passed through as
  // they are; the ones derived here are annotated like any other, since the
  // chords a pivot is read from are in hand either way.
  const keys =
    given ??
    attachPivots(
      key !== undefined
        ? [{ startBeat: 0, endBeat: totalBeats, key, confidence: 1 }]
        : keyTimelineFromNotes(pooled, { meters, totalBeats, budget }),
      timeline.segments,
    );
  return {
    timeline,
    keys,
    prevailingKey: prevailingKeyOf(keys) ?? majorKey(0),
    segmentConfidence: timeline.segments.map(() => 0),
  };
}

/**
 * The full result of {@link analyzeArrangement}.
 *
 * @category Arrangement & Analysis
 */
export type ArrangementAnalysis = {
  /**
   * The key regions the analysis ran against, in time order. Roman numerals,
   * harmonic function and note safety are all judged against the region
   * covering the beat, so a piece that modulates is not read against the key it
   * started in for every bar after it leaves.
   */
  keys: KeyRegion[];
  /** The key held longest across {@link ArrangementAnalysis.keys}. */
  prevailingKey: KeyScale;
  timeline: ChordTimeline;
  segmentConfidence: number[];
  cadences: CadenceHit[];
  tracks: TrackAnalysis[];
  /** Notes clashing with the sounding harmony, worst severity first. */
  conflicts: Conflict[];
};

/**
 * Options controlling {@link analyzeArrangement} and {@link tensionCurve}.
 *
 * @category Arrangement & Analysis
 */
export type ArrangementOptions = {
  /**
   * A single key held across the whole arrangement. Omit it, and `keys` with
   * it, to have the key searched for over time so a modulating piece is read
   * against the key actually in force.
   */
  key?: KeyScale;
  /**
   * Key regions to judge against, when a previous pass already worked them out.
   * Takes precedence over `key`; supplying both is answering the same question
   * twice, and the more specific answer wins.
   */
  keys?: KeyRegion[];
  /**
   * A chord timeline to analyse against, instead of inferring one from the
   * notes. Supply it to analyse a hand-written progression, or to reuse the
   * timeline of an earlier call rather than re-running chord inference.
   */
  timeline?: ChordTimeline;
  /**
   * Indices of the tracks the harmony is inferred from. Defaults to every
   * pitched track. Percussion tracks are excluded either way. An index naming
   * no track is an input error rather than one that matches nothing.
   */
  harmonyTracks?: number[];
  /**
   * Lowest severity reported in `conflicts`.
   *
   * @defaultValue {@link NoteSafety.Warning}
   */
  minSeverity?: NoteSafety;
  /**
   * A single time signature held across the whole arrangement, as sugar for a
   * one-element `meters`; defaults to 4/4. Giving both is an input error.
   *
   * @defaultValue `4/4`
   */
  ts?: TimeSignature;
  /**
   * The meter as it changes over the arrangement. Bar lines, downbeats and
   * metric weight all follow the signature in force at the beat in question.
   *
   * @defaultValue 4/4 throughout
   */
  meters?: MeterMap;
  /**
   * Length of the pickup in beats, when the piece starts with one.
   *
   * The first downbeat is beat 0, so an upbeat is written at negative beats.
   * Declaring its length rejects a note that starts before the pickup does;
   * leave it unset to accept any finite onset.
   *
   * @defaultValue no declared pickup
   */
  pickupBeats?: number;
  /**
   * Chord-slot length in beats; defaults to the length of the opening bar.
   *
   * @defaultValue the length of the opening bar
   */
  harmonicRhythm?: number;
  /**
   * Safety profile used for conflict detection; defaults to `pop`.
   *
   * @defaultValue `'pop'`
   */
  profile?: SafetyProfile;
  /**
   * Upper bound on the work this call may do — note counts, windows, and
   * candidate counts are each checked against it before anything is allocated.
   *
   * Raise it to analyse a piece larger than the default allows; the default is
   * {@link DEFAULT_GENERATION_BUDGET}, chosen so a runaway input fails fast
   * rather than blocking the thread.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/**
 * Sounding pitches of every sub-voice at a beat, excluding one sub-voice.
 *
 * Only the sub-voice under analysis is excluded — sibling sub-voices of the
 * same track are included, so dissonant clusters inside a single polyphonic
 * track are still detected.
 */
type SoundingVoice = {
  track: number;
  voice: number;
  snapshot: VoiceSnapshot;
};

/** Build one complete arrangement snapshot for an evaluation beat. */
function soundingVoicesAt(prepared: PreparedTrack[], beat: number): SoundingVoice[] {
  const out: SoundingVoice[] = [];
  for (let t = 0; t < prepared.length; t += 1) {
    const track = prepared[t];
    if (!track || isPercussion(track.role)) {
      continue;
    }
    for (let v = 0; v < track.voices.length; v += 1) {
      // Each sub-voice is monophonic, so this is one binary search per voice
      // rather than a scan of every note in the arrangement.
      const note = track.voices[v]?.at(beat);
      if (note === undefined) {
        continue;
      }
      const snap: VoiceSnapshot = { pitch: note.pitch };
      // Motion reasons compare one real transition shared by both voices.
      // A voice attacking exactly here contributes its adjacent predecessor;
      // a sustained voice contributes the same pitch (oblique motion).
      const previous = Math.abs(note.startBeat - beat) <= EPS ? note.prevPitch : note.pitch;
      if (previous !== undefined) {
        snap.prevPitch = previous;
      }
      out.push({ track: t, voice: v, snapshot: snap });
    }
  }
  return out;
}

/** Get every simultaneous voice except the one being evaluated. */
function otherVoicesSounding(
  prepared: PreparedTrack[],
  excludeTrack: number,
  excludeVoice: number,
  beat: number,
  cache: Map<number, SoundingVoice[]>,
): VoiceSnapshot[] {
  const sounding = cache.get(beat) ?? soundingVoicesAt(prepared, beat);
  cache.set(beat, sounding);
  return sounding
    .filter(({ track, voice }) => track !== excludeTrack || voice !== excludeVoice)
    .map(({ snapshot }) => snapshot);
}

/** Index of the first segment starting strictly after a beat. */
function firstSegmentAfter(timeline: ChordTimeline, beat: number): number {
  let low = 0;
  let high = timeline.segments.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((timeline.segments[middle]?.startBeat ?? Number.POSITIVE_INFINITY) <= beat + EPS) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * The beats at which a note must be checked against the harmony: its onset,
 * plus the onset of every later chord segment the note sustains across. Each
 * crossed segment is visited exactly once (at its own start), so a boundary
 * beat is never evaluated twice for the same note.
 *
 * Segments are in beat order, so the crossed ones are a contiguous run found by
 * binary search rather than by scanning the whole timeline for every note.
 */
function evaluationBeats(note: VoiceNote, timeline: ChordTimeline): number[] {
  const noteEnd = note.startBeat + note.durationBeat;
  const beats = [note.startBeat];
  for (let i = firstSegmentAfter(timeline, note.startBeat); i < timeline.segments.length; i += 1) {
    const start = timeline.segments[i]?.startBeat;
    if (start === undefined || start >= noteEnd - EPS) {
      break;
    }
    beats.push(start);
  }
  return beats;
}

/**
 * Analyse a whole arrangement against the harmony inferred from it.
 *
 * The chord timeline and the key regions it is read against are inferred from
 * the pooled notes of every pitched track (see
 * {@link chordTimelineFromNotes}); pooling all voices is
 * robust even when roles are absent or a track doubles the harmony, so it is
 * preferred over deriving the harmony from a subset. A track marked
 * `role: 'drums'` is excluded — its pitches name instruments, not harmony, and
 * pooling them would corrupt the key, the timeline and every reading built on
 * them. Pass `harmonyTracks` to restrict inference further, or `timeline` to
 * analyse against a progression you already have. Zero- and negative-length
 * notes never sound, so they are dropped at ingest and appear in neither the
 * annotations nor the conflicts.
 *
 * Voice analysis assumes one monophonic voice at a time, so each track is
 * first partitioned into monophonic sub-voices (a polyphonic block-chord track
 * fans out into one sub-voice per simultaneous note; a monophonic track is
 * unaffected). Each sub-voice is labelled note-by-note against the harmony
 * with {@link analyzeVoice}, seeing every other sub-voice — including siblings
 * within the same track — as its accompaniment. Every note is then re-checked
 * with {@link evaluateSafety} at its onset and again at each chord change it
 * sustains across, so a held note that clashes with a later chord is caught:
 * evaluations that are not {@link NoteSafety.Safe} become conflicts, one per
 * clashing beat, sorted worst severity first and then by beat.
 *
 * Every ordinary non-chord tone — a passing note, a neighbour, a prepared
 * suspension — is by definition unsafe against the chord under it, so the
 * conflict list is a report, not a fault list. Each conflict carries the note's
 * `labels` and its `trackIndex`/`originalIndex`, so a caller can tell those
 * apart and map a conflict back to the note it passed in; `minSeverity` narrows
 * the list to outright dissonance.
 *
 * @param tracks The tracks to analyse.
 * @param opts Analysis options; see {@link ArrangementOptions}.
 * @returns The inferred harmony, per-track annotations, cadences, and conflicts.
 * @example
 * ```ts
 * import { analyzeArrangement } from '@libraz/libcantus';
 * const melody = [
 *   { pitch: 60, startBeat: 0, durationBeat: 2 },
 *   { pitch: 67, startBeat: 2, durationBeat: 2 },
 * ];
 * const { prevailingKey, conflicts } = analyzeArrangement([{ role: 'melody', notes: melody }]);
 * prevailingKey.rootPc; // the key held longest across the analysis
 * conflicts; // notes clashing with the inferred harmony, worst severity first
 * ```
 * @category Arrangement & Analysis
 */
export function analyzeArrangement(
  tracks: ArrangementTrack[],
  opts: ArrangementOptions = {},
): ArrangementAnalysis {
  return analyzeArrangementWith(tracks, opts).analysis;
}

/**
 * Analyse an arrangement, carrying over the harmonic evidence an edit cannot
 * reach and handing back the evidence this pass leaves behind.
 *
 * Only the harmony is carried over. The per-note annotation pass is re-run in
 * full because neither half of it is local to the edit: sub-voice lane
 * assignment is a greedy left-to-right pass over the whole track, so an inserted
 * note can re-lane every note after it, and every note is evaluated against the
 * other voices sounding beneath it, so an edit in one track changes what every
 * other track hears at those beats.
 *
 * Not part of the public surface: the evidence is the private state of an
 * incremental re-analysis, and a caller holding it could pair it with notes it
 * was never derived from.
 *
 * @param tracks The tracks to analyse.
 * @param opts Analysis options.
 * @param previous Evidence from the analysis being updated, when there is one.
 * @param dirty The slots the edit may have changed.
 * @returns The analysis, and the evidence behind it when the harmony was
 *   inferred rather than supplied.
 */
export function analyzeArrangementWith(
  tracks: ArrangementTrack[],
  opts: ArrangementOptions = {},
  previous?: TimelineEvidence,
  dirty?: DirtySlots,
): { analysis: ArrangementAnalysis; evidence?: TimelineEvidence } {
  const meters = resolveMeters(opts, 'arrangement meters');
  const budget = opts.budget;
  const noteOptions: NoteEventAssertOptions = { allowNonPositiveDuration: true, budget };
  if (opts.pickupBeats !== undefined) {
    assertRange(opts.pickupBeats, 0, Number.MAX_SAFE_INTEGER, 'arrangement pickupBeats');
    noteOptions.minStartBeat = -opts.pickupBeats;
  }
  assertGenerationBudget(tracks.length, 'arrangement tracks', budget);
  const noteCount = assertTrackNotes(tracks, noteOptions);
  // The pooled total is what the downstream timeline analysis actually sizes
  // its work by, so it is checked here, under this layer's own name.
  assertGenerationBudget(noteCount, 'arrangement notes', budget);
  const profile = arrangementProfile(opts.profile);
  const minSeverity = opts.minSeverity ?? NoteSafety.Warning;
  const harmonyTracks = harmonyTrackSet(opts.harmonyTracks, tracks.length);
  const prepared = prepareTracks(tracks);
  // Every note is evaluated against the other sub-voices sounding beneath it, so
  // the work is the product of the two — not either dimension alone, which is
  // all the scalar checks above measure. The sub-voices have to be derived to be
  // counted, but that is the same O(n log n) pass the note checks already are,
  // and the check still lands before the harmony is pooled and inferred.
  const voiceCount = prepared.reduce((sum, track) => sum + track.voices.length, 0);
  assertGenerationBudget(noteCount * voiceCount, 'arrangement note-voice comparisons', budget);
  const pooled = poolNotes(tracks, harmonyTracks);

  let evidence: TimelineEvidence | undefined;
  let inferred: ChordTimelineResult;
  if (opts.timeline === undefined) {
    const run = analyzeTimeline(
      pooled,
      {
        key: opts.key,
        meters,
        pickupBeats: opts.pickupBeats,
        harmonicRhythm: opts.harmonicRhythm,
        budget,
      },
      previous,
      dirty,
    );
    evidence = run.evidence;
    inferred = withGivenKeys(run.result, opts.keys);
  } else {
    inferred = callerTimeline(opts.timeline, opts.key, opts.keys, pooled, meters, budget);
  }
  const { timeline, keys, prevailingKey, segmentConfidence } = inferred;
  const keyAt = keyLookup(keys, prevailingKey);
  // A cadence is heard in the key it arrives in, which after a modulation is
  // not the key the piece opened in.
  const cadences = detectCadences(timeline, keyAt);
  const soundingCache = new Map<number, SoundingVoice[]>();

  const trackAnalyses: TrackAnalysis[] = [];
  const conflicts: Conflict[] = [];

  for (let t = 0; t < prepared.length; t += 1) {
    const track = prepared[t];
    if (!track) {
      continue;
    }
    if (isPercussion(track.role)) {
      // A drum hit has no harmonic reading, so labelling it against the chord
      // would produce noise rather than analysis.
      trackAnalyses.push({ name: track.name, role: track.role, notes: [] });
      continue;
    }
    const notes: AnalyzedNote[] = [];
    for (let v = 0; v < track.voices.length; v += 1) {
      const subVoice = track.voices[v];
      if (!subVoice) {
        continue;
      }
      const analyzed = analyzeVoice(subVoice.voice, timeline.at, keyAt, (beat) =>
        otherVoicesSounding(prepared, t, v, beat, soundingCache),
      );
      // Appended one at a time: a spread of a long sub-voice passes every note
      // as an argument, which overflows the call stack on a track the budget
      // above accepts.
      for (const note of analyzed) {
        notes.push({ ...note, trackIndex: track.trackIndex });
      }
      const labelsById = new Map(analyzed.map((note) => [note.noteId, note.labels]));

      for (let noteIndex = 0; noteIndex < subVoice.voice.length; noteIndex += 1) {
        const note = subVoice.voice[noteIndex];
        const preparedNote = subVoice.sounding[noteIndex];
        if (note === undefined || preparedNote === undefined) {
          continue;
        }
        for (const beat of evaluationBeats(note, timeline)) {
          const atOnset = Math.abs(beat - note.startBeat) <= EPS;
          const safetyQuery = {
            profile,
            candidatePitch: note.pitch,
            prevPitch: atOnset ? preparedNote.prevPitch : note.pitch,
            chord: timeline.at(beat),
            key: keyAt(beat),
            otherVoices: otherVoicesSounding(prepared, t, v, beat, soundingCache),
            strongBeat: isStrongBeat(beat, meters),
          };
          // Most evaluations become no reportable conflict. Avoid their
          // replacement-pitch scan (up to 24 recursive safety checks), then
          // collect suggestions only for the conflicts we will retain.
          let result = evaluateSafety(safetyQuery, { suggestions: false });
          if (result.safety !== NoteSafety.Safe && result.safety >= minSeverity) {
            result = evaluateSafety(safetyQuery);
            const conflict: Conflict = {
              beat,
              trackName: track.name,
              trackIndex: track.trackIndex,
              noteId: note.id,
              pitch: note.pitch,
              labels: labelsById.get(note.id) ?? [],
              safety: result.safety,
              reasons: result.reasons,
            };
            if (note.originalIndex !== undefined) {
              conflict.originalIndex = note.originalIndex;
            }
            if (result.rationale !== undefined) {
              conflict.rationale = result.rationale;
            }
            if (result.resolveTo !== undefined) {
              conflict.resolveTo = result.resolveTo;
            }
            if (result.suggestions !== undefined) {
              conflict.suggestions = [...result.suggestions];
            }
            conflicts.push(conflict);
          }
        }
      }
    }
    // Sub-voice results interleave; restore the track's onset-then-pitch order.
    notes.sort((a, b) => a.noteId - b.noteId);
    trackAnalyses.push({ name: track.name, role: track.role, notes });
  }

  conflicts.sort((a, b) => b.safety - a.safety || a.beat - b.beat);

  const analysis: ArrangementAnalysis = {
    keys,
    prevailingKey,
    timeline,
    segmentConfidence,
    cadences,
    tracks: trackAnalyses,
    conflicts,
  };
  return evidence === undefined ? { analysis } : { analysis, evidence };
}
