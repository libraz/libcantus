# Time and arrangement

## Meter and position

Time-dependent analysis accepts a `MeterMap`, an array of `{ startBeat, ts }` changes. Passing one `TimeSignature` is shorthand for a map with one entry. Beat 0 is the downbeat; a pickup can begin at a negative beat.

```ts
import { formatBarPosition, metricWeight, parseTimeSignature } from '@libraz/libcantus';

const meters = [
  { startBeat: 0, ts: parseTimeSignature('4/4') },
  { startBeat: 8, ts: parseTimeSignature('3/4') },
];

metricWeight(11, meters); // 3
metricWeight(12, meters); // 1
formatBarPosition(-1, parseTimeSignature('4/4')); // '0.4'
```

Metric weight runs from 0 (off-pulse) to 3 (downbeat) and is what onset placement, accent shaping, and phrase detection are built on. A meter change is respected from the beat it takes effect, so a piece is never read in the signature it opened in.

`resolveMeters` accepts either a single signature or a map, which is how every entry point that takes both is written. `meterAt`, `barIndexAt`, `barStartBeat`, `beatsPerBarAt`, `beatToBarPosition`, and `barPositionToBeat` cover the conversions between absolute beats and bar positions.

## Compound, additive, and tuplet meters

```ts
import { beatsPerBar, isCompound, parseTimeSignature, pulsesPerBar, tuplet } from '@libraz/libcantus';

const sixEight = parseTimeSignature('6/8');

isCompound(sixEight); // true
beatsPerBar(sixEight); // 3
pulsesPerBar(sixEight); // 2

tuplet(1, 3); // [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]
```

A compound signature groups its eighths into dotted pulses, so 6/8 has two pulses and three quarter-note beats. An additive signature carries a `grouping`: 7/8 as `[2, 2, 3]`, and 9/8 as either `[3, 3, 3]` pulses or `[2, 2, 2, 3]` units, which is how aksak meters are written.

`tuplet` divides a span into equal parts, which is the placement side of a tuplet; the notation side — the `{ actual, normal }` ratio a renderer prints — comes from `beatsToDuration`.

## Tempo and duration

`TempoMap` is piecewise constant and is integrated across changes. Duration helpers return notation-oriented values as well as seconds or ticks:

```ts
import { beatsToDuration, beatsToSeconds, beatsToTiedDurations } from '@libraz/libcantus';

beatsToSeconds(8, [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }]); // 6
beatsToDuration(1 / 3); // { base: 'eighth', dots: 0, tuplet: { actual: 3, normal: 2 } }
beatsToTiedDurations(5); // [{ base: 'whole', dots: 0 }, { base: 'quarter', dots: 0 }]
```

`beatsToDuration` answers with a single note value when one exists; `beatsToTiedDurations` splits a length that needs a tie. `durationToBeats` is the inverse, and `NOTE_VALUES` lists the base values. `beatsToTicks` and `ticksToBeats` place the same beat values on a PPQ grid; no global modulo is assumed when the meter changes.

## Arrangement analysis

An arrangement is a set of tracks with roles and note events. `analyzeArrangement` returns the inferred timeline, key regions, per-track analysis, tension, and conflicts between notes and the current harmony:

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
  {
    role: 'bass',
    notes: [{ pitch: 36, startBeat: 0, durationBeat: 4 }],
  },
]);

report.tracks.length; // 2
report.timeline.segments.length >= 1; // true
```

A track's `role` says how it takes part: a harmony track contributes to chord inference, a bass track supplies the bass for inversion, a melody track is analyzed against the harmony rather than contributing to it. `roleOf` infers a role from a track's own material when the host does not know one.

`conflicts` reports notes that disagree with the harmony sounding under them, which is what an arrangement warning panel shows. `tensionCurve` and `tensionCurveFrom` reduce the report to a curve over time.

## Editing sessions

`createArrangementSession` keeps an analysis open while a host edits a track. Each `update` returns a new session and re-analyzes only what the edit can reach, falling back to a full pass when an incremental result cannot be trusted. The previous session stays valid, which is what an undo stack needs. See [Performance](performance.md).

## Form and melody around time

`phrasesFromTimeline`, `hypermeter`, and `sectionsFromNotes` use the same beat model to find phrases and sections. `harmonizeMelody` classifies passing and auxiliary tones before selecting chords, so a non-chord tone does not force the whole harmony by itself.

Provide the correct meter map wherever one is known. Bar positions, hypermeter, and metric weight all follow from it, and an analysis run in the wrong signature will be wrong in a way that looks plausible.
