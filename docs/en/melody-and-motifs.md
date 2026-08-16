# Melody and motifs

A motif is a short pattern that recurs, transformed. The library treats analysis and generation of motifs as the same vocabulary read in two directions: `relateMotifs` names the transformation between two statements, and `transformMotif` applies one.

## Contour

`melodicContour` reduces a line to its step directions and what they add up to:

```ts
import { melodicContour } from '@libraz/libcantus';

const arch = [60, 64, 67, 64, 60].map((pitch, i) => ({
  pitch,
  startBeat: i,
  durationBeat: 1,
}));

melodicContour(arch).shape; // 'arch'
melodicContour(arch).directions; // ['up', 'up', 'down', 'down']
melodicContour(arch).peakIndex; // 2
```

The shapes are `arch`, `ascending`, `descending`, `wave`, and `static`. The first four are the same vocabulary the motif generator's `contour` option uses, so a shape read from an existing line can be requested from the generator directly. `static` is the shape a generator is never asked for and an analysis meets regularly: a line that does not move. A line that dips and returns reads as `wave`, since the shared vocabulary has no separate name for an inverted arch.

## Finding motifs in a melody

```ts
import { extractMotifs } from '@libraz/libcantus';

const notes = [
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
  { pitch: 67, startBeat: 4, durationBeat: 1 },
  { pitch: 69, startBeat: 5, durationBeat: 1 },
  { pitch: 71, startBeat: 6, durationBeat: 1 },
];

const motifs = extractMotifs(notes);

motifs.length >= 1; // true
motifs[0]?.occurrences.length >= 2; // true
```

Each `Motif` carries its interval-and-rhythm pattern and every occurrence with its onset. The two phrases above are the same shape a fifth apart, so they are one motif with two occurrences rather than two motifs.

## Naming the relationship between two statements

```ts
import { majorKey, motifFromNotes, relateMotifs } from '@libraz/libcantus';

const subject = motifFromNotes([
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
]);
const answer = motifFromNotes([
  { pitch: 67, startBeat: 3, durationBeat: 1 },
  { pitch: 69, startBeat: 4, durationBeat: 1 },
  { pitch: 71, startBeat: 5, durationBeat: 1 },
]);

relateMotifs(subject, answer)?.kind; // 'transposition'
relateMotifs(subject, answer, majorKey(0))?.kind; // 'transposition'
```

The kinds are `repetition`, `transposition`, `tonalTransposition`, `inversion`, `retrograde`, `retrogradeInversion`, `augmentation`, and `diminution`. Passing a key allows `tonalTransposition` — a restatement that keeps scale degrees rather than exact intervals — to be distinguished from an exact one.

The relation also records whether the second statement begins where the first ends, which is what separates a sequence from a restatement elsewhere in the piece.

`compareMelodies` and `melodicSimilarity` answer the looser question of how alike two phrases are, for cases where no named transformation applies.

## Generating a motif

```ts
import { generateMotif, majorKey, motifToNoteEvents } from '@libraz/libcantus';

const cell = generateMotif({ key: majorKey(0), bars: 2, contour: 'arch', seed: 1 });
const notes = motifToNoteEvents(cell);

notes.length >= 1; // true
notes.every((note) => note.durationBeat > 0); // true
```

`generateMotif` returns a `MotifCell`, not note events. The two are separate because a cell is material and note events are placement: the same cell can be transformed, sequenced, and then placed, and `motifToNoteEvents` is the last step rather than the first.

`chord` constrains the motif to a chord as well as a key. `contour` picks the shape. The result is deterministic for a given seed, which defaults to 0.

## Transforming and developing

```ts
import { generateMotif, majorKey, transformMotif } from '@libraz/libcantus';

const cell = generateMotif({ key: majorKey(0), bars: 1, seed: 2 });
const inverted = transformMotif(cell, 'invert');
const retrograde = transformMotif(cell, 'retrograde');

inverted.notes.length; // cell.notes.length
retrograde.notes.length; // cell.notes.length
```

The transforms are `transposeDiatonic`, `transposeChromatic`, `invert`, `retrograde`, `augment`, `diminish`, and `sequence` — the same list `relateMotifs` reports, which is what lets a host round-trip between the two.

`developMotif` applies transformations across a chord timeline, so the developed material follows the harmony rather than repeating over it:

```ts
import { chordTimelineFromChords, developMotif, generateMotif, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 5, quality: 'maj', startBeat: 4 },
  ],
  8,
);

const developed = developMotif(generateMotif({ key, bars: 1, seed: 3 }), timeline, key, 2);

developed.notes.length >= 1; // true
```

The cell is tiled back to back to fill the requested span, and each note is then pulled to the nearest chord tone of the segment sounding at its onset, so the developed line spells the underlying harmony. `developMotif` returns a `MotifCell` like the other motif operations; call `motifToNoteEvents` when placement is wanted.

## Counter-melody and imitation

`imitate` restates a line at an interval and a delay, which is the canonic answer:

```ts
import { imitate, majorKey } from '@libraz/libcantus';

const lead = [0, 1, 2].map((beat) => ({ pitch: 60 + beat, startBeat: beat, durationBeat: 1 }));
const answer = imitate(lead, { atBeat: 2, interval: 'P5', key: majorKey(0) });

answer.length; // 3
answer[0]?.startBeat; // 2
```

`generateCounterMelody` writes a free second line against a melody and its harmony instead:

```ts
import { generateCounterMelody, majorKey, parseChordSymbol } from '@libraz/libcantus';

const melody = [
  { pitch: 72, startBeat: 0, durationBeat: 2 },
  { pitch: 71, startBeat: 2, durationBeat: 2 },
];

const counter = generateCounterMelody({
  melody,
  chordAt: () => parseChordSymbol('C'),
  key: majorKey(0),
  ctx: 5,
});

counter.length >= 1; // true
```

`chordAt` is a callback rather than a timeline so a host can answer from whatever it already has. Use `voiceIndependence` from [Counterpoint and part-writing](counterpoint-and-part-writing.md) to check that the result behaves as a second voice.

## Ornamentation

Ornamentation is a separate pass over existing material, so changing an ornament option does not regenerate the source line:

```ts
import { ornament, ORNAMENT_STYLES } from '@libraz/libcantus';

ORNAMENT_STYLES; // ['ghost', 'flam', 'drag', 'slide', 'accent']

const line = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.5,
  durationBeat: 0.5,
}));

ornament(line, { style: 'ghost', amount: 0.6, seed: 4 }).length; // 8
```

`ghost` softens weak-position notes, `accent` lifts strong-position ones, and `flam`, `drag`, and `slide` mark notes with the corresponding articulation. `amount` scales how many notes are affected; the choice is seeded, so the same options give the same result.
