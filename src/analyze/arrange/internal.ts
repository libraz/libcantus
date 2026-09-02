/**
 * Shared helpers for the arrangement-analysis modules: pooling every track's
 * sounding notes and partitioning a track into monophonic sub-voices, plus the
 * small geometric primitives both the track-role and tension passes rely on.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { NoteEvent } from '../../core/types.js';
import type { NoteEventAssertOptions } from '../../core/validation/index.js';
import {
  assertArray,
  assertFiniteNumber,
  assertNoteEvents,
  assertOneOf,
  describeRejected,
} from '../../core/validation/index.js';
import { PROFILE_WEIGHTS, type SafetyProfile } from '../../theory/safety/index.js';
import { resolveKey } from '../../theory/scale/index.js';
import { adjacent, BEAT_EPS, hasEnded, sameInstant } from '../adjacency.js';
import type { KeyRegion } from '../keys/index.js';
import { assertChordTimeline, type ChordTimeline } from '../timeline/index.js';
import type { IdentifiedVoiceNote } from '../voice/index.js';
import type { ArrangementTrack, TrackRole } from './tracks.js';

/**
 * Largest interval, in semitones, a sub-voice will span between consecutive
 * notes. Beyond two octaves the connection is not a melodic step or leap but an
 * artefact of lane packing, so a new sub-voice is opened instead.
 */
const MAX_LANE_LEAP = 24;

/** A note with the pitch that immediately preceded it in the same sub-voice. */
export type PreparedNote = {
  pitch: number;
  prevPitch?: number;
  startBeat: number;
  endBeat: number;
};

/** One monophonic sub-voice of a track: ordered notes plus sounding spans. */
export type PreparedVoice = {
  /** The sub-voice's notes in time order, each with a stable id. */
  voice: IdentifiedVoiceNote[];
  /** The same notes as sounding spans, each carrying its predecessor's pitch. */
  sounding: PreparedNote[];
  /**
   * The span sounding at a beat, or undefined. A sub-voice is monophonic by
   * construction, so at most one span covers any beat and the lookup is a
   * single binary search rather than a scan.
   */
  at: (beat: number) => PreparedNote | undefined;
};

/** A track prepared for analysis: resolved metadata plus monophonic sub-voices. */
export type PreparedTrack = {
  name: string;
  role: TrackRole;
  /** The track's index in the caller's input array. */
  trackIndex: number;
  /**
   * The track's notes partitioned into monophonic sub-voices. Voice analysis
   * assumes one note at a time, so a polyphonic track (e.g. a 'harmony' track
   * playing block chords) is split here; a monophonic track yields exactly one
   * sub-voice.
   */
  voices: PreparedVoice[];
};

/** Whether a sounding span `[start, end)` covers a beat. */
export function covers(note: PreparedNote, beat: number): boolean {
  return beat >= note.startBeat - BEAT_EPS && beat < note.endBeat - BEAT_EPS;
}

/** Whether a track's role means it carries no harmonic content. */
export function isPercussion(role: TrackRole | undefined): boolean {
  return role === 'drums';
}

/**
 * The roles that exist, written once as a table the compiler checks against
 * {@link TrackRole}: a role added to the union without a column here fails to
 * compile rather than becoming a name the check below quietly rejects.
 */
const TRACK_ROLE_TABLE: Readonly<Record<TrackRole, true>> = {
  melody: true,
  harmony: true,
  bass: true,
  drums: true,
  other: true,
};

/** The roles that exist, read off the table rather than listed again here. */
const TRACK_ROLES = Object.keys(TRACK_ROLE_TABLE) as TrackRole[];

/**
 * The role a track plays, checked against the roles that exist.
 *
 * A name outside the table is an input error rather than a quiet fall back to
 * `'other'`: a drum track labelled `'percussion'` — the word a MIDI import
 * naturally writes — would be read as pitched material and pooled into the key
 * and the chords, and the role would be reported back as a value
 * {@link TrackRole} says cannot occur.
 *
 * @param role The track's role, if any.
 * @param name What the track is called in an error message.
 * @returns The role, or `'other'` when the track carries none.
 * @throws If the role names no known role.
 */
