# Getting started

## Requirements and installation

Use Node.js 22 or later.

```sh
yarn add @libraz/libcantus
```

The package has no runtime dependencies. Import from the root for convenience, or from a layer subpath when a smaller import boundary is useful.

## Build and inspect a chord

The class API is a compact way to build values and ask questions about them:

```ts
import { Chord, Key } from '@libraz/libcantus';

const key = Key.major('C');
const dominant = key.chord(5, 'dom7');

dominant.symbol(); // 'G7'
dominant.pitchClasses(); // [2, 5, 7, 11]
dominant.analyze(key).roman; // 'V7'
Chord.parse('C7(b9,#11)').pitchClasses(); // [0, 1, 4, 6, 7, 10]
```

Every class in the model layer is immutable, a whole `Score` or `Composer` as much as a single `Note`. Methods that transform one return a new value, so the original key or chord remains unchanged.

The same values exist as plain data, which is what the functional API takes:

```ts
import { Chord, chordToRoman, majorKey } from '@libraz/libcantus';

const g7 = Chord.of('G', 'dom7');

g7.data.rootPc; // 7
chordToRoman(g7.data, majorKey(0)); // 'V7'
```

## Analyze a short timeline

A `Score` is note events together with the context they are read against, and the questions you would ask of a piece are its methods. This example supplies four bars of block chords, reads their harmony, and labels each segment:

```ts
import { Score } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

Score.of(notes)
  .timeline()
  .roman()
  .map((entry) => entry.roman);
// ['I', 'IV', 'V7', 'I']
```

Every class here is a thin skin over the functional core, so the same reading is available a function at a time. Which style you write is a preference, not a capability:

```ts
import { chordTimelineFromNotes, chordToRoman } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, prevailingKey } = chordTimelineFromNotes(notes);
timeline.segments.map((segment) => chordToRoman(segment.chord, prevailingKey));
// ['I', 'IV', 'V7', 'I']
```

Chord boundaries are inferred from the events. If the piece modulates, the result can contain more than one key region; it does not require the caller to choose the opening key first.

A segment carries its span and its chord; the confidence of each reading arrives alongside, in `segmentConfidence`, one value per segment in segment order:

```ts
import { chordTimelineFromNotes } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [43, 59, 62, 65]].flatMap((pitches, bar) =>
  pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, segmentConfidence, keys } = chordTimelineFromNotes(notes);

timeline.segments[0]?.startBeat; // 0
timeline.segments[0]?.endBeat; // 4
segmentConfidence.length === timeline.segments.length; // true
keys.length >= 1; // true
```

`keys` holds the key regions the analysis ran against, and `prevailingKey` is the one held longest — the key to print on a signature or hand to a generator that takes a single key.

## Generate something against it

A `Composer` holds what one piece is written under — its key, tempo, and seed — so each part inherits those instead of restating them. A progression comes back as a `Timeline`, the same value the analysis section read:

```ts
import { Composer } from '@libraz/libcantus';

const composer = Composer.of({ key: 'C major', bpm: 120, seed: 9 });
const plan = composer.progression({ style: 'idol', bars: 4 });

plan.totalBeats; // 16
plan.roman().map((entry) => entry.roman); // ['vi', 'ii', 'V', 'I']
```

The generator underneath takes the same data and a seed. The same seed always gives the same notes:

```ts
import { generateProgression, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const a = generateProgression({ key, style: 'idol', bars: 4, ctx: { seed: 9 } });
const b = generateProgression({ key, style: 'idol', bars: 4, ctx: { seed: 9 } });

a.length; // 4
JSON.stringify(a) === JSON.stringify(b); // true
```

## Choose an import boundary

```ts
import { parseNote, parseTimeSignature } from '@libraz/libcantus/core';
import { majorKey, makeChord } from '@libraz/libcantus/theory';
import { detectKey } from '@libraz/libcantus/analyze';
import { generateMotif } from '@libraz/libcantus/generate';
import { Note, Key } from '@libraz/libcantus/model';
```

The root entry point re-exports these symbols, so subpaths are a packaging choice rather than a different API.

## Next steps

- [Use cases](use-cases/index.md) shows complete flows for a DAW assistant, a harmony exercise checker, a piece analyzer, and a generative arrangement.
- [Introduction](introduction.md) explains the data model and what the engine assumes.
- The generated TypeDoc reference covers every symbol; see [API reference](api-reference.md).
