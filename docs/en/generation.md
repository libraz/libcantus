# Generation

Generation functions create note events from a key, a timeline, a motif, or a rhythm. Results are deterministic for a given seed and option set, and no generator modifies its input — each returns new material for the host to place.

## The shape of a generated piece

Generators compose into passes rather than a single call. A typical order:

1. Choose the harmony: `generateProgression`, or a chord timeline the host already has.
2. Write the parts against it: `generateBassLine`, `generateDrums`, `generateCounterMelody`, `harmonizeMelody`.
3. Shape the surface: `ornament`, `applyGrooveTemplate`, `humanize`.

Keeping the passes separate is what lets a host regenerate one of them. Changing an ornament option does not regenerate the line underneath it.

## Progressions and motifs

```ts
import { generateMotif, generateProgression, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const chords = generateProgression({ key, style: 'idol', bars: 8, reharmonize: true, seed: 1 });
const motif = generateMotif({ key, bars: 2, contour: 'arch', seed: 1 });

chords.length; // 8
motif.notes.length >= 1; // true
```

`generateProgression` returns one `ChordSpan` per bar. `style` selects the preset pool; `presetId` names one outright, and `preset` supplies degrees directly. See [Reharmonization](reharmonization.md) for the `reharmonize` flag and the substitution vocabulary.

`generateRhythm`, `motifToNoteEvents`, `developMotif`, and `transformMotif` separate material choice from placement and transformation; see [Melody and motifs](melody-and-motifs.md) and [Rhythm and groove](rhythm-and-groove.md).

## Parts

Bass, drums, counter-melody, and harmonization share the note-event model:

```ts
import { generateBassLine, generateDrums, majorKey, makeChord } from '@libraz/libcantus';

const key = majorKey(0);
const segments = [
  { chord: makeChord(0, 'maj'), startBeat: 0, endBeat: 4 },
  { chord: makeChord(5, 'maj'), startBeat: 4, endBeat: 8 },
];

const bass = generateBassLine({ segments, key, style: 'walking', ctx: { seed: 7, bpm: 96 } });

bass.length >= 1; // true
bass.every((note) => note.durationBeat > 0); // true

const drums = generateDrums({
  bars: 4,
  style: 'funk',
  section: 'chorus',
  ctx: { seed: 7, bpm: 96, complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 } },
});

drums.length > 0; // true
```

`generateBassLine` takes segments with explicit start and end beats, which is what a chord timeline provides — a progression's `ChordSpan` values are not segments and have to be placed first. Bass styles are `root`, `rootFifth`, `pop`, `walking`, and `arpeggio`; `octave` sets the target register, and naming an `instrument` makes the line playable on it.

## Ornamentation

Ornamentation is an operation over existing material:

```ts
import { ornament } from '@libraz/libcantus';

const notes = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.5,
  durationBeat: 0.5,
}));

ornament(notes, { style: 'ghost', amount: 0.6, seed: 4 }).length; // 8
```

`imitate`, `applyGrooveTemplate`, and `humanize` are the other passes of this kind. Because they take material and return material, a host can store the source and each pass's options and regenerate only the pass that changed.

## Context and reproducibility

`GenerationContext` carries the project seed, tempo, instrument profiles, vocabulary, complexity, and difficulty. `complexity` has `rhythmic`, `harmonic`, and `ornament` controls in 0..1. `difficulty` is a ceiling from 1 to 5: it removes candidates instead of increasing intensity.

A numeric context such as `1` is shorthand for `{ seed: 1 }`. Random choices are derived by position, and `algorithmVersion` pins the generation contract. See [Determinism and seeding](determinism-and-seeding.md) for what a project file has to store to reopen a generated part as itself.

Every generator also accepts its own sugar — `seed`, `bpm`, `density` — for callers that want one part rather than a piece. Where both are given, the context wins, since it is the one thing that speaks for the whole piece.

## Instrument constraints

`InstrumentProfile` describes an instrument's range and physical constraints. `canSound`, `foldIntoRange`, and `playability` let a host inspect or adapt generated material:

```ts
import { BASS_4_STRING, GUITAR_DROP_D, GUITAR_STANDARD, canSound, playability } from '@libraz/libcantus';

canSound(GUITAR_DROP_D, 38); // true
canSound(GUITAR_STANDARD, 38); // false
playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }], BASS_4_STRING).issues.length; // 1
```

Naming a profile in the context is itself the request that the part be playable, so the range and physical limits apply whatever the difficulty ceiling says. See [Instruments and playability](instruments-and-playability.md).

## What generation does not claim

A generated part is material, not a decision. Generation does not write a file, choose a sound, or establish that a result is stylistically appropriate — those belong to the host and its user. Keep the generated part and any user edit of it as separate objects, so regenerating never overwrites work someone did by hand.
