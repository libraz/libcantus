# Use case: a modulation report

A key change is a proposal supported by evidence. A useful report shows where the analysis thinks the key moved, how strongly it believes it, and what chord carried the change.

```ts
import { Chord, detectModulations, Key, Timeline } from '@libraz/libcantus';

// Eleven bars typed as a chord chart: four in C, then a turn towards G.
const chart = ['C', 'F', 'G7', 'C', 'Am', 'D7', 'G', 'Em', 'Am7', 'D7', 'G'];

const timeline = Timeline.fromChords(
  chart.map((symbol, bar) => Chord.parse(symbol).span(bar * 4)),
  chart.length * 4,
);

// A timeline built from stated chords holds the chords and nothing more, so
// the key search over them is the one step with no method of its own:
const regions = detectModulations(timeline.segments);

const rows = regions.map((region) => ({
  from: region.startBeat,
  to: region.endBeat,
  key: Key.of(region.key).toString(),
  confidence: Math.round(region.confidence * 100) / 100,
}));

rows.length; // 2
rows[0]?.from; // 0
rows.map((row) => row.key); // ['C major', 'G major']
```

Each region is a plain `KeyRegion`, and `Key.of` is what turns one back into a value that can answer questions — including how it stands to the region before it:

```ts
import { Chord, detectModulations, Key, Timeline } from '@libraz/libcantus';

const chart = ['C', 'F', 'G7', 'C', 'Am', 'D7', 'G', 'Em', 'Am7', 'D7', 'G'];
const timeline = Timeline.fromChords(
  chart.map((symbol, bar) => Chord.parse(symbol).span(bar * 4)),
  chart.length * 4,
);

const keys = detectModulations(timeline.segments).map((region) => Key.of(region.key));

keys.slice(1).map((key, index) => keys[index]?.relationTo(key) ?? null); // ['dominant']
keys[1]?.tonic.name; // 'G'
keys[1]?.fifths; // 1
```

## What to put in the report

Each `KeyRegion` carries four things worth showing:

- **The span** — `startBeat` and `endBeat`, which a UI converts to bar numbers with `Score.barAt`.
- **The key** — `Key.of(region.key)` spells the tonic the way a score would write it, which is what a reader expects rather than a pitch class, and `fifths` is the signature to print with it.
- **The confidence** — the correlation between the region's pitch-class distribution and the key's profile, in 0..1. A region below the threshold your UI chooses should read as uncertain rather than not appear.
- **The pivot**, where the chords support one — the chord that straddles the boundary, filled in by the analysis.

`relationTo` names how consecutive regions stand to each other: `dominant`, `relative`, `parallel`, and so on, or `null` for a distant move. A report that says "modulates to the dominant" says more than one that says "modulates to G".

## Tuning the sensitivity

The same options control `detectModulations` and `Score.keys`:

- `expectedKeyBeats` — how long a key is expected to hold. It defaults to four bars, and lowering it makes the search propose new regions more readily.
- `minKeyBeats` — the shortest region the search will emit, one bar by default. Raise it when brief tonicizations are surfacing as modulations.
- `ts` or `meters` — the meter, so bar lines and metric accents are read correctly. A `Score` passes its own meter map down, so this is only needed on the bare functions.

A tonicization and a modulation differ in duration, not in kind. If the report is noisy, that is usually the sensitivity, not a fault in the input; see [Key relations and modulation](../key-relations-and-modulation.md) for the distinction and for `secondaryDominant` and `borrowedSource`, which label the chromatic chords that do not move the key.

## From notes rather than chords

When the input is sounding notes, nothing has to be wired by hand: a `Score` reads its own harmony, and the timeline it hands back carries the key regions the analysis found, pivots included.

```ts
import { Chord, Score } from '@libraz/libcantus';

const chart = ['C', 'F', 'G7', 'C', 'Am', 'D7', 'G', 'Em', 'Am7', 'D7', 'G'];
const notes = chart.flatMap((symbol, bar) =>
  Chord.parse(symbol)
    .voice()
    .map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const regions = Score.of(notes).timeline().keys;

regions.length >= 1; // true
regions[0]?.startBeat; // 0
```

Prefer `detectModulations` over an inferred chord timeline when the chords are already known: chords carry more evidence per beat than raw pitches, and the chord that carries a modulation is exactly what the pivot needs. `Score.keys` answers the same question from the notes alone when no chord reading is wanted.

## Presenting it

Show the confidence and allow an override. A piece that deliberately hovers between two keys has no single correct answer, and a report that hides that has thrown away the interesting part of the analysis.
