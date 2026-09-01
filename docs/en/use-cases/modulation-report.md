# Use case: a modulation report

A key change is a proposal supported by evidence. A useful report shows where the analysis thinks the key moved, how strongly it believes it, and what chord carried the change.

The flow starts from chord symbols a user typed, or from note events an importer supplied; a key is never required as input, because reading one is the point. For the vocabulary — key, pivot chord, modulation, key region — see the [primer](../primer/index.md).

```ts
import { Chord, Key, Timeline } from '@libraz/libcantus';

// Eleven bars typed as a chord chart: four in C, then a turn towards G.
const chart = ['C', 'F', 'G7', 'C', 'Am', 'D7', 'G', 'Em', 'Am7', 'D7', 'G'];

const timeline = Timeline.fromChords(
  chart.map((symbol, bar) => Chord.parse(symbol).span(bar * 4)),
  chart.length * 4,
);

// A timeline built from stated chords carries no key regions until it is asked
// to read them; this is where the chords are searched for the keys they imply.
const regions = timeline.modulations();

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

`detectModulations` is the same search over bare segments, for a caller holding no `Timeline`. Each region it returns is a plain `KeyRegion`, and `Key.of` turns one back into a value that can answer questions:

```ts
import { Chord, detectModulations, Key, Timeline } from '@libraz/libcantus';

const chart = ['C', 'F', 'G7', 'C', 'Am', 'D7', 'G', 'Em', 'Am7', 'D7', 'G'];
const timeline = Timeline.fromChords(
  chart.map((symbol, bar) => Chord.parse(symbol).span(bar * 4)),
  chart.length * 4,
);

const regions = detectModulations(timeline.segments);

// How each region stands to the one before it, already named by the analysis:
regions.map((region) => region.modulation ?? null); // [null, 'dominant']

const keys = regions.map((region) => Key.of(region.key));

// The same question, asked of two keys the analysis did not pair:
keys.slice(1).map((key, index) => keys[index]?.relationTo(key) ?? null); // ['dominant']
keys[1]?.tonic.name; // 'G'
keys[1]?.fifths; // 1
```

## What to put in the report

Each `KeyRegion` carries five things worth showing:

- **The span** — `startBeat` and `endBeat`, which a UI converts to bar numbers with `Score.barAt`. `barAt` is 0-based, so add 1 before showing the number, or pass the beat and the score's meter to `formatBarPosition`, which is 1-based like a printed score. See [Time and arrangement](../time-and-arrangement.md) for the two origins.
- **The key** — `region.key` is the whole key, spelled tonic and all, so it prints the way a score would write it without being re-derived. `Key.of` wraps it in a value that can answer questions, and `fifths` is the key signature to print with it: how many sharps or flats the key is written with, negative for flats.
- **The relation** — `region.modulation` already names how each region stands to the one before it: `dominant`, `relative`, `parallel`, and so on. It is absent on the first region, and wherever the two keys stand in none of the named relations. A report that says "modulates to the dominant" says more than one that says "modulates to G".
- **The confidence** — the correlation between the region's pitch-class distribution and the key's profile, in 0..1. A region below the threshold your UI chooses should read as uncertain rather than not appear.
- **The pivot**, where the chords support one — the last chord to end before the boundary, filled in by the analysis and only when that chord reads in both keys. A chord still sounding across the boundary is not a candidate.

`Key.relationTo` answers the same relation question for two keys the analysis never paired, which is what a UI comparing an arbitrary pair of regions needs.

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
