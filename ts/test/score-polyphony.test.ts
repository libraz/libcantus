import { describe, expect, it } from 'vitest';
import { analyzeArrangement } from '../src/analyze/arrange/index.js';
import type { TheoryLabel } from '../src/analyze/voice/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Score } from '../src/model/score.js';

/**
 * A score holds a whole piece, not a line, so its note-by-note reading must be
 * the polyphonic one: every note classified in its own voice, against the other
 * voices sounding under it. Read as a single line the same notes yield figures
 * that cross voices and never yield a suspension, which is by definition a
 * dissonance against something else sounding.
 */

/** Four voices over two bars: F major, then C major under a 4-3 suspension. */
const CHORALE: NoteEvent[] = [
  // Bass: F2 then C3.
  { pitch: 41, startBeat: 0, durationBeat: 4 },
  { pitch: 48, startBeat: 4, durationBeat: 4 },
  // Tenor: A3 then G3.
  { pitch: 57, startBeat: 0, durationBeat: 4 },
  { pitch: 55, startBeat: 4, durationBeat: 4 },
  // Alto: C4 held under both chords.
  { pitch: 60, startBeat: 0, durationBeat: 4 },
  { pitch: 60, startBeat: 4, durationBeat: 4 },
  // Soprano: F4 prepared over the F chord, suspended over the C, resolving to E4.
  { pitch: 65, startBeat: 0, durationBeat: 4 },
  { pitch: 65, startBeat: 4, durationBeat: 1 },
  { pitch: 64, startBeat: 5, durationBeat: 3 },
];

/** The labels a note carries in a score's own reading, by pitch and beat. */
function labelsAt(score: Score, pitch: number, startBeat: number): TheoryLabel[] {
  return (
    score.voices().find((note) => note.pitch === pitch && note.startBeat === startBeat)?.labels ??
    []
  );
}

describe('Score.voices over polyphony', () => {
  it('reports the fourth held over the bass as a 4-3 suspension', () => {
    const labels = labelsAt(Score.of(CHORALE), 65, 4);
    const suspension = labels.find((label) => label.kind === 'suspension');
    expect(suspension).toBeDefined();
    expect(suspension?.kind === 'suspension' ? suspension.type : undefined).toBe('sus4-3');
    expect(suspension?.kind === 'suspension' ? suspension.resolveTo : undefined).toBe(64);
  });

  it('reads the same notes the arrangement reader reads', () => {
    // The arrangement reader is the one that already splits polyphony into
    // voices; a score of the same notes must not disagree with it.
    const score = Score.of(CHORALE);
    const arranged = analyzeArrangement([{ notes: score.notes }]).tracks[0]?.notes ?? [];
    const byId = new Map(arranged.map((note) => [note.noteId, note.labels]));
    for (const note of score.voices()) {
      expect(byId.get(note.noteId)).toEqual(note.labels);
    }
  });

  it('does not hear one voice as another voice passing tone', () => {
    // The alto sustains through both chords, so nothing it sounds is a step on
    // the way from the soprano's F to the bass's C, however the notes sort.
    for (const startBeat of [0, 4]) {
      const labels = labelsAt(Score.of(CHORALE), 60, startBeat);
      expect(labels.map((label) => label.kind)).not.toContain('passing');
      expect(labels.map((label) => label.kind)).not.toContain('neighbor');
    }
  });

  it('gives one annotation per note, in the score own order', () => {
    const score = Score.of(CHORALE);
    const analyzed = score.voices();
    expect(analyzed).toHaveLength(score.notes.length);
    expect(analyzed.map((note) => note.noteId)).toEqual(score.notes.map((_, index) => index));
    expect(analyzed.map((note) => note.pitch)).toEqual(score.notes.map((note) => note.pitch));
  });
});

describe('Score.contour over polyphony', () => {
  it('reads the top voice rather than a line drawn through the chords', () => {
    // The soprano F4 - F4 - E4 is the line a listener follows; the notes
    // struck under it are not steps of a melody.
    const contour = Score.of(CHORALE).contour();
    expect(contour.directions).toEqual(['same', 'down']);
    expect(contour.range).toBe(1);
  });
});
