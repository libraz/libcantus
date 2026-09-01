# Generation

Generation creates note events from a key, a timeline, a motif, or a rhythm. Results are deterministic for a given seed and option set, and nothing modifies its input — each call returns new material for the host to place.

A `Composer` holds what one piece is written under: its key, meter, tempo, seed, complexity dials, instruments, and vocabulary. Every part it writes inherits them, so a piece states them once. Underneath sit the generation functions, which take the same settings as arguments; the class is where they stop being repeated.

Chords, keys and progressions are the vocabulary this page generates in; [the harmony primer](primer/harmony.md) covers them for a reader with no musical training.

## The shape of a generated piece

Generation happens in passes rather than a single call. A typical order:

1. Choose the harmony: `composer.progression`, `composer.harmonize` for a melody that has none yet, or a chord timeline the host already has.
2. Write the parts against it: `composer.bass`, `composer.drums`, `composer.counterMelody`.
3. Shape the surface: `score.ornament`, `score.groove`, `score.humanize`.

Each pass is a function too — `generateProgression`, `generateBassLine`, `generateDrums`, `generateCounterMelody`, `harmonizeMelody`, `ornament`, `applyGrooveTemplate`, `humanize` — taking the key, the meter and the context as arguments instead of inheriting them. The two routes reach the same generators and give the same notes.

Keeping the passes separate is what lets a host regenerate one of them. Changing an ornament option does not regenerate the line underneath it.

## Progressions and motifs

```ts
import { Composer, Motif } from '@libraz/libcantus';

const composer = Composer.of({
  key: 'C major',
  bpm: 96,
  seed: 1,
  complexity: { harmonic: 0.5 },
});
const chords = composer.progression({ style: 'idol', bars: 8 });
const motif = Motif.generate({ key: 'C major', bars: 2, contour: 'arch', ctx: { seed: 1 } });

chords.length; // 8
chords.totalBeats; // 32
motif.notes.length >= 1; // true
```

`composer.progression` hands back a `Timeline` — the chords with the beats they sound for — rather than a bare array, so the parts written against it and the analysis layer read it without being told the bar length again.

The same material a function at a time, with the context named at the call:

```ts
import { generateMotif, generateProgression, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const chords = generateProgression({
  key,
  style: 'idol',
  bars: 8,
  ctx: { seed: 1, complexity: { harmonic: 0.5 } },
});
const motif = generateMotif({ key, bars: 2, contour: 'arch', ctx: { seed: 1 } });

chords.length; // 8
motif.notes.length >= 1; // true
```

`generateProgression` returns one `ChordSpan` per bar. `style` selects the preset pool; `presetId` names one outright, and `preset` supplies degrees directly. `ctx.complexity.harmonic` decides how many chords are replaced by the secondary dominant of what follows — the dominant seventh borrowed from the next chord's own key, which pulls the ear onto that chord — and 0, the default, leaves the progression alone. See [Reharmonization](reharmonization.md) for that dial and the substitution vocabulary.

`Rhythm`, `Motif`, and their functional siblings `generateRhythm`, `motifToNoteEvents`, `developMotif` and `transformMotif` separate material choice from placement and transformation; see [Melody and motifs](melody-and-motifs.md) and [Rhythm and groove](rhythm-and-groove.md).

## Parts

Bass, drums, and counter-melody all come back as a `Score`, which is note events read against the meter and tempo they were written in — and, for a pitched part, the key as well. `composer.harmonize` is the exception: it hands the chords back as a `Timeline`, the melody as the `Score` those chords read, and the distance between that melody and the line handed in as `transposeSemitones`.

```ts
import { Composer } from '@libraz/libcantus';

const composer = Composer.of({
  key: 'C major',
  bpm: 96,
  seed: 7,
  complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 },
});
const chords = composer.progression({ style: 'idol', bars: 4 });

const bass = composer.bass(chords, { style: 'walking' });
const drums = composer.drums({ bars: 4, style: 'funk', section: 'chorus' });

bass.totalBeats; // 16
bass.notes.every((note) => note.durationBeat > 0); // true
drums.notes.length > 0; // true
```

The functional form takes the harmony as explicit segments and the settings as a context:

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

`generateBassLine` takes segments with explicit start and end beats, which is what a chord timeline provides — a progression's `ChordSpan` values are not segments and have to be placed first. `composer.bass` accepts either a `Timeline` or those same segments, and places nothing on your behalf. Bass styles are `root`, `rootFifth`, `pop`, `walking`, and `arpeggio`; `octave` sets the target register, and naming an `instrument` makes the line playable on it.

