# Use case: reading a piece

A `Score` is the notes together with the context they are read against, and every question below is a single method call — on the score, or on the timeline the score hands back. Start with that timeline: it establishes the harmonic units that reduction, cadence, phrase, and form analysis all work from.

The flow assumes note events and, where it is known, a meter; the key, the chords and every boundary below are read from them. For the vocabulary — chord, cadence, reduction, phrase, motif — see the [primer](../primer/index.md).

```ts
import { Score } from '@libraz/libcantus';

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
const score = Score.of(
  bars.flatMap((pitches, bar) =>
    pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
  ),
);

const timeline = score.timeline();

score.key()?.toString(); // 'C major'
timeline.roman().map((entry) => entry.roman); // ['I', 'IV', 'V', 'I', 'IV', 'V', 'I']
timeline.cadences().map((hit) => [hit.atBeat, hit.cadence.type]);
// [[8, 'half'], [12, 'authentic'], [24, 'half'], [28, 'authentic']]

const reduction = timeline.reduce();
const phrases = score.phrases();
const sections = score.sections({ unitBars: 4 });
const motifs = score.filter((note) => note.pitch >= 60).motifs();

reduction.length === timeline.length; // true
phrases.length >= 1; // true
sections.length >= 1; // true
motifs.length >= 1; // true
```

Eight bars give seven numerals: the tonic held across bars 4 and 5 is one segment, because the timeline follows the harmony rather than the bar lines. The timeline also carries its own key regions, so `reduce` and `cadences` read every chord in the key it actually sounds in, and nothing has to be threaded from one call to the next.

## What each layer answers

`reduce` marks every chord `structural`, `passing`, or `neighbor`, records why, and carries the beats each chord holds. It is the layer that separates the harmony a listener hears as the skeleton from the chords that connect it.

`cadences` reports each arrival with the beat it lands on, which is what a timed reading holds that a chord pair does not.

`phrases` combines cadence, rests, repetition, and hypermetric position, and each phrase records which of those signals contributed. Showing the signals is what lets a user judge a boundary rather than accept it. The cadences come from the score's own harmony, so the chord timeline does not have to be built and passed in.

`sections` identifies repeated units and labels them A, B, and so on. It does not claim that A is a verse — that is a decision about the song, not a property of the notes.

`motifs` answers a different question from all three: which short melodic patterns recur, and how. Read it off a melodic line rather than the full texture — `Score.filter` narrows the score to one while keeping its meter, tempo, and key. Wrapping two statements with `Motif.fromNotes` lets `relateTo` name the transformation between them.

`hypermeter` and `contour` sit alongside them on the same score, for the bar-level pulse and the shape the melody traces.

## Getting the input right

Give the score its meter when it is known — `Score.of(notes, { meters })` — and every method reads against it. Bar positions and hypermeter both follow from the meter, and an analysis run in the wrong signature produces plausible-looking nonsense.

For a piece that modulates, read `timeline.keys` rather than assuming the prevailing key holds throughout. `score.key()` is the one to print on a signature, not the one to analyze every bar against. See [Modulation report](modulation-report.md).

## Presenting it

Treat every result as an analysis aid. Phrase and section boundaries are proposals from observable signals, so a UI should show the contributing signals and allow edits. A reduction level and a cadence type both come with a rationale — display it, since the reasoning is what makes the label useful to a musician.
