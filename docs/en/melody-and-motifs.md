# Melody and motifs

A motif is a short pattern that recurs, transformed. The library treats analysis and generation of motifs as the same vocabulary read in two directions: naming the transformation between two statements, and applying one. A `Motif` holds a cell so the two directions chain — `relateTo` and `transform` are its methods — and `relateMotifs` and `transformMotif` are the same operations as functions over plain cells.

## Contour

A `Score` reduces its line to step directions and what they add up to:

```ts
import { Score } from '@libraz/libcantus';

const arch = Score.of(
  [60, 64, 67, 64, 60].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
);

arch.contour().shape; // 'arch'
arch.contour().directions; // ['up', 'up', 'down', 'down']
arch.contour().peakIndex; // 2
```

`melodicContour` is the same reading over a bare array of note events:

```ts
import { melodicContour } from '@libraz/libcantus';

const arch = [60, 64, 67, 64, 60].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));

melodicContour(arch).shape; // 'arch'
```

The shapes are `arch`, `ascending`, `descending`, `wave`, and `static`. The first four are the same vocabulary the motif generator's `contour` option uses, so a shape read from an existing line can be requested from the generator directly. `static` is the shape a generator is never asked for and an analysis meets regularly: a line that does not move. A line that dips and returns reads as `wave`, since the shared vocabulary has no separate name for an inverted arch.

A wave has to turn more than once to be heard as one, so the round trip through the generator is exact for `arch`, `ascending` and `descending` at any length, and for `wave` from three bars up. The one- and two-bar cells the generator writes for `wave` turn once and read back as `arch`.

## Finding motifs in a melody

```ts
import { Score } from '@libraz/libcantus';

const melody = Score.of([
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
  { pitch: 67, startBeat: 4, durationBeat: 1 },
  { pitch: 69, startBeat: 5, durationBeat: 1 },
  { pitch: 71, startBeat: 6, durationBeat: 1 },
]);

const motifs = melody.motifs();

motifs.length >= 1; // true
motifs[0]?.occurrences.length >= 2; // true
```

`extractMotifs` is the function behind it, and takes the note events directly:

```ts
import { extractMotifs } from '@libraz/libcantus';

const phrase = (from: number, at: number) =>
  [0, 2, 4].map((step, i) => ({ pitch: from + step, startBeat: at + i, durationBeat: 1 }));

extractMotifs([...phrase(60, 0), ...phrase(67, 4)]).length >= 1; // true
```

Each `MotifData` carries its interval-and-rhythm pattern and every occurrence with its onset. The two phrases above are the same shape a fifth apart, so they are one motif with two occurrences rather than two motifs.

## Naming the relationship between two statements

```ts
import { Motif } from '@libraz/libcantus';

const subject = Motif.fromNotes([
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
]);
const answer = Motif.fromNotes([
  { pitch: 67, startBeat: 3, durationBeat: 1 },
  { pitch: 69, startBeat: 4, durationBeat: 1 },
  { pitch: 71, startBeat: 5, durationBeat: 1 },
]);

subject.relateTo(answer)?.kind; // 'transposition'
subject.relateTo(answer, 'C major')?.kind; // 'transposition'
```

`motifFromNotes` reads a run of notes as a plain cell and `relateMotifs` compares two of them:

```ts
import { majorKey, motifFromNotes, relateMotifs } from '@libraz/libcantus';

const statement = (from: number, at: number) =>
  motifFromNotes(
    [0, 2, 4].map((step, i) => ({ pitch: from + step, startBeat: at + i, durationBeat: 1 })),
  );

const subject = statement(60, 0);
const answer = statement(67, 3);

relateMotifs(subject, answer)?.kind; // 'transposition'
relateMotifs(subject, answer, majorKey(0))?.kind; // 'transposition'
```

The kinds are `repetition`, `transposition`, `tonalTransposition`, `inversion`, `retrograde`, `retrogradeInversion`, `augmentation`, and `diminution`. Passing a key allows `tonalTransposition` — a restatement that keeps scale degrees rather than exact intervals — to be distinguished from an exact one.

