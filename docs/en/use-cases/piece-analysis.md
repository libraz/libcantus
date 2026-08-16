# Use case: reading a piece

Start with a timeline. It establishes the harmonic units that reduction, cadence, phrase, and form analysis all work from.

```ts
import {
  chordTimelineFromNotes,
  extractMotifs,
  phrasesFromTimeline,
  reduceProgression,
  sectionsFromNotes,
} from '@libraz/libcantus';

const bars = [
  [48, 60, 64, 67],
  [41, 60, 65, 69],
  [43, 59, 62, 67],
  [48, 60, 64, 67],
  [48, 60, 64, 67],
  [41, 60, 65, 69],
  [43, 59, 62, 67],
  [48, 60, 64, 67],
];
const notes = bars.flatMap((pitches, bar) =>
  pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, prevailingKey } = chordTimelineFromNotes(notes);
const reduction = reduceProgression(timeline, prevailingKey);
const phrases = phrasesFromTimeline(timeline, notes);
const sections = sectionsFromNotes(notes, { unitBars: 4 });
const motifs = extractMotifs(notes.filter((note) => note.pitch >= 60));

reduction.length === timeline.segments.length; // true
phrases.length >= 1; // true
sections.length >= 1; // true
Array.isArray(motifs); // true
```

## What each layer answers

`reduction` marks every chord `structural`, `passing`, or `auxiliary` and records why. It is the layer that separates the harmony a listener hears as the skeleton from the chords that connect it.

`phrases` combines cadence, rests, repetition, and hypermetric position, and each phrase records which of those signals contributed. Showing the signals is what lets a user judge a boundary rather than accept it.

`sections` identifies repeated units and labels them A, B, and so on. It does not claim that A is a verse — that is a decision about the song, not a property of the notes.

`extractMotifs` answers a different question from all three: which short melodic patterns recur, and how. Feed it a melodic line rather than the full texture; `relateMotifs` then names the transformation between two statements.

## Getting the input right

Provide the meter map when it is known. Bar positions and hypermeter both follow from it, and an analysis run in the wrong signature produces plausible-looking nonsense.

For a piece that modulates, read `keys` from the timeline result rather than assuming `prevailingKey` holds throughout. See [Modulation report](modulation-report.md).

## Presenting it

Treat every result as an analysis aid. Phrase and section boundaries are proposals from observable signals, so a UI should show the contributing signals and allow edits. A reduction level and a cadence type both come with a rationale — display it, since the reasoning is what makes the label useful to a musician.
