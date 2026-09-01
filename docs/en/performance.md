# Performance

Everything in the library is synchronous and single-threaded. A call returns before it can be interrupted, so the questions that matter are how much work an entry point does and how a host avoids repeating it.

## Where the cost is

| Operation | Roughly costs |
| --- | --- |
| Pitch, interval, chord, and scale arithmetic | Constant time. Bit operations on a twelve-bit mask. |
| `detectChord`, `detectKey` | Linear in the candidate set, which is fixed. |
| `chordTimelineFromNotes` | Linear in the number of note-to-slot memberships: each note is read once per slot it sounds in. Under the default `'dynamic'` segmentation the slot length follows from `minChordBeats`, and each slot costs one constant step of the boundary search over the chord lexicon; `harmonicRhythm` is a prior there rather than a window length. `segmentation: 'grid'` collapses that to one window every `harmonicRhythm` beats with no search at all. |
| `keyTimelineFromNotes`, `detectModulations` | The same, over slots of `minKeyBeats`, plus a constant search per slot: 24 candidates, and a transition weighed for every ordered pair of them, so 24 x 24 per step. |
| `voiceChord` | Bounded by `maxCandidates`, 4000 by default. |
| `voiceProgression` | Linear in the number of chords, because the per-chord search is bounded. |
| `analyzeArrangement` | Dominated by the timeline pass over the flattened harmony tracks. |
| Generators | Linear in the bars requested. |

None of these grows quadratically in the number of notes, but a full arrangement analysis over a long piece is still real work. A host that runs one on every keystroke will feel it.

## Indexing note events

`createNoteEventIndex` validates and stable-sorts once, then answers onset and active-note queries in logarithmic time:

```ts
import { createNoteEventIndex } from '@libraz/libcantus';

const notes = [
  { pitch: 60, startBeat: 0, durationBeat: 2 },
  { pitch: 64, startBeat: 1, durationBeat: 2 },
  { pitch: 67, startBeat: 4, durationBeat: 1 },
];

const index = createNoteEventIndex(notes);

index.at(1.5)?.note.pitch; // 64
index.attacksAt(4); // true
index.attacksAt(3); // false
index.onsetsBetween(0, 5); // [1, 4]
```

`Score.index()` builds the same index over a score's own notes, so a host holding a `Score` does not have to unpack it first:

```ts
import { Score } from '@libraz/libcantus';

const score = Score.of([
  { pitch: 60, startBeat: 0, durationBeat: 2 },
  { pitch: 64, startBeat: 1, durationBeat: 2 },
]);

score.index().at(1.5)?.note.pitch; // 64
```

Use it when a host asks many positional questions about one unchanging set of notes — a playhead readout, a hover inspector, a per-beat annotation pass. For a single question, the linear scan is cheaper than building the index.

Notes with a non-positive duration may be retained for a caller that filters them later, but they never count as sounding.

## Incremental arrangement analysis

`createArrangementSession` holds an analysis open across edits and re-analyzes only what an edit can reach:

```ts
import { createArrangementSession } from '@libraz/libcantus';

const session = createArrangementSession([
  {
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
]);

const edited = session.update([
  {
    trackIndex: 0,
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
      { pitch: 65, startBeat: 4, durationBeat: 4 },
    ],
  },
]);

edited.analysis.timeline.segments.length >= 1; // true
session.analysis.timeline.segments.length >= 1; // true
```

The result equals what `analyzeArrangement` would return over the edited tracks — the same segments, confidences, key regions, cadences, annotations, and conflicts — so a session can be held open indefinitely without drifting from a fresh pass. When an incremental result cannot be trusted, the session falls back to a full analysis rather than returning an approximation.

`update` returns a new session and leaves the old one intact, which is what an undo stack needs: keep the previous session object and undo is a reference swap.

Notes are compared as values and by multiplicity, so re-ordering a track's array counts as no edit at all, while adding a second copy of a note counts as one.

`Arrangement.update` is the same machinery behind the class: an `Arrangement` opens a session the first time it is asked for an analysis, and `update` re-analyzes through it and hands back a new arrangement carrying the result. Reach for `createArrangementSession` when the host wants to hold the handle itself; see [Time and arrangement](time-and-arrangement.md) for the class route.

## Bounding the work explicitly

Entry points that could be handed an unbounded request take a budget:

- `budget` on `chordTimelineFromNotes`, `keyTimelineFromNotes`, `detectModulations`, and `voiceProgression` caps the size of the input or the search.
- A timeline is charged for the candidates it is about to evaluate rather than for its window count alone: dynamic segmentation builds one lexicon row per slot, so it is charged slots times the size of the chord lexicon, while a fixed grid cuts its segments from the grid and is charged its slots only. A budget that passes therefore stands for a table that fits, which is what keeps a request from being accepted and then allocating far more than it was measured at.
- A meter map is bounded by its entry count, because the map is consulted once per analysed slot: its length is a per-slot cost rather than a one-time one.
- `maxCandidates` on `voiceChord` and `voiceProgression` caps the per-chord search. Raising it buys a closer-to-optimal voicing at the cost of time.
- `DEFAULT_GENERATION_BUDGET` is the default cap, and exceeding it raises `BudgetExceededError` rather than blocking. A value that is not oversized but malformed — an instrument profile whose frets or open strings fall outside the MIDI compass — is refused where it is accepted, as an `InvalidInputError`.

See [Errors and validation](errors-and-validation.md) for how those failures are reported.

## Keeping a UI responsive

- Debounce analysis behind the edit rather than running it per keystroke.
- Use a session for arrangement analysis — `createArrangementSession`, or `Arrangement.update`, which holds one internally — and an index for repeated positional queries, from `createNoteEventIndex` or `Score.index`.
- Narrow the input: `chordTimelineFromNotes` over the bars on screen answers faster than over the whole piece, and a host that already knows its chords should call `chordTimelineFromChords` instead of re-inferring them.
- Move a long analysis to a worker. Every input and output of the functional API is plain JSON-compatible data, so it crosses a worker boundary with a structured clone and no revival step.

A class value does not cross that way: the state lives in private fields, and cloning the instance yields an empty object that is no longer a `Score`. Send `toJSON()` instead and rebuild with the matching `fromJSON` — every model class carries both:

```ts
import { Score } from '@libraz/libcantus';

const score = Score.of([{ pitch: 60, startBeat: 0, durationBeat: 4 }]);
const posted = structuredClone(score.toJSON());

Score.fromJSON(posted).notes[0]?.pitch; // 60
```

## Measuring

The repository carries a timeline-index benchmark:

```sh
yarn bench:timeline
```

It builds the package first and runs against the built output, which is the code an application actually loads.