export function trackRoleOf(role: TrackRole | undefined, name: string): TrackRole {
  return role === undefined ? 'other' : assertOneOf(role, TRACK_ROLES, name);
}

/** The safety profile an arrangement is judged under when the caller names none. */
const DEFAULT_PROFILE: SafetyProfile = 'pop';

/** The profiles that exist, read off the table rather than listed again here. */
const SAFETY_PROFILES = Object.keys(PROFILE_WEIGHTS) as SafetyProfile[];

/**
 * The safety profile an arrangement is judged under, checked against the
 * profiles that exist.
 *
 * A name outside the table is an input error rather than a quiet fall back to
 * `pop`, which would read as a verdict about the music instead of as the
 * misspelling it is. Both entry points resolve it here so they cannot disagree
 * about which names are taken.
 *
 * @param profile The caller's profile, if any.
 * @returns The profile to judge under.
 * @throws If the profile names no known profile.
 */
export function arrangementProfile(profile: SafetyProfile | undefined): SafetyProfile {
  return assertOneOf(profile ?? DEFAULT_PROFILE, SAFETY_PROFILES, 'arrangement profile');
}

/**
 * Validate the note array of every track, naming the track that is wrong.
 *
 * A missing or non-array `notes` is rejected here rather than becoming a raw
 * `TypeError` further down, where the message no longer says which track. Every
 * entry point that takes arrangement tracks checks them this way, so the same
 * malformed input is refused with the same message whichever one is called.
 *
 * @param tracks The tracks as the caller passed them.
 * @param options The note-event assertion options this entry point works under.
 * @returns How many notes the tracks hold in total.
 * @throws If a track's `notes` is not an array, or holds a malformed event.
 */
export function assertTrackNotes(
  tracks: readonly ArrangementTrack[],
  options: NoteEventAssertOptions,
): number {
  assertArray(tracks, 'arrangement tracks');
  let noteCount = 0;
  for (let index = 0; index < tracks.length; index += 1) {
    const notes = tracks[index]?.notes;
    if (!Array.isArray(notes)) {
      throw new InvalidInputError(
        `tracks[${index}].notes must be an array; received ${typeof notes}`,
      );
    }
    assertNoteEvents(notes, `tracks[${index}].notes`, options);
    noteCount += notes.length;
  }
  return noteCount;
}

/**
 * Reject a caller's chord timeline that is not one, when one was given at all.
 *
 * The option is what {@link assertChordTimeline} reads, with the difference
 * that leaving it out is how a caller asks for the timeline to be inferred.
 *
 * @param timeline The timeline as the caller passed it, or nothing.
 * @param name What the option is called in an error message.
 * @throws If the value is not a timeline of chord segments.
 */
export function assertGivenTimeline(timeline: ChordTimeline | undefined, name: string): void {
  if (timeline !== undefined) {
    assertChordTimeline(timeline, name);
  }
}

/**
 * Reject key regions that are not regions, or that name no key.
 *
 * The sibling of {@link assertGivenTimeline}, for the option that answers the
 * other half of the question: a region missing its `key` became a raw
 * `TypeError` inside the key reduction, several layers from the option it came
 * from. The key itself is resolved here rather than described, since resolving
 * it is what every reader of the region goes on to do.
 *
 * @param keys The regions as the caller passed them, or nothing.
 * @param name What the option is called in an error message.
 * @throws If the value is not an array of key regions.
 */
export function assertGivenKeys(keys: readonly KeyRegion[] | undefined, name: string): void {
  if (keys === undefined) {
    return;
  }
  if (!Array.isArray(keys)) {
    throw new InvalidInputError(
      `${name} must be an array of key regions; received ${describeRejected(keys)}`,
    );
  }
  for (let index = 0; index < keys.length; index += 1) {
    const region = keys[index];
    if (typeof region !== 'object' || region === null) {
      throw new InvalidInputError(
        `${name}[${index}] must be a key region; received ${describeRejected(region)}`,
      );
    }
    assertFiniteNumber(region.startBeat, `${name}[${index}].startBeat`);
    assertFiniteNumber(region.endBeat, `${name}[${index}].endBeat`);
    if (
      region.key === undefined ||
      region.key === null ||
      (typeof region.key !== 'string' && typeof region.key !== 'object')
    ) {
      throw new InvalidInputError(
        `${name}[${index}].key must name a key; received ${describeRejected(region.key)}`,
      );
    }
    resolveKey(region.key);
  }
}