A composer refuses the parts its settings cannot carry rather than filling a gap with a default. `progression`, `bass` and `counterMelody` are written in a key, so a composer that names none throws for all three; `harmonize` is the member that reads a key off the melody it is given, and `with({ key })` carries that key over to the parts written afterwards. `progression` also needs one meter for the whole part, since it lays one chord per bar and a meter change would leave the chords off the bar lines from the change onward. `drums` is in no key and is written either way, but the kit patterns are written against a four-beat bar, so it takes 4/4 and nothing else.

```ts
import { Composer, isLibcantusError } from '@libraz/libcantus';

let code = 'ok';
try {
  Composer.of({ bpm: 96 }).progression({ style: 'rock', bars: 4 });
} catch (error) {
  if (isLibcantusError(error)) code = error.code;
}

code; // 'INVALID_INPUT'
```

## Ornamentation

Ornamentation is an operation over existing material, so it is a method on the material:

```ts
import { Score } from '@libraz/libcantus';

const line = Score.of(
  [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
    pitch,
    startBeat: i * 0.5,
    durationBeat: 0.5,
  })),
);

line.ornament({ style: 'ghost', amount: 0.6, ctx: { seed: 4 } }).notes.length; // 8
```

`score.groove` and `score.humanize` are the other passes of this kind, and `ornament`, `applyGrooveTemplate` and `humanize` are the functions they call. `imitate` is a pass of the same shape with no method of its own:

```ts
import { ornament } from '@libraz/libcantus';

const notes = [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.5,
  durationBeat: 0.5,
}));

ornament(notes, { style: 'ghost', amount: 0.6, ctx: { seed: 4 } }).length; // 8
```

Because they take material and return material, a host can store the source and each pass's options and regenerate only the pass that changed.

## Context and reproducibility

`GenerationContext` carries the project `seed`, the `bpm`, the `instruments` the parts are written for, the `vocabulary`, the `complexity` dials, the `algorithmVersion` to generate under, and an `rng` for a caller that would rather supply the source than have one derived from the seed. The seed itself is optional and zero when left out, so a context naming only a tempo is a whole request. `complexity` is where the dials live: `rhythmic`, `harmonic`, and `ornament` in 0..1, plus `difficulty`, a ceiling from 1 to 5 that removes candidates instead of increasing intensity. `vocabulary` is the genre dictionary the whole piece draws from, described under [Genre vocabulary](rhythm-and-groove.md).

Every dial a generator answers to lives there. Pass the context as `ctx` at each call, or let a composer hold it: `composer.context` is that same plain context for a call the class does not cover, and the `with…` methods hand back a new composer rather than reconfiguring the one in hand.

```ts
import { Composer } from '@libraz/libcantus';

const composer = Composer.of({ key: 'C major', bpm: 120, seed: 42 });
const variation = composer.withSeed(43);

composer.context.seed; // 42
variation.data.seed; // 43
JSON.stringify(composer.drums({ bars: 2, style: 'standard', section: 'verse' })) ===
  JSON.stringify(variation.withSeed(42).drums({ bars: 2, style: 'standard', section: 'verse' }));
// true
```

A numeric context such as `1` is shorthand for `{ seed: 1 }`. Random choices are derived by position, and `algorithmVersion` records which reading of the parameters a take was made under. See [Determinism and seeding](determinism-and-seeding.md) for what a project file has to store to reopen a generated part as itself.

## Instrument constraints

`InstrumentProfile` describes an instrument's range and physical constraints. An `Instrument` wraps one and answers the questions asked of it:

```ts
import { Instrument } from '@libraz/libcantus';

Instrument.guitarDropD().canSound(38); // true
Instrument.guitar().canSound(38); // false
Instrument.bass4().playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }]).issues.length; // 1
```

`canSound`, `foldIntoRange`, and `playability` are the same answers as functions over a bare profile, and the built-in profiles are exported as constants:

```ts
import { BASS_4_STRING, GUITAR_DROP_D, GUITAR_STANDARD, canSound, playability } from '@libraz/libcantus';

canSound(GUITAR_DROP_D, 38); // true
canSound(GUITAR_STANDARD, 38); // false
playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }], BASS_4_STRING).issues.length; // 1
```

Naming a profile in the context — `Composer.of({ instruments: { bass: BASS_4_STRING } })`, or `ctx.instruments` at the call — is itself the request that the part be playable, so the range and physical limits apply whatever the difficulty ceiling says. The generators read two part names, `bass` and `drums`; a profile filed under any other name is not consulted, so a lead or a keys profile is carried by the context without reaching a generator. See [Instruments and playability](instruments-and-playability.md).

## What generation does not claim

A generated part is material, not a decision. Generation does not write a file, choose a sound, or establish that a result is stylistically appropriate — those belong to the host and its user. Keep the generated part and any user edit of it as separate objects, so regenerating never overwrites work someone did by hand.
