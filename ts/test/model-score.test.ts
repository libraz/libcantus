import { describe, expect, it } from 'vitest';
import { hypermeter } from '../src/analyze/form/index.js';
import { keyLookup, keyTimelineFromNotes, prevailingKeyOf } from '../src/analyze/keys/index.js';
import { chordTimelineFromNotes, detectCadences } from '../src/analyze/timeline/index.js';
import { analyzeVoice } from '../src/analyze/voice/index.js';
import { type MeterMap, parseTimeSignature } from '../src/core/meter/index.js';
import type { TempoMap } from '../src/core/tempo/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Key, keyIdentity } from '../src/model/key.js';
import { Score } from '../src/model/score.js';
import { scaleOf } from '../src/theory/scale/index.js';

/**
 * `Score` is a skin over the timed analysis functions, so most of what is
 * checked here is equivalence: the class answer must be the answer the
 * underlying function gives for the same notes and the same context. The rest
 * is the contract every model class holds — plain data out, plain data back in,
 * nothing shared with the caller, and no transformation that mutates.
 */

/** A four-bar tune with a clear tonic, enough to read harmony and form from. */
const TUNE: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 1, velocity: 90 },
  { pitch: 64, startBeat: 1, durationBeat: 1, velocity: 80 },
  { pitch: 67, startBeat: 2, durationBeat: 2, velocity: 85 },
  { pitch: 65, startBeat: 4, durationBeat: 1, velocity: 80 },
  { pitch: 69, startBeat: 5, durationBeat: 1, velocity: 75 },
  { pitch: 72, startBeat: 6, durationBeat: 2, velocity: 95 },
  { pitch: 67, startBeat: 8, durationBeat: 1, velocity: 80 },
  { pitch: 71, startBeat: 9, durationBeat: 1, velocity: 78 },
  { pitch: 74, startBeat: 10, durationBeat: 2, velocity: 88 },
  { pitch: 72, startBeat: 12, durationBeat: 4, velocity: 92 },
];

/** The same tune opening with a pickup, so beat 0 is not where it starts. */
const WITH_PICKUP: NoteEvent[] = [{ pitch: 55, startBeat: -1, durationBeat: 1 }, ...TUNE];

/** A meter map that changes signature partway, for the bar-reading checks. */
const METERS: MeterMap = [
  { startBeat: 0, ts: parseTimeSignature('4/4') },
  { startBeat: 8, ts: parseTimeSignature('3/4') },
];

/** A tempo map that changes tempo partway, for the seconds-reading checks. */
const TEMPO: TempoMap = [
  { startBeat: 0, bpm: 120 },
  { startBeat: 4, bpm: 60 },
];

/** The score the equivalence checks are made against. */
function tune(): Score {
  return Score.of(TUNE);
}

describe('Score plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const score = tune();
    expect(score.data).not.toBe(score.data);
    expect(score.data).toEqual(score.data);
    expect(score.data.notes[0]).not.toBe(score.data.notes[0]);
    expect(score.notes).not.toBe(score.notes);
  });
});

describe('Score analysis', () => {
  const notes = tune().notes;

  it('names the key held longest, not the one the score opens on', () => {
    const regions = keyTimelineFromNotes(notes, { meters: tune().meters });
    const prevailing = prevailingKeyOf(regions);
    expect(prevailing).not.toBeNull();
    expect(keyIdentity(tune().key() as Key)).toEqual(prevailing);
    // A score with nothing sounding has no key to name.
    expect(Score.empty().key()).toBeUndefined();
    // A carried key is the key, without a search.
    expect(Score.of(TUNE, { key: 'Eb major' }).key()?.toString()).toBe('Eb major');
  });

  it('reads the hypermeter the hypermeter reader reads, on the score own cadences', () => {
    const timeline = chordTimelineFromNotes(notes, { meters: tune().meters }).timeline;
    const regions = keyTimelineFromNotes(notes, { meters: tune().meters });
    const keyAt = keyLookup(regions, prevailingKeyOf(regions) ?? keyIdentity(Key.major('C')));
    const cadenceBeats = detectCadences(timeline, (beat) => scaleOf(keyAt(beat))).map(
      (hit) => hit.atBeat,
    );
    expect(cadenceBeats.length).toBeGreaterThan(0);
    expect(tune().hypermeter()).toEqual(hypermeter(notes, tune().meters, { cadenceBeats }));
    expect(tune().hypermeter({ cadenceBeats: [8] })).toEqual(
      hypermeter(notes, tune().meters, { cadenceBeats: [8] }),
    );
  });

  it('reads each note against the harmony and the key under it', () => {
    const score = tune();
    const timeline = chordTimelineFromNotes(notes, { meters: score.meters }).timeline;
    const regions = keyTimelineFromNotes(notes, { meters: score.meters });
    const prevailing = prevailingKeyOf(regions);
    expect(prevailing).not.toBeNull();
    expect(score.voices()).toHaveLength(notes.length);
    // This tune is a single line, so the polyphonic reading the score makes and
    // the single-voice reader's answer are the same answer — down to the shape,
    // since the score answers about its own array and says nothing about having
    // taken it apart to read it.
    expect(score.voices()).toEqual(
      analyzeVoice(notes, timeline.at, (beat) =>
        scaleOf(keyLookup(regions, prevailing ?? keyIdentity(Key.major('C')))(beat)),
      ),
    );
    // A key given at the call reaches the analysis as one key for every beat.
    expect(score.voices('C major')).toEqual(analyzeVoice(notes, timeline.at, Key.major('C').scale));
    expect(score.withKey('C major').voices()).toEqual(score.voices('C major'));
  });
});

describe('Score note transformation', () => {
  it('leaves the original untouched and returns a new instance', () => {
    const score = Score.of(WITH_PICKUP, { meters: METERS, tempo: TEMPO, key: 'C major' });
    const before = score.data;
    const derived = [
      score.slice(0, 4),
      score.filter(() => true),
      score.map((note) => note),
      score.concat([{ pitch: 48, startBeat: 0, durationBeat: 1 }]),
      score.shift(2),
      score.transpose(1),
      score.transposeBy('m2'),
      score.quantize(0.5),
      score.humanize({ ctx: { seed: 3 } }),
      score.ornament({ ctx: { seed: 3 } }),
      score.withMeters(parseTimeSignature('3/4')),
      score.withTempo(90),
      score.withKey('G major'),
    ];
    for (const [index, other] of derived.entries()) {
      expect(other, `derived[${index}]`).toBeInstanceOf(Score);
      expect(other, `derived[${index}]`).not.toBe(score);
    }
    expect(score.data).toEqual(before);
  });
});