/**
 * The tracks the harmony is inferred from, as a set of indices checked against
 * the tracks that exist.
 *
 * An index naming no track cannot be honoured, and matching nothing quietly
 * turns a stale index — the ordinary result of deleting a track — into an
 * analysis with no harmony at all, reported as though the arrangement were at
 * fault. A percussion track is refused for the same reason: {@link poolNotes}
 * drops it, so naming one is naming no harmony, and the analysis that comes back
 * blames the music for clashing with a harmony nothing states. The session's
 * `trackIndex` is checked the same way.
 *
 * @param harmonyTracks The caller's indices, if any.
 * @param tracks The tracks the indices are read against.
 * @param name What the indices belong to, for the error message.
 * @returns The indices as a set, or undefined when the caller named none.
 * @throws If an index is not finite, names no track, or names a track whose
 *   notes carry no harmony.
 */
export function harmonyTrackSet(
  harmonyTracks: readonly number[] | undefined,
  tracks: readonly ArrangementTrack[],
  name = 'harmonyTracks',
): ReadonlySet<number> | undefined {
  if (harmonyTracks === undefined) {
    return undefined;
  }
  const only = new Set<number>();
  for (let index = 0; index < harmonyTracks.length; index += 1) {
    const value = harmonyTracks[index];
    if (value === undefined || !Number.isFinite(value)) {
      throw new InvalidInputError(`${name}[${index}] must be a track index; received ${value}`);
    }
    const track = Math.trunc(value);
    if (track < 0 || track >= tracks.length) {
      throw new InvalidInputError(
        `${name}[${index}] ${track} is outside the arrangement's ${tracks.length} tracks`,
      );
    }
    if (isPercussion(tracks[track]?.role)) {
      throw new InvalidInputError(
        `${name}[${index}] ${track} names a percussion track, whose pitches state no harmony`,
      );
    }
    only.add(track);
  }
  return only;
}

/**
 * Every sounding note of every pitched track pooled into one flat list. Zero-
 * and negative-length notes never sound, so they are dropped here (matching the
 * chord-inference ingest in the timeline module), and percussion tracks are
 * skipped entirely: their pitches are instrument selections, not harmony.
 */
export function poolNotes(tracks: ArrangementTrack[], only?: ReadonlySet<number>): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    if (track === undefined || isPercussion(track.role)) {
      continue;
    }
    if (only !== undefined && !only.has(index)) {
      continue;
    }
    for (const note of track.notes) {
      if (note.durationBeat > 0) {
        notes.push(note);
      }
    }
  }
  return notes;
}

/**
 * Split a track's ordered notes into monophonic sub-voices.
 *
 * Each note joins the free sub-voice — one whose last note has ended — whose
 * last pitch is nearest its own, so a track whose voices cross keeps each voice
 * on its own lane instead of handing a low note to whichever lane happened to
 * be created first. Ties go to the lane that ended latest, which is the one the
 * note actually follows. A connection wider than {@link MAX_LANE_LEAP} is not a
 * melodic one, so it opens a new sub-voice instead.
 *
 * The predecessor pitch this produces feeds leap and parallel detection, so a
 * mis-assigned lane invents voice-leading faults that are not in the music.
 */
