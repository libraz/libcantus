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

`Note`, `Interval`, `Chord`, `Key`, and `Progression` are immutable. Methods that transform one return a new value, so the original key or chord remains unchanged.

## Analyze a short timeline

The functional API accepts note events. This example supplies four bars of block chords, finds their timeline and prevailing key, and labels each segment:

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

## Choose an import boundary

```ts
import { parseNote, parseTimeSignature } from '@libraz/libcantus/core';
import { majorKey, makeChord } from '@libraz/libcantus/theory';
import { detectKey } from '@libraz/libcantus/analyze';
import { generateMotif } from '@libraz/libcantus/generate';
import { Note, Key } from '@libraz/libcantus/model';
```

The root entry point re-exports these symbols, so subpaths are a packaging choice rather than a different API.

