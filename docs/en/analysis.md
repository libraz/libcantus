# Analysis

Analysis functions consume plain values and return structured reports. They keep the answer, the evidence used to choose it, and — in APIs that support it — the alternatives that were rejected.

Every result on this page is a reading supported by evidence, not a fact recovered from the notes. A UI that presents one should show the supporting figures and allow an override.

## Chord recognition

`Chord.detectBest` recognizes a chord from MIDI pitches. The functional entry points return match metadata instead of a class value:

```ts
import { Chord, detectChord, detectChordBest } from '@libraz/libcantus';

Chord.detectBest([60, 63, 67, 70])?.symbol(); // 'Cm7'

detectChordBest([60, 64, 67])?.rootPc; // 0

const match = detectChord([60, 64, 67])[0];
match?.quality; // 'maj'
match?.exact; // true
match?.inversion; // 0

detectChord([64, 67, 72])[0]?.inversion; // 1
```

`detectChordBest` returns a chord ready to use; `detectChord` returns ranked `ChordMatch` values, which is the entry point to reach for when the evidence matters as much as the answer. A `ChordMatch` reports `missingPcs` for chord tones absent from the input, `extraPcs` for input pitches outside the chord, and `exact` when the two sets agree. `inversion` is null when no inversion can be named — an unordered pitch-class set with no bass, or a bass that is not a chord tone, in which case `bassPc` still reports it.

`input` decides how the numbers are read: `midi` takes the numerically lowest pitch as the bass, `pitchClass` treats the input as unordered, and the default `auto` chooses pitch-class mode only when every value lies in 0..11.

## Key recognition

`detectKey` ranks keys from a weighted pitch-class distribution:

```ts
import { detectKey, detectKeyBest } from '@libraz/libcantus';

const histogram = [2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2];

detectKey(histogram, { modes: true })[0]?.scaleName; // 'dorian'
detectKeyBest(histogram)?.mode; // 'minor'
```

A `KeyMatch` carries the scale that scored best, the major or minor key it is closest to, which scale form it uses (`variant`), the exact name from `NAMED_SCALES`, and the score. `modes: true` puts the church modes in the running; without it the candidates are the major and the three minor forms.

`profile` chooses what the observed distribution is correlated against — `krumhansl` by default, `temperley` for corpus proportions, or `flat` for an unweighted comparison. `weights` says how much each pitch counts; `detectKeyFromNotes` supplies duration times velocity, which is how chord inference weighs its own histogram, and is the right entry point when the input is note events rather than a histogram.

## Timelines and cadences

`chordTimelineFromNotes` searches note events for chord segments and the key in force. `chordTimelineFromChords` accepts already-known roots and durations:

```ts
import { chordTimelineFromChords, chordToRoman, majorKey } from '@libraz/libcantus';

const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 5, quality: 'maj', startBeat: 4 },
    { rootPc: 7, quality: 'dom7', startBeat: 8 },
  ],
  12,
);

timeline.segments.length; // 3
timeline.segments.map((segment) => chordToRoman(segment.chord, majorKey(0)));
// ['I', 'IV', 'V7']
```

`chordTimelineFromNotes` returns more than the timeline: `keys` holds the key regions the analysis ran against, `prevailingKey` the one held longest, and `segmentConfidence` one value per segment in segment order. Omitting `key` is what lets a piece that modulates be analyzed against the key actually in force; supplying one yields a single region because the caller has already answered the question.

`detectCadence` labels a pair of chords, and `detectCadences` scans a whole timeline:

```ts
import { Chord, Key, detectCadence } from '@libraz/libcantus';

const key = Key.major('C').scale;
const g = Chord.of('G', 'maj').data;
const c = Chord.of('C', 'maj').data;

detectCadence(g, c, key).type; // 'authentic'
detectCadence(g, c, key).strength; // null
```

`strength` is null without a voicing that identifies the soprano. Supply one and an authentic cadence is graded as perfect or imperfect. A repeated V with no root motion is not reported as a cadence.

## Reduction and form

`reduceProgression` marks chords as `structural`, `passing`, or `auxiliary`, with a rationale:

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

`phrasesFromTimeline` uses cadences, rests, repetition, and hypermetric position to propose phrase boundaries, and each phrase records which of those signals contributed. `structuralCadences` ranks the phrase cadences. `hypermeter` finds metrical grouping above the bar, and `sectionsFromNotes` identifies repeated units as labels such as A and B — it does not claim that A is a verse.

## Modulation

`keyTimelineFromNotes` and `detectModulations` divide a piece into key regions, each with a confidence and, where the chords support one, a pivot. See [Key relations and modulation](key-relations-and-modulation.md).

## Melodic analysis

`melodicContour`, `extractMotifs`, `relateMotifs`, and `melodicSimilarity` cover repeated and transformed melodic material. See [Melody and motifs](melody-and-motifs.md).

## Arrangement reports

`analyzeArrangement` combines track roles, chord timelines, key regions, theory labels, tension, and conflicts between notes and the current harmony:

```ts
import { analyzeArrangement } from '@libraz/libcantus';

const report = analyzeArrangement([
  {
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
]);

report.timeline.segments.length >= 1; // true
Array.isArray(report.conflicts); // true
```

`tensionCurve` and `analyzeVoice` expose parts of that report when a complete arrangement result is unnecessary, and `toVoiceNotes` prepares a single track for voice-level analysis. `createArrangementSession` keeps an analysis open across edits; see [Performance](performance.md).
