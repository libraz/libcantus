# Use case: a DAW harmony assistant

Use this flow after a DAW, piano roll, or MIDI parser has supplied timed notes. Wrap the tracks that contribute to harmony as a `Score`, read the chord timeline off it, then write material against that timeline.

```ts
import { Composer, Score } from '@libraz/libcantus';

const notes = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const score = Score.of(notes, { tempo: 100 });
const harmony = score.timeline({ harmonicRhythm: 1 });

harmony.roman().map((entry) => entry.roman); // ['I', 'IV', 'V7', 'I']
harmony.key?.toString(); // 'C major'
harmony.keys.length; // 1
harmony.segmentConfidence; // [1, 1, 1, 1]
harmony.cadences().map((hit) => [hit.atBeat, hit.cadence.type]);
// [[8, 'half'], [12, 'authentic']]

const bass = Composer.of({ key: harmony.key, bpm: 100, seed: 7 }).bass(harmony, {
  style: 'walking',
});

bass.notes.length; // 16
```

## Reading the result

`harmony.segments` gives the start beat, end beat, and inferred chord of each span, and `harmony.at(beat)` answers with the chord sounding at one moment — the query a piano-roll cursor makes. The numerals come back with the same spans attached, so a label can be drawn over the bar it belongs to.

A timeline carries the key regions it was read against. `harmony.keys` is the list, for a user inspecting a modulation; `harmony.key` is the one held longest, which is the label to print when only one is wanted. It is also the key to hand a generator: the analysis is where the key is read from, not something that travels downstream on its own. A `Composer` writes in the key it holds and takes only the chords off the timeline it is given, so `harmony.key` goes into `Composer.of` above.

The confidence of each reading travels with the chords. `harmony.segmentConfidence` holds one value per segment, in segment order, and four unambiguous triads all read at 1. Show it — chord recognition is evidence-based rather than a guarantee, and sparse or deliberately ambiguous material comes back lower:

```ts
import { Score } from '@libraz/libcantus';

// Two bare tritones: nothing in them settles which root they belong to.
const notes = [[60, 66], [63, 69]].flatMap((pitches, bar) =>
  pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const timeline = Score.of(notes).timeline({ harmonicRhythm: 1 });

timeline.segmentConfidence.length === timeline.length; // true
timeline.segmentConfidence; // [0.425, 0.425]
```

## Feeding the analysis correctly

- Give the score its `meters` when the song changes meter, and its `tempo` when seconds matter; both stay with the score and reach every analysis made from it. `pickupBeats` belongs to the timeline options, for notes that begin before beat zero.
- Feed only sounding notes. Zero and negative durations are ignored, and `score.filter` drops them explicitly after an import.
- Set `harmonicRhythm` to the chord rate the song actually uses. Too fine a value fragments a held chord; too coarse a value merges a real change.
- Pool only the tracks that carry harmony. A melody or a drum track fed into chord inference will move the result.

## An editor that re-analyzes

A host holding several tracks at once has `Arrangement` instead: one harmony inferred from every pitched track pooled, each track annotated against it, and the notes that clash with the chord beneath them collected as conflicts. `update` recomputes only the beats an edit could have reached, so a re-analysis on every keystroke costs what the edit touched rather than what the song contains:

```ts
import { Arrangement } from '@libraz/libcantus';

const bar = (pitch: number, index: number) => ({ pitch, startBeat: index * 4, durationBeat: 4 });
const keys = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, index) => pitches.map((pitch) => bar(pitch, index)),
);

const arrangement = Arrangement.of(
  [
    { name: 'keys', role: 'harmony', notes: keys },
    { name: 'lead', role: 'melody', notes: [72, 72, 74, 72].map(bar) },
  ],
  { key: 'C major' },
);

arrangement.timeline().roman().map((entry) => entry.roman); // ['I', 'IV', 'V7', 'I']
arrangement.conflicts.length; // 2

const edited = arrangement.update([{ trackIndex: 1, notes: [72, 73, 74, 72].map(bar) }]);

edited.tracks[1]?.notes[1]?.pitch; // 73
arrangement.tracks[1]?.notes[1]?.pitch; // 72
```

An arrangement never changes, so the reading taken before an edit stays valid — keep it for undo, or to show what a change did.

## Presenting it

Use the generated bass as a new track, not as a replacement for the user's notes. Preserve the original events and expose the inferred result for correction: a label the user can fix is more useful than one that looks authoritative and is wrong.

Conflicts are a report, not a fault list. Every ordinary non-chord tone — a passing note, a neighbour, a prepared suspension — is dissonant against the chord under it by definition, and each conflict carries the labels that tell those apart from a note that is simply wrong.

For the cost of holding an analysis open across edits, see [Performance](../performance.md).
