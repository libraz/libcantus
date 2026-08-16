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

A wave has to turn more than once to be heard as one, so the round trip through the generator is exact for `arch`, `ascending` and `descending` at any length, and for `wave` from three bars up. The one- and two-bar cells `generateMotif` writes for `wave` turn once and read back as `arch`.

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

Each `MotifData` carries its interval-and-rhythm pattern and every occurrence with its onset. The two phrases above are the same shape a fifth apart, so they are one motif with two occurrences rather than two motifs.

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

The two directions use different names for the same devices, so the correspondence is spelled out rather than assumed:

| `transformMotif` | `relateMotifs` |
| --- | --- |
| `transposeDiatonic` | `tonalTransposition` with a key, `transposition` without one |
| `transposeChromatic` | `transposition` |
| `invert` | `inversion` |
| `retrograde` | `retrograde` |
| `augment` | `augmentation` |
| `diminish` | `diminution` |
| `sequence` | none |

`sequence` is the transform with no relation of its own: it appends a shifted copy, so the result carries twice the notes of the model and `relateMotifs`, which compares statements note for note, answers null. Relate the two halves of the result instead — they stand as a `transposition` or a `tonalTransposition` whose `sequence` flag is set.

Two relations have no single transform behind them either: `repetition`, which is the cell restated unchanged, and `retrogradeInversion`, which is `retrograde` followed by `invert`.

```ts
import {
  majorKey,
  motifFromNotes,
  motifToNoteEvents,
  relateMotifs,
  transformMotif,
} from '@libraz/libcantus';

const key = majorKey(0);
const figure = {
  notes: [60, 64, 62, 67].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
};
const model = motifFromNotes(motifToNoteEvents(figure));
const name = (t: 'invert' | 'retrograde' | 'transposeDiatonic') =>
  relateMotifs(model, motifFromNotes(motifToNoteEvents(transformMotif(figure, t, 2, key))), key)
    ?.kind;

name('invert'); // 'inversion'
name('retrograde'); // 'retrograde'
name('transposeDiatonic'); // 'tonalTransposition'
```

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

The cell is tiled back to back to fill the requested span. The notes carrying structural weight — the head of each tile and every bar line — are pulled to the nearest chord tone of the segment sounding at that onset, so the developed line spells the underlying harmony, while the notes between them stay in the key as passing and neighbour tones. Two pitches that differ in the cell still differ in the development, so the result reads as the motif under a new harmony rather than as the chord itself. `developMotif` returns a `MotifCell` like the other motif operations; call `motifToNoteEvents` when placement is wanted.

## Counter-melody and imitation

`imitate` restates a line at an interval and a delay, which is the canonic answer:

```ts
import { imitate, majorKey } from '@libraz/libcantus';

const lead = [0, 1, 2].map((beat) => ({ pitch: 60 + beat, startBeat: beat, durationBeat: 1 }));
const answer = imitate(lead, { atBeat: 2, interval: 'P5', key: majorKey(0) });

answer.length; // 3
answer[0]?.startBeat; // 2
```

A `'tonal'` answer counts scale degrees instead of semitones, and `invert` mirrors the subject about its first note before transposing. A pitch outside the key keeps its distance from the scale tone below it, mirrored along with everything else, so a chromatic passing note answers as one. Where the mirror puts such a note inside a diatonic semitone there is no room left for it and it lands on the scale tone there — a subject moving in chromatic steps throughout can answer with a pitch repeated, which is the point at which a real answer is the one to ask for. Notes that never sound are not copied, so the answer holds only sounding notes.

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

`ghost` softens weak-position notes, `accent` lifts strong-position ones, `flam` marks the same strong positions `accent` takes, `drag` marks a weak-position note whose next onset falls on a strong one, and `slide` marks a note reached by a leap. `amount` scales how many notes are affected; the choice is seeded, so the same options give the same result. Notes that never sound are dropped, so the result can be shorter than the input.
