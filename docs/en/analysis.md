# Analysis

Analysis returns structured reports. They keep the answer, the evidence used to choose it, and — in APIs that support it — the alternatives that were rejected.

The class API asks these questions of a value: a `Chord` recognized from pitches, a `Timeline` that knows its own cadences, a `Score` that can name its phrases. The functional API takes the same plain data and returns the same reports. Neither is more capable than the other, so a page of analysis code can be written either way.

Every result on this page is a reading supported by evidence, not a fact recovered from the notes. A UI that presents one should show the supporting figures and allow an override.

## Chord recognition

`Chord.detectBest` recognizes a chord from MIDI pitches, and `Chord.detectMatches` keeps the evidence beside it:

```ts
import { Chord } from '@libraz/libcantus';

Chord.detectBest([60, 63, 67, 70])?.symbol(); // 'Cm7'

const [best] = Chord.detectMatches([60, 64, 67]);

best?.chord.symbol(); // 'C'
best?.match.quality; // 'maj'
best?.match.exact; // true
best?.match.inversion; // 0

Chord.detectMatches([64, 67, 72])[0]?.match.inversion; // 1
```

The functional entry points return the same rankings as plain data, without the class value on top:

```ts
import { detectChord, detectChordBest } from '@libraz/libcantus';

detectChordBest([60, 64, 67])?.rootPc; // 0

const match = detectChord([60, 64, 67])[0];
match?.quality; // 'maj'
match?.exact; // true
match?.inversion; // 0

detectChord([64, 67, 72])[0]?.inversion; // 1
```

`detectChordBest` and `Chord.detectBest` return a chord ready to use; `detectChord` and `Chord.detectMatches` return ranked `ChordMatch` values, which is what to reach for when the evidence matters as much as the answer. A `ChordMatch` reports `missingPcs` for chord tones absent from the input, `extraPcs` for input pitches outside the chord, and `exact` when the two sets agree. `inversion` is null when no inversion can be named — an unordered pitch-class set with no bass, or a bass that is not a chord tone, in which case `bassPc` still reports it.

`input` decides how the numbers are read: `midi` takes the numerically lowest pitch as the bass, `pitchClass` treats the input as unordered, and the default `auto` chooses pitch-class mode only when every value lies in 0..11.

## Key recognition

`Key.detectBest` and `Key.detectMatches` rank keys from a weighted pitch-class distribution:

```ts
import { Key } from '@libraz/libcantus';

const histogram = [2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2];

Key.detectMatches(histogram, { modes: true })[0]?.scaleName; // 'dorian'
Key.detectBest(histogram)?.toString(); // 'D melodic minor'
```

`detectKey` and `detectKeyBest` are the functions behind them, and answer with the plain key/scale rather than a `Key`:

```ts
import { detectKey, detectKeyBest } from '@libraz/libcantus';

const histogram = [2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2];

detectKey(histogram, { modes: true })[0]?.scaleName; // 'dorian'
detectKeyBest(histogram)?.mode; // 'minor'
```

A `KeyMatch` carries the scale that scored best, the major or minor key it is closest to, which scale form it uses (`variant`), the exact name from `NAMED_SCALES`, and the score. `Key.detectMatches` reports all of it, with the key itself as a `Key`; a detected `Key` keeps the scale form it was matched under, which is why the one above names itself melodic rather than just minor. `modes: true` puts the church modes in the running; without it the candidates are the major and the three minor forms.

`profile` chooses what the observed distribution is correlated against — `krumhansl` by default, `temperley` for corpus proportions, or `flat` for an unweighted comparison. `weights` says how much each pitch counts; `detectKeyFromNotes` supplies duration times velocity, which is how chord inference weighs its own histogram, and is the right entry point when the input is note events rather than a histogram. `Score.key()` goes further and answers with the key held longest across a whole piece.

## Timelines and cadences

A `Timeline` is harmony that keeps its place in time. `Timeline.fromChords` places chords whose roots and onsets are already known, and `Score.timeline()` or `Timeline.fromNotes` search note events for the segments and the key in force:

```ts
import { Chord, Key, Timeline } from '@libraz/libcantus';

const timeline = Timeline.fromChords(
  [Chord.parse('C').span(0), Chord.parse('F').span(4), Chord.parse('G7').span(8)],
  12,
  Key.major('C'),
);

timeline.length; // 3
timeline.at(9)?.symbol(); // 'G7'
timeline.roman().map((entry) => entry.roman);
// ['I', 'IV', 'V7']
```

`chordTimelineFromChords` is the function underneath, taking the spans as plain data:

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

`chordTimelineFromNotes` returns more than the timeline: `keys` holds the key regions the analysis ran against, `prevailingKey` the one held longest, and `segmentConfidence` one value per segment in segment order. A `Timeline` carries all three: `timeline.keys`, `timeline.key`, and `timeline.segmentConfidence`. Omitting `key` is what lets a piece that modulates be analyzed against the key actually in force; supplying one yields a single region because the caller has already answered the question.

`timeline.cadences()` labels every arrival across a whole span, each with the beat it lands on:

