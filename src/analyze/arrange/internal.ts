/**
 * Shared helpers for the arrangement-analysis modules: pooling every track's
 * sounding notes and partitioning a track into monophonic sub-voices, plus the
 * small geometric primitives both the track-role and tension passes rely on.
 */

import type { NoteEvent } from '../../core/types.js';
import type { IdentifiedVoiceNote } from '../voice/index.js';
import type { ArrangementTrack, TrackRole } from './tracks.js';

/** Float tolerance for beat boundary comparisons. */
export const EPS = 1e-9;

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
  return beat >= note.startBeat - EPS && beat < note.endBeat - EPS;
}

/** Whether a track's role means it carries no harmonic content. */
export function isPercussion(role: TrackRole | undefined): boolean {
  return role === 'drums';
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
  for (const note of ordered) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestEnd = Number.NEGATIVE_INFINITY;
    for (let lane = 0; lane < lanes.length; lane += 1) {
      const last = lanes[lane]?.[(lanes[lane]?.length ?? 0) - 1];
      if (last === undefined) {
        continue;
      }
      const end = last.startBeat + last.durationBeat;
      if (end > note.startBeat + EPS) {
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
    } else {
      lanes.push([note]);
    }
  }
  return lanes;
}

/** Index of the last span starting at or before a beat, or -1. */
function lastStartingAtOrBefore(sounding: PreparedNote[], beat: number): number {
  let low = 0;
  let high = sounding.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((sounding[middle]?.startBeat ?? Number.POSITIVE_INFINITY) <= beat + EPS) {
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
        const contiguous = prevEnd !== undefined && Math.abs(prevEnd - note.startBeat) <= EPS;
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
      role: track.role ?? 'other',
      trackIndex: index,
      voices,
    };
  });
}
