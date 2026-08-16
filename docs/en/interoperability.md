# Interoperability

The library does not read or write MIDI files, render notation, analyze audio, or play sound. Those belong to the host, and this page covers the conversions at that boundary.

## The data contract

Two conventions carry everything:

- **Pitch is a MIDI note number.** Middle C is 60. Nothing here uses frequencies unless [Tuning and frequency](tuning-and-frequency.md) is involved.
- **Time is quarter-note beats.** `startBeat` and `durationBeat` are floating-point beats, not ticks and not seconds. Beat 0 is the first downbeat, and a pickup starts at a negative beat.

Analysis and generation results are plain JSON-compatible data — no class instances in the functional API, no hidden prototypes — so a result can be serialized into a project file and read back without a revival step. The class API wraps the same data and exposes it through `.data`.

One field is a lookup rather than data, and it is the only one: a chord timeline is its `segments` plus an `at` that reads them, and a function does not survive `JSON.stringify`. Every reported field of an analysis — including `timeline.segments` — round-trips as it stands, and `chordTimelineFromChords` rebuilds `at` over the segments that were stored, giving the same chord at every beat as the timeline it came from.

The handles are the exception, and they are not results: `createNoteEventIndex`, `createArrangementSession`, `createRng`, `createPositionalRng` and `resolveContext` return live objects whose methods and function fields do not survive `JSON.stringify`. Store the input they were built from — the note events, the seed, the resolved `algorithmVersion` — and build them again on load; see [Determinism and seeding](determinism-and-seeding.md).

## Ticks and seconds

A MIDI file measures time in ticks at a stated PPQ. Convert on the way in and back on the way out:

```ts
import { beatsToTicks, ticksToBeats } from '@libraz/libcantus';

ticksToBeats(960, 480); // 2
beatsToTicks(2, 480); // 960
```

Seconds require a tempo map, since a piece with a tempo change has no single conversion factor:

```ts
import { beatsToSeconds, secondsToBeats } from '@libraz/libcantus';

const tempo = [
  { startBeat: 0, bpm: 120 },
  { startBeat: 4, bpm: 60 },
];

beatsToSeconds(8, tempo); // 6
secondsToBeats(6, tempo); // 8
```

`TempoMap` is piecewise constant and integrated across changes, so a note that spans a tempo change gets the right duration rather than one computed at either end.

The map's first event is the time origin — `beatsToSeconds` reads 0 there. A pickup sounds before that, so its beats, seconds and ticks are all negative, and the opening tempo is what times them: `beatsToSeconds(-1, tempo)` is `-0.5`, and `beatsToTicks(-1, 480)` is `-480`. Nothing has to be shifted to be converted.

## Importing a MIDI file

A typical import, using whatever MIDI parser the host already has:

1. Convert every event's tick position and length to beats with `ticksToBeats`.
2. Drop or keep zero-length events deliberately — `dropSilentNotes` applies the analysis-side policy, and `assertNoteEvents` with `allowNonPositiveDuration` validates before that decision.
3. Build the meter map from the file's time-signature events, and the tempo map from its tempo events.
4. Flatten the tracks that contribute to harmony into one array for `chordTimelineFromNotes`; keep the others as separate `ArrangementTrack` entries for `analyzeArrangement`. The note-reading entry points take a `readonly NoteEvent[]`, so an `ArrangementTrack.notes` goes straight in without a copy.

```ts
import { assertNoteEvents, dropSilentNotes, ticksToBeats } from '@libraz/libcantus';

const raw = [
  { midi: 60, tick: 0, lengthTicks: 480 },
  { midi: 64, tick: 0, lengthTicks: 0 },
];

const imported = raw.map((event) => ({
  pitch: event.midi,
  startBeat: ticksToBeats(event.tick, 480),
  durationBeat: ticksToBeats(event.lengthTicks, 480),
}));

assertNoteEvents(imported, 'imported notes', { allowNonPositiveDuration: true }).length; // 2
dropSilentNotes(imported).length; // 1
```

A MIDI file's channel 10 percussion is note events like any other; `drumVoiceOf` and `DRUM_NOTES` map between General MIDI numbers and named drum voices.

## Exporting

Going the other way, the parts a generator returns are already note events. Convert beats to ticks, add the channel and program the host decides, and write the file. Nothing in a generated part depends on the export format.

For a notation exporter, `beatsToDuration` and `beatsToTiedDurations` turn beat lengths into note values, dots, and tuplets, and `spellLine` or `spellVoicing` supply the letter names. See [Time and arrangement](time-and-arrangement.md) and [Pitch and notation](pitch-and-notation.md).

## Note names in other systems

Note and key names are read and written in five systems. On parsing the system is detected from the name; on formatting it defaults to English:

```ts
import { detectNoteNameSystem, formatKeyName, formatNote, parseKeyName, parseNote } from '@libraz/libcantus';

detectNoteNameSystem('B'); // 'english'
detectNoteNameSystem('gis moll'); // 'german'

const key = parseKeyName('gis moll');
formatNote(key.tonic); // 'G#'
key.mode; // 'minor'

formatKeyName(key); // 'G# minor'
formatKeyName(key, { system: 'german' }); // 'gis moll'
formatNote(parseNote('Bb'), { system: 'german' }); // 'b'
```

The systems are `english`, `german`, `japanese`, `italian`, and `fixedDo`. `B` is a genuine ambiguity between English and German, and `detectNoteNameSystem` resolves it as English rather than as the German B-flat — a lone `B` from an unknown source is far more often English. Pass `system` explicitly when the source is known.

## Transposing instruments

A part written for a transposing instrument is not at concert pitch. Convert with `toSoundingPitch` before analysis and `toWrittenPitch` when producing that player's part; see [Instruments and playability](instruments-and-playability.md).

## Storing analysis and generation in a project file

- **Analysis results** are derived data. Recompute them rather than storing them, unless the recomputation is too slow for the host's needs, in which case store them as a cache keyed by the notes they came from.
- **Generated parts** are not derived data in the same sense: reproducing them needs the seed, the resolved `algorithmVersion`, and every generator option. Store those, and preferably the emitted notes as well. See [Determinism and seeding](determinism-and-seeding.md).
- **User edits always win.** A host that regenerates over a user's edit has lost the user's work; keep the generated part and the edited part as separate objects.

## What the library does not decide

Choosing the opening key, deciding that section A is a verse, resolving an ambiguous chord in favour of the composer's intent — these are readings. The library reports the evidence and leaves the reading to the host. A UI that presents an inferred result should show the confidence alongside it and allow an override.
