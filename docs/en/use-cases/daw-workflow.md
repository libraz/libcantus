# Use case: a DAW harmony assistant

Use this flow after a DAW, piano roll, or MIDI parser has supplied timed notes. Flatten the tracks that contribute to harmony, infer a chord timeline, then generate material against it.

```ts
import { chordTimelineFromNotes, chordToRoman, detectCadences, generateBassLine } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, prevailingKey, keys, segmentConfidence } = chordTimelineFromNotes(notes, {
  harmonicRhythm: 1,
});

const labels = timeline.segments.map((segment) => chordToRoman(segment.chord, prevailingKey));
const cadences = detectCadences(timeline, prevailingKey);
const bass = generateBassLine({
  segments: timeline.segments,
  key: prevailingKey,
  style: 'walking',
  ctx: { seed: 7, bpm: 100 },
});

labels; // ['I', 'IV', 'V7', 'I']
keys.length >= 1; // true
segmentConfidence.length === timeline.segments.length; // true
bass.length >= 1; // true
cadences.length >= 0; // true
```

## Reading the result

`timeline.segments` gives the start beat, end beat, and inferred chord of each span. The confidence of each reading is in `segmentConfidence`, in segment order — show it, because chord recognition is evidence-based rather than a guarantee, and sparse or deliberately ambiguous material produces low-confidence readings.

`keys` records the local key readings. Present it when a user needs to inspect a modulation rather than a single global label; `prevailingKey` is the label to print when only one is wanted.

`timeline.segments` is also the input shape `generateBassLine` expects, which is why the generated line follows the inferred harmony without any conversion step.

## Feeding the analysis correctly

- Give a `MeterMap` when the song changes meter, and `pickupBeats` when notes begin before beat zero.
- Feed only sounding notes. Zero and negative durations are ignored, and `dropSilentNotes` applies that policy explicitly after an import.
- Set `harmonicRhythm` to the chord rate the song actually uses. Too fine a value fragments a held chord; too coarse a value merges a real change.
- Flatten only the tracks that carry harmony. A melody or a drum track fed into chord inference will move the result.

## Presenting it

Use the generated `bass` as a new track, not as a replacement for the user's notes. Preserve the original events and expose the inferred result for correction: a label the user can fix is more useful than one that looks authoritative and is wrong.

For an editor that re-analyzes after every change, hold a `createArrangementSession` instead of calling `analyzeArrangement` repeatedly; see [Performance](../performance.md).
