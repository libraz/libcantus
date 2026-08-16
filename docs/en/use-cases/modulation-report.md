# Use case: a modulation report

A key change is a proposal supported by evidence. A useful report shows where the analysis thinks the key moved, how strongly it believes it, and what chord carried the change.

```ts
import {
  chordTimelineFromChords,
  detectModulations,
  formatNote,
  keyRelationBetween,
  spelledKeyOf,
} from '@libraz/libcantus';

const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 5, quality: 'maj', startBeat: 4 },
    { rootPc: 7, quality: 'dom7', startBeat: 8 },
    { rootPc: 0, quality: 'maj', startBeat: 12 },
    { rootPc: 9, quality: 'min', startBeat: 16 },
    { rootPc: 2, quality: 'dom7', startBeat: 20 },
    { rootPc: 7, quality: 'maj', startBeat: 24 },
    { rootPc: 4, quality: 'min', startBeat: 28 },
    { rootPc: 9, quality: 'min7', startBeat: 32 },
    { rootPc: 2, quality: 'dom7', startBeat: 36 },
    { rootPc: 7, quality: 'maj', startBeat: 40 },
  ],
  44,
);

const regions = detectModulations(timeline.segments);

const rows = regions.map((region) => ({
  from: region.startBeat,
  to: region.endBeat,
  key: formatNote(spelledKeyOf(region.key).tonic),
  confidence: Math.round(region.confidence * 100) / 100,
}));

rows.length >= 1; // true
rows[0]?.from; // 0

const relations = regions.slice(1).map((region, index) =>
  keyRelationBetween(
    { tonic: spelledKeyOf(regions[index]?.key ?? region.key).tonic, key: regions[index]?.key ?? region.key },
    { tonic: spelledKeyOf(region.key).tonic, key: region.key },
  ),
);

Array.isArray(relations); // true
```

## What to put in the report

Each `KeyRegion` carries four things worth showing:

- **The span** — `startBeat` and `endBeat`, which a UI converts to bar numbers with `beatToBarPosition`.
- **The key** — `spelledKeyOf` gives the tonic the way a score would write it, which is what a reader expects rather than a pitch class.
- **The confidence** — the correlation between the region's pitch-class distribution and the key's profile, in 0..1. A region below the threshold your UI chooses should read as uncertain rather than not appear.
- **The pivot**, where the chords support one — the chord that straddles the boundary, filled in by the analysis.

`keyRelationBetween` names how consecutive regions stand to each other: `dominant`, `relative`, `parallel`, and so on, or `null` for a distant move. A report that says "modulates to the dominant" says more than one that says "modulates to G".

## Tuning the sensitivity

The same options control `detectModulations` and `keyTimelineFromNotes`:

- `expectedKeyBeats` — how long a key is expected to hold. It defaults to four bars, and lowering it makes the search propose new regions more readily.
- `minKeyBeats` — the shortest region the search will emit, one bar by default. Raise it when brief tonicizations are surfacing as modulations.
- `ts` or `meters` — the meter, so bar lines and metric accents are read correctly.

A tonicization and a modulation differ in duration, not in kind. If the report is noisy, that is usually the sensitivity, not a fault in the input; see [Key relations and modulation](../key-relations-and-modulation.md) for the distinction and for `secondaryDominant` and `borrowedSource`, which label the chromatic chords that do not move the key.

## From notes rather than chords

`keyTimelineFromNotes` takes note events directly. Prefer `detectModulations` over an inferred chord timeline when one is available: chords carry more evidence per beat than raw pitches, and the chord that carries a modulation is exactly what the pivot needs.

## Presenting it

Show the confidence and allow an override. A piece that deliberately hovers between two keys has no single correct answer, and a report that hides that has thrown away the interesting part of the analysis.
