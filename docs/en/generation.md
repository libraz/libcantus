# Generation

Generation functions create note events from a key, a timeline, a motif, or a rhythm. Results are deterministic for a given seed and option set.

## Progressions and motifs

Use a preset progression or ask for a motif with a contour:

```ts
import { generateMotif, generateProgression, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
generateProgression({ key, style: 'idol', bars: 8, reharmonize: true, seed: 1 });
generateMotif({ key, bars: 2, contour: 'arch', seed: 1 });
```

`generateRhythm`, `motifToNoteEvents`, `developMotif`, and `transformMotif` let a caller separate material choice from placement and transformation.

## Parts and ornamentation

Bass, counter-melody, drums, and ornaments share the note-event model:

```ts
import { generateDrums, ornament } from '@libraz/libcantus';

generateDrums({
  bars: 4,
  style: 'funk',
  section: 'chorus',
  ctx: { seed: 1, bpm: 96, complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 } },
});

const notes = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.5,
  durationBeat: 0.5,
}));
ornament(notes, { style: 'ghost', amount: 0.6, seed: 4 });
```

`generateBassLine`, `generateCounterMelody`, `imitate`, `harmonizeMelody`, and `applyGrooveTemplate` cover other common passes. Ornamentation is a separate operation over existing material, so changing an ornament option does not regenerate the source line.

## Context and reproducibility

`GenerationContext` carries the project seed, tempo, instrument profiles, vocabulary, complexity, and difficulty. `complexity` has rhythmic, harmonic, and ornament controls in the range 0..1. `difficulty` is a ceiling from 1 to 5: it removes candidates instead of increasing intensity.

A numeric context such as `1` is shorthand for `{ seed: 1 }`. Random choices are derived by position, and `algorithmVersion` is available when a caller needs to pin the generation contract.

## Instrument constraints

`InstrumentProfile` describes an instrument's range and physical constraints. `canSound`, `foldIntoRange`, and `playability` let a host inspect or adapt generated material:

```ts
import { BASS_4_STRING, GUITAR_DROP_D, GUITAR_STANDARD, canSound, playability } from '@libraz/libcantus';

canSound(GUITAR_DROP_D, 38); // true
canSound(GUITAR_STANDARD, 38); // false
playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }], BASS_4_STRING).issues;
```