function splitIntoSubVoices(ordered: IdentifiedVoiceNote[]): IdentifiedVoiceNote[][] {
  const lanes: IdentifiedVoiceNote[][] = [];
  const attachNearest = (note: IdentifiedVoiceNote, excluded = new Set<number>()): number => {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestEnd = Number.NEGATIVE_INFINITY;
    for (let lane = 0; lane < lanes.length; lane += 1) {
      if (excluded.has(lane)) {
        continue;
      }
      const last = lanes[lane]?.[(lanes[lane]?.length ?? 0) - 1];
      if (last === undefined) {
        continue;
      }
      const end = last.startBeat + last.durationBeat;
      if (!hasEnded(end, note.startBeat)) {
        continue; // still sounding, so the lane is not free
      }
      const distance = Math.abs(last.pitch - note.pitch);
      if (distance > MAX_LANE_LEAP) {
        continue;
      }
      if (distance < bestDistance || (distance === bestDistance && end > bestEnd)) {
        best = lane;
        bestDistance = distance;
        bestEnd = end;
      }
    }
    if (best >= 0) {
      lanes[best]?.push(note);
    }
    return best;
  };

  for (let start = 0; start < ordered.length; ) {
    const onset = ordered[start]?.startBeat ?? 0;
    let end = start + 1;
    while (end < ordered.length && sameInstant(ordered[end]?.startBeat ?? 0, onset)) {
      end += 1;
    }
    const block = ordered.slice(start, end);
    // Notes struck together form a vertical slice, not a sequence of greedy
    // nearest-neighbour decisions, so their lanes are chosen as a whole.
    if (block.length > 1) {
      const freeLanes = lanes
        .map((lane, index) => ({ index, last: lane[lane.length - 1] }))
        .filter(
          (entry): entry is { index: number; last: IdentifiedVoiceNote } =>
            entry.last !== undefined &&
            hasEnded(entry.last.startBeat + entry.last.durationBeat, onset),
        )
        .sort((a, b) => a.last.pitch - b.last.pitch);
      const assignment = pairWithFreeLanes(block, freeLanes);
      // Every lane the slice takes is settled before a note is placed: a note
      // left for {@link attachNearest} must not be handed a lane the slice
      // already spoke for, and neither may two of them share one.
      const taken = new Set<number>(
        assignment.filter((lane): lane is number => lane !== undefined),
      );
      for (let index = 0; index < block.length; index += 1) {
        const note = block[index];
        if (note === undefined) {
          continue;
        }
        const lane = assignment[index];
        if (lane !== undefined) {
          lanes[lane]?.push(note);
          continue;
        }
        const attached = attachNearest(note, taken);
        if (attached < 0) {
          lanes.push([note]);
        } else {
          taken.add(attached);
        }
      }
    } else {
      const note = block[0];
      if (note !== undefined && attachNearest(note) < 0) {
        lanes.push([note]);
      }
    }
    start = end;
  }
  return lanes;
}

/**
 * Choose a free lane for each note of one simultaneous block.
 *
 * The whole slice is assigned at once, by the rule {@link splitIntoSubVoices}
 * follows note by note: each note joins the free lane whose last pitch is
 * nearest its own, with the block's low-to-high order preserved so no two
 * assignments cross. Pairing by position instead — the lowest note to the lowest
 * free lane — hands a thinned chord's notes to lanes they never sounded on: a
 * C-E-G that becomes E-G gives the E the C's lane and invents the leap that
 * follows from it.
 *
 * A connection wider than {@link MAX_LANE_LEAP} is not a melodic one, so leaving
 * a note for a lane of its own costs exactly that: it is taken whenever no
 * remaining lane is closer than the widest connection a lane admits.
 *
 * @param block The notes struck together, low to high.
 * @param freeLanes The lanes free at that onset, by their last pitch, low to high.
 * @returns One entry per block note: the lane it joins, or undefined when it
 *   joins none of them.
 */
