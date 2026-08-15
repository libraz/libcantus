# Analysis

Analysis functions consume plain values and return structured reports. They keep the answer, the evidence used to choose it, and—in APIs that support it—the alternatives that were rejected.

## Chord and key recognition

`Chord.detectBest` recognizes a chord from MIDI pitches. `detectKey` ranks keys from a weighted pitch-class distribution; `modes: true` includes named church modes in the candidates.

```ts
import { Chord, detectKey } from '@libraz/libcantus';

Chord.detectBest([60, 63, 67, 70])?.symbol(); // 'Cm7'
detectKey([2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2], { modes: true })[0].scaleName;
// 'dorian'
```

Use `detectChord`, `detectChordBest`, `detectKeyBest`, and `detectKeyFromNotes` when the plain match metadata is more useful than a class value. A key match includes a score and the profile that produced it.

## Timelines and cadences

`chordTimelineFromNotes` searches note events for chord segments and a prevailing key. `chordTimelineFromChords` accepts already-known roots and durations. `chordToRoman` and `detectCadence` can then label the harmonic path:

```ts
import { Chord, Key, detectCadence } from '@libraz/libcantus';

const key = Key.major('C').scale;
const g = Chord.of('G', 'maj').data;
const c = Chord.of('C', 'maj').data;

detectCadence(g, c, key).type; // 'authentic'
detectCadence(g, c, key).strength; // null without a voicing that identifies the soprano
```

When a voicing is supplied, an authentic cadence can be graded as perfect or imperfect. A repeated V with no root motion is not reported as a cadence.

## Reduction and form

`reduceProgression` marks chords as `structural`, `passing`, or `auxiliary`, with a rationale. `phrasesFromTimeline` uses cadences, rests, repetition, and hypermetric position to propose phrase boundaries; `structuralCadences` ranks those phrase cadences. `hypermeter` and `sectionsFromNotes` provide lower-level form analysis.

```ts
import { chordTimelineFromChords, majorKey, reduceProgression } from '@libraz/libcantus';

const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj7', startBeat: 0 },
    { rootPc: 1, quality: 'dim7', startBeat: 4 },
    { rootPc: 2, quality: 'min7', startBeat: 8 },
  ],
  12,
);

reduceProgression(timeline, majorKey(0)).map((entry) => entry.level);
// ['structural', 'passing', 'structural']
```

## Arrangement reports

`analyzeArrangement` combines track roles, chord timelines, key regions, theory labels, and conflict reports. `tensionCurve` and `analyzeVoice` expose parts of that report when a complete arrangement result is unnecessary.