```ts
import { Chord, Key, Timeline } from '@libraz/libcantus';

const timeline = Timeline.fromChords(
  [Chord.parse('C').span(0), Chord.parse('G').span(4), Chord.parse('C').span(8)],
  12,
  Key.major('C'),
);

const hits = timeline.cadences();

hits.map((hit) => hit.cadence.type); // ['half', 'authentic']
hits[1]?.atBeat; // 8
```

`detectCadence` labels one pair of chords, and `detectCadences` is what the timeline runs over its own segments:

```ts
import { Chord, Key, detectCadence } from '@libraz/libcantus';

const key = Key.major('C').scale;
const g = Chord.of('G', 'maj').data;
const c = Chord.of('C', 'maj').data;

detectCadence(g, c, key).type; // 'authentic'
detectCadence(g, c, key).strength; // null
```

`strength` is null without a voicing that identifies the soprano. Supply one and an authentic cadence is graded as perfect or imperfect. A repeated V with no root motion is not reported as a cadence. `Progression.cadences` is the untimed counterpart, reading one cadence per adjacent pair.

Cadences are measured against the degrees the key actually has, not against fixed semitone distances: a mode resolves deceptively onto its own submediant, and where its dominant carries no leading tone — the `v` of aeolian or dorian — an arrival on that dominant is a half cadence too. A major key keeps its leading tone, so a borrowed minor `v` there is not one.

A cadential six-four is the dominant, not an inverted tonic: its bass has already arrived and the notes above it resolve down onto the dominant's own. Pass the chord before the dominant as `approach` and the cadence is reported as the one event it is — the type and the beat stay with the dominant's resolution, and the rationale says the cadence began at the six-four. A six-four the bass leaves, as in `IV–I64–IV`, is an ordinary inverted tonic and reads as one.

## Reduction and form

`timeline.reduce()` marks chords as `structural`, `passing`, or `neighbor` — the two embellishing figures spelled the way `analyzeVoice` spells them for a note, so one legend covers both levels — with a rationale, and with the beats each chord holds:

```ts
import { Chord, Key, Timeline } from '@libraz/libcantus';

const timeline = Timeline.fromChords(
  [Chord.parse('Cmaj7').span(0), Chord.parse('C#dim7').span(4), Chord.parse('Dm7').span(8)],
  12,
  Key.major('C'),
);

timeline.reduce().map((entry) => entry.level);
// ['structural', 'passing', 'structural']
```

The reading needs a key, so a timeline built without one — `Timeline.fromChords` with no third argument — refuses rather than guessing. `reduceProgression` is the function, and takes the key as its own argument:

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

A `Score` answers the form questions from the notes it holds: `phrases()` uses cadences, rests, repetition, and hypermetric position to propose phrase boundaries, and each phrase records which of those signals contributed; `hypermeter()` finds metrical grouping above the bar; `sections()` identifies repeated units as labels such as A and B — it does not claim that A is a verse. The functions behind them are `phrasesFromTimeline`, `hypermeter`, and `sectionsFromNotes`, which take the notes and the chord timeline separately. `structuralCadences` ranks the phrase cadences.

## Modulation

`Score.keys()`, `keyTimelineFromNotes`, and `detectModulations` divide a piece into key regions, each with a confidence and, where the chords support one, a pivot. See [Key relations and modulation](key-relations-and-modulation.md).

## Melodic analysis

`Score.motifs()` and `Score.contour()` cover repeated and transformed melodic material, and a `Motif` compares itself with another through `relateTo` and `similarityTo`. As functions: `melodicContour`, `extractMotifs`, `relateMotifs`, and `melodicSimilarity`. See [Melody and motifs](melody-and-motifs.md).

## Arrangement reports

An `Arrangement` reads several tracks together. It combines chord timelines, key regions, theory labels, and conflicts between notes and the current harmony, and answers with a class where it has one — `timeline()` hands back a `Timeline`, `track(name)` a `Score`:

```ts
import { Arrangement } from '@libraz/libcantus';

const arrangement = Arrangement.of([
  {
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
]);

arrangement.timeline().at(0)?.symbol(); // 'C'
Array.isArray(arrangement.conflicts); // true
```

`analyzeArrangement` is the whole of that reading as one call. The report carries `keys` and `prevailingKey`, the `timeline` with its `segmentConfidence`, the `cadences`, the per-track annotations in `tracks`, and the `conflicts` — tension is a separate reading, from `tensionCurve`:

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

`tensionCurve` and `analyzeVoice` expose parts of that report when a complete arrangement result is unnecessary, and `toVoiceNotes` prepares a single track for voice-level analysis; `Arrangement.tension` and `Score.voices` are the same two readings from the class side. `createArrangementSession` keeps an analysis open across edits, which is what `Arrangement.update` uses; see [Performance](performance.md).

The ornament figures `analyzeVoice` names — passing, neighbour, suspension, appoggiatura, anticipation, escape — are the words `classifyMelodyTones` uses for the same notes, so one melody read through the analysis and through the harmonizer comes back under one vocabulary; `analyzeVoice` reads the melodic shape alone, without the metre the other one also weighs, so it names a figure in fewer places rather than under a different name.