function pairWithFreeLanes(
  block: readonly IdentifiedVoiceNote[],
  freeLanes: readonly { index: number; last: IdentifiedVoiceNote }[],
): (number | undefined)[] {
  const noteCount = block.length;
  const laneCount = freeLanes.length;
  const assignment = new Array<number | undefined>(noteCount).fill(undefined);
  if (laneCount === 0) {
    return assignment;
  }
  // Cost of the cheapest order-preserving assignment of the first i notes over
  // the first j lanes, and the step it ends with: 0 leaves lane j-1 unused, 1
  // pairs note i-1 with it, 2 leaves note i-1 without a lane.
  const width = laneCount + 1;
  const cost = new Float64Array((noteCount + 1) * width);
  const step = new Uint8Array((noteCount + 1) * width);
  for (let i = 1; i <= noteCount; i += 1) {
    cost[i * width] = i * MAX_LANE_LEAP;
    step[i * width] = 2;
  }
  for (let i = 1; i <= noteCount; i += 1) {
    for (let j = 1; j <= laneCount; j += 1) {
      let best = cost[i * width + j - 1] ?? 0;
      let choice = 0;
      const unpaired = (cost[(i - 1) * width + j] ?? 0) + MAX_LANE_LEAP;
      if (unpaired < best) {
        best = unpaired;
        choice = 2;
      }
      const note = block[i - 1];
      const lane = freeLanes[j - 1];
      if (note !== undefined && lane !== undefined) {
        const distance = Math.abs(lane.last.pitch - note.pitch);
        const paired = (cost[(i - 1) * width + j - 1] ?? 0) + distance;
        if (distance <= MAX_LANE_LEAP && paired < best) {
          best = paired;
          choice = 1;
        }
      }
      cost[i * width + j] = best;
      step[i * width + j] = choice;
    }
  }
  for (let i = noteCount, j = laneCount; i > 0; ) {
    if (j === 0 || step[i * width + j] === 2) {
      i -= 1;
    } else if (step[i * width + j] === 1) {
      assignment[i - 1] = freeLanes[j - 1]?.index;
      i -= 1;
      j -= 1;
    } else {
      j -= 1;
    }
  }
  return assignment;
}

/** Index of the last span starting at or before a beat, or -1. */
function lastStartingAtOrBefore(sounding: PreparedNote[], beat: number): number {
  let low = 0;
  let high = sounding.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((sounding[middle]?.startBeat ?? Number.POSITIVE_INFINITY) <= beat + BEAT_EPS) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
}

/**
 * Resolve each track's metadata and derive its monophonic sub-voices.
 *
 * Notes are sorted by onset, then pitch, so ordering is deterministic, and ids
 * are assigned in that order; each note keeps the index it had in the caller's
 * array so annotations can be mapped back. Zero- and negative-length notes never
 * sound and are dropped at ingest. Each track is then partitioned into
 * monophonic sub-voices (see {@link splitIntoSubVoices}); the predecessor pitch
 * used for suspension and parallel detection is the previous note of the same
 * sub-voice, never a simultaneous chord member.
 */
export function prepareTracks(tracks: ArrangementTrack[]): PreparedTrack[] {
  let nextId = 0;
  return tracks.map((track, index) => {
    const ordered: IdentifiedVoiceNote[] = track.notes
      .map((note, originalIndex) => ({ note, originalIndex }))
      .filter(({ note }) => note.durationBeat > 0)
      .sort((a, b) => a.note.startBeat - b.note.startBeat || a.note.pitch - b.note.pitch)
      .map(({ note, originalIndex }) => ({ ...note, id: nextId++, originalIndex }));
    const voices: PreparedVoice[] = splitIntoSubVoices(ordered).map((voice) => {
      const sounding: PreparedNote[] = voice.map((note, i) => {
        const prev = i > 0 ? voice[i - 1] : undefined;
        const prevEnd = prev === undefined ? undefined : prev.startBeat + prev.durationBeat;
        const contiguous = prevEnd !== undefined && adjacent(prevEnd, note.startBeat);
        return {
          pitch: note.pitch,
          prevPitch: contiguous ? prev?.pitch : undefined,
          startBeat: note.startBeat,
          endBeat: note.startBeat + note.durationBeat,
        };
      });
      return {
        voice,
        sounding,
        at: (beat: number) => {
          const candidate = sounding[lastStartingAtOrBefore(sounding, beat)];
          return candidate !== undefined && covers(candidate, beat) ? candidate : undefined;
        },
      };
    });
    return {
      name: track.name ?? `track ${index + 1}`,
      role: trackRoleOf(track.role, `tracks[${index}].role`),
      trackIndex: index,
      voices,
    };
  });
}
