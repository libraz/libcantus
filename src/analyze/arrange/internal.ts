/**
 * Shared helpers for the arrangement-analysis modules: pooling every track's
 * sounding notes and partitioning a track into monophonic sub-voices, plus the
 * small geometric primitives both the track-role and tension passes rely on.
 */

import type { NoteEvent } from '../../core/types.js';
import type { VoiceNote } from '../analysis/index.js';
import type { ArrangementTrack, TrackRole } from './tracks.js';

/** Float tolerance for beat boundary comparisons. */
export const EPS = 1e-9;

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
  voice: VoiceNote[];
  /** The same notes as sounding spans, each carrying its predecessor's pitch. */
  sounding: PreparedNote[];
};

/** A track prepared for analysis: resolved metadata plus monophonic sub-voices. */
export type PreparedTrack = {
  name: string;
  role: TrackRole;
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

/**
 * Every sounding note of every track pooled into one flat list. Zero- and
 * negative-length notes never sound, so they are dropped here (matching the
 * chord-inference ingest in the timeline module).
 */
export function poolNotes(tracks: ArrangementTrack[]): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (const track of tracks) {
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
 * Greedy lane assignment: each note joins the first sub-voice that is free at
 * its onset (its last note has ended), otherwise it opens a new sub-voice. A
 * monophonic track therefore stays a single sub-voice, while block chords fan
 * out into one sub-voice per simultaneous note, keeping every sub-voice's
 * note-to-note adjacency genuinely melodic.
 */
function splitIntoSubVoices(ordered: VoiceNote[]): VoiceNote[][] {
  const lanes: VoiceNote[][] = [];
  for (const note of ordered) {
    const lane = lanes.find((candidate) => {
      const last = candidate[candidate.length - 1];
      return last !== undefined && last.startBeat + last.durationBeat <= note.startBeat + EPS;
    });
    if (lane) {
      lane.push(note);
    } else {
      lanes.push([note]);
    }
  }
  return lanes;
}

/**
 * Resolve each track's metadata and derive its monophonic sub-voices.
 *
 * Notes are sorted by onset, then pitch, so ordering is deterministic, and ids
 * are assigned in that order. Zero- and negative-length notes never sound and
 * are dropped at ingest. Each track is then partitioned into monophonic
 * sub-voices (see {@link splitIntoSubVoices}); the predecessor pitch used for
 * suspension and parallel detection is the previous note of the same sub-voice,
 * never a simultaneous chord member.
 */
export function prepareTracks(tracks: ArrangementTrack[]): PreparedTrack[] {
  let nextId = 0;
  return tracks.map((track, index) => {
    const ordered: VoiceNote[] = track.notes
      .filter((note) => note.durationBeat > 0)
      .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
      .map((note) => ({ ...note, id: nextId++ }));
    const voices: PreparedVoice[] = splitIntoSubVoices(ordered).map((voice) => ({
      voice,
      sounding: voice.map((note, i) => {
        const prev = i > 0 ? voice[i - 1] : undefined;
        return {
          pitch: note.pitch,
          prevPitch: prev?.pitch,
          startBeat: note.startBeat,
          endBeat: note.startBeat + note.durationBeat,
        };
      }),
    }));
    return {
      name: track.name ?? `track ${index + 1}`,
      role: track.role ?? 'other',
      voices,
    };
  });
}