The relation also records whether the second statement begins where the first ends, which is what separates a sequence from a restatement elsewhere in the piece.

`Motif.similarityTo` — `melodicSimilarity` as a function, with `compareMelodies` beside it — answers the looser question of how alike two phrases are, for cases where no named transformation applies.

## Generating a motif

```ts
import { Motif } from '@libraz/libcantus';

const cell = Motif.generate({ key: 'C major', bars: 2, contour: 'arch', ctx: { seed: 1 } });
const score = cell.toScore();

cell.notes.length >= 1; // true
score.notes.every((note) => note.durationBeat > 0); // true
```

A motif is material and a score is placement. The two are separate because the same cell can be transformed, sequenced, and only then placed, so `toScore` is the last step rather than the first — `generateMotif` and `motifToNoteEvents` draw the same line between a `MotifCell` and note events:

```ts
import { generateMotif, majorKey, motifToNoteEvents } from '@libraz/libcantus';

const cell = generateMotif({ key: majorKey(0), bars: 2, contour: 'arch', ctx: { seed: 1 } });
const notes = motifToNoteEvents(cell);

notes.length >= 1; // true
notes.every((note) => note.durationBeat > 0); // true
```

`chord` constrains the motif to a chord as well as a key. `contour` picks the shape. The result is deterministic for a given seed, which defaults to 0.

## Transforming and developing

```ts
import { Motif } from '@libraz/libcantus';

const cell = Motif.generate({ key: 'C major', bars: 1, ctx: { seed: 2 } });

cell.transform('invert').notes.length === cell.notes.length; // true
cell.transform('retrograde').notes.length === cell.notes.length; // true
cell.transform('transposeDiatonic', 1, 'C major').notes.length === cell.notes.length; // true
```

`transformMotif` takes the cell, the transformation, its amount, and the key the diatonic ones are read in:

```ts
import { generateMotif, majorKey, transformMotif } from '@libraz/libcantus';

const cell = generateMotif({ key: majorKey(0), bars: 1, ctx: { seed: 2 } });
const inverted = transformMotif(cell, 'invert');
const retrograde = transformMotif(cell, 'retrograde');

inverted.notes.length; // cell.notes.length
retrograde.notes.length; // cell.notes.length
```

The two directions use different names for the same devices, so the correspondence is spelled out rather than assumed:

| `transform` / `transformMotif` | `relateTo` / `relateMotifs` |
| --- | --- |
| `transposeDiatonic` | `tonalTransposition` with a key, `transposition` without one |
| `transposeChromatic` | `transposition` |
| `invert` | `inversion` |
| `retrograde` | `retrograde` |
| `augment` | `augmentation` |
| `diminish` | `diminution` |
| `sequence` | none |

`sequence` is the transform with no relation of its own: it appends a shifted copy, so the result carries twice the notes of the model and a relation, which compares statements note for note, answers null. Relate the two halves of the result instead — they stand as a `transposition` or a `tonalTransposition` whose `sequence` flag is set.

Two relations have no single transform behind them either: `repetition`, which is the cell restated unchanged, and `retrogradeInversion`, which is `retrograde` followed by `invert`.

Every transform returns its notes in ascending onset order, `retrograde` included: the cell comes back read backwards in time but listed forwards, which is what the analyses taking a melody expect. `invert` therefore mirrors about the note that sounds first, so `retrograde` followed by `invert` pivots on what became the earliest onset.

Because a motif holds its cell, naming the transform and reading it back is one expression:

```ts
import { Motif } from '@libraz/libcantus';

const model = Motif.fromNotes(
  [60, 64, 62, 67].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
);
const name = (t: 'invert' | 'retrograde' | 'transposeDiatonic') =>
  model.relateTo(model.transform(t, 2, 'C major'), 'C major')?.kind;

name('invert'); // 'inversion'
name('retrograde'); // 'retrograde'
name('transposeDiatonic'); // 'tonalTransposition'
```

The same round trip written with the functions has to name the cell again at every step:

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

