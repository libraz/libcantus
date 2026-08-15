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

The meter helpers also cover compound and additive signatures, tuplets, bar positions, pulses, and bar starts. Use `resolveMeters` when an entry point accepts either a single signature or a map.

## Tempo and duration

`TempoMap` is piecewise constant and is integrated across changes. Duration helpers return notation-oriented values as well as seconds or ticks:

```ts
import { beatsToDuration, beatsToSeconds, beatsToTiedDurations } from '@libraz/libcantus';

beatsToSeconds(8, [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }]); // 6
beatsToDuration(1 / 3); // { base: 'eighth', dots: 0, tuplet: { actual: 3, normal: 2 } }
beatsToTiedDurations(5); // [{ base: 'whole', dots: 0 }, { base: 'quarter', dots: 0 }]
```

`beatsToTicks` and `ticksToBeats` place the same beat values on a PPQ grid. No global modulo is assumed when the meter changes.

## Arrangement analysis

An arrangement is a set of tracks with roles and note events. `analyzeArrangement` returns the inferred timeline, key regions, per-track analysis, tensions, and conflicts between notes and the current harmony:

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

report.timeline.segments;
report.conflicts;
```

Use `createArrangementSession` when a host repeatedly edits a track. The session updates affected regions and falls back to a full analysis when an incremental result cannot be trusted; the previous analysis remains available on the session for undo workflows.

## Form and melody around time

`phrasesFromTimeline`, `hypermeter`, and `sectionsFromNotes` use the same beat model to find phrases and sections. `harmonizeMelody` classifies passing and auxiliary tones before selecting chords, so a non-chord tone does not force the whole harmony by itself.

