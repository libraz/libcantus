# Use case: a reproducible generative arrangement

Use one seed per composition and derive every generated part from the same harmonic plan. A preview is then repeatable, while the host stays free to store or edit the emitted note events.

```ts
import {
  BASS_4_STRING,
  chordFromSpan,
  generateBassLine,
  generateDrums,
  generateProgression,
  majorKey,
  playability,
} from '@libraz/libcantus';

const key = majorKey(0);
const ctx = { seed: 24, bpm: 112, complexity: { rhythmic: 0.6, ornament: 0.3, difficulty: 3 } };

const chords = generateProgression({ key, style: 'idol', bars: 8, reharmonize: true, ctx });

const segments = chords.map((span, index) => ({
  chord: chordFromSpan(span),
  startBeat: span.startBeat,
  endBeat: chords[index + 1]?.startBeat ?? span.startBeat + 4,
}));

const bass = generateBassLine({ segments, key, style: 'pop', instrument: BASS_4_STRING, ctx });
const drums = generateDrums({ bars: 8, style: 'funk', section: 'chorus', ctx });

chords.length; // 8
segments.length; // 8
bass.length >= 1; // true
drums.length >= 1; // true
playability(bass, BASS_4_STRING, 112).issues.length; // 0
```

## Why the conversion step exists

`generateProgression` returns `ChordSpan` values: a root, a quality, and a start beat. `generateBassLine` takes segments with an explicit start and end. Turning one into the other is the host's decision, because only the host knows how long the last chord lasts.

A chord timeline produced by analysis already has both ends, so a part written over an existing piece skips this step entirely — see [DAW workflow](daw-workflow.md).

## Layering further passes

Add `harmonizeMelody`, `generateCounterMelody`, `ornament`, or `applyGrooveTemplate` as separate passes over the same plan. Keep the source part and each pass's options, so a user can regenerate only the pass they changed rather than the whole arrangement.

Every part above draws from one `ctx`. Raising `complexity.rhythmic` adds onsets without moving what is already sounding, and `complexity.difficulty` removes candidates that are too hard rather than making the part simpler in general. See [Determinism and seeding](../determinism-and-seeding.md).

## Before exporting

Name the instrument in the generator options, then verify with `playability`. `canSound` and `foldIntoRange` cover the simpler range checks, and the three playability layers separate "this note is not on the instrument" from "this is hard at this tempo" — see [Instruments and playability](../instruments-and-playability.md).

Store the seed, the resolved `algorithmVersion`, and every option alongside the emitted notes. Generation does not write a MIDI file, select a sound, or establish that a result is stylistically appropriate; those decisions belong to the host and its user.