Development applies transformations across a chord timeline, so the developed material follows the harmony rather than repeating over it:

```ts
import { Motif, Timeline } from '@libraz/libcantus';

const timeline = Timeline.fromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 5, quality: 'maj', startBeat: 4 },
  ],
  8,
  'C major',
);

const developed = Motif.generate({ key: 'C major', bars: 1, ctx: { seed: 3 } }).develop(
  timeline,
  'C major',
  2,
);

developed.notes.length >= 1; // true
```

The cell is tiled back to back to fill the requested span. The notes carrying structural weight — the head of each tile and every bar line — are pulled to the nearest chord tone of the segment sounding at that onset, so the developed line spells the underlying harmony, while the notes between them stay in the key as passing and neighbour tones. Two pitches that differ in the cell still differ in the development, so the result reads as the motif under a new harmony rather than as the chord itself.

`developMotif` is the function underneath, and hands back a `MotifCell` like the other motif operations; call `motifToNoteEvents` when placement is wanted:

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

const developed = developMotif(generateMotif({ key, bars: 1, ctx: { seed: 3 } }), timeline, key, 2);

developed.notes.length >= 1; // true
```

## Counter-melody and imitation

A composer writes a free second line against a melody and its harmony:

```ts
import { Composer, parseChordSymbol, Score } from '@libraz/libcantus';

const composer = Composer.of({ key: 'C major', seed: 5 });
const melody = Score.of([
  { pitch: 72, startBeat: 0, durationBeat: 2 },
  { pitch: 71, startBeat: 2, durationBeat: 2 },
]);

const counter = composer.counterMelody(melody, { chordAt: () => parseChordSymbol('C') });

counter.notes.length >= 1; // true
```

`generateCounterMelody` is the same generator with the melody, the key and the context named at the call:

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

`imitate` restates a line at an interval and a delay, which is the canonic answer. It has no class method of its own — it takes two lines and a distance rather than belonging to either:

```ts
import { imitate, majorKey } from '@libraz/libcantus';

const lead = [0, 1, 2].map((beat) => ({ pitch: 60 + beat, startBeat: beat, durationBeat: 1 }));
const answer = imitate(lead, { atBeat: 2, interval: 'P5', key: majorKey(0) });

answer.length; // 3
answer[0]?.startBeat; // 2
```

`answer: 'tonal'` counts scale degrees instead of semitones, and `invert` mirrors the subject about its first note before transposing. A pitch outside the key keeps its distance from the scale tone below it, mirrored along with everything else, so a chromatic passing note answers as one. Where the mirror puts such a note inside a diatonic semitone there is no room left for it and it lands on the scale tone there — a subject moving in chromatic steps throughout can answer with a pitch repeated, which is the point at which a real answer is the one to ask for. Notes that never sound are not copied, so the answer holds only sounding notes.

## Ornamentation

Ornamentation is a separate pass over existing material, so changing an ornament option does not regenerate the source line:

```ts
import { ORNAMENT_STYLES, Score } from '@libraz/libcantus';

ORNAMENT_STYLES; // ['ghost', 'flam', 'drag', 'slide', 'accent']

const line = Score.of(
  [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
    pitch,
    startBeat: i * 0.5,
    durationBeat: 0.5,
  })),
);

line.ornament({ style: 'ghost', amount: 0.6, ctx: { seed: 4 } }).notes.length; // 8
```

The same pass over a bare array is `ornament`:

```ts
import { ornament } from '@libraz/libcantus';

const line = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.5,
  durationBeat: 0.5,
}));

ornament(line, { style: 'ghost', amount: 0.6, ctx: { seed: 4 } }).length; // 8
```

`ghost` softens weak-position notes, `accent` lifts strong-position ones, `flam` marks the same strong positions `accent` takes, `drag` marks a weak-position note whose next onset falls on a strong one, and `slide` marks a note reached by a leap. `amount` scales how many notes are affected; the choice is seeded, so the same options give the same result. Notes that never sound are dropped, so the result can be shorter than the input.
