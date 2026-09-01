# Use case: a reproducible generative arrangement

Use one seed per composition and derive every generated part from the same harmonic plan. A preview is then repeatable, while the host stays free to store or edit the emitted note events. A `Composer` is where the seed, the key, the tempo and the complexity dials live, so each part inherits them instead of restating them.

The flow assumes nothing musical in hand: a key name, a tempo and a seed are the whole input, and the chords come from the library. For the vocabulary — key, chord progression, section, playability — see the [primer](../primer/index.md).

```ts
import { Composer, Instrument } from '@libraz/libcantus';

const bass4 = Instrument.bass4();
const composer = Composer.of({
  key: 'C major',
  bpm: 112,
  seed: 24,
  complexity: { rhythmic: 0.6, ornament: 0.3, difficulty: 3 },
});

const plan = composer.progression({ style: 'idol', bars: 8 });
const bass = composer.bass(plan, { style: 'pop', instrument: bass4 });
const drums = composer.drums({ bars: 8, style: 'funk', section: 'chorus' });

plan.segments.length; // 8
plan.totalBeats; // 32
plan.roman().map((entry) => entry.roman);
// ['IV', 'V', 'iii', 'vi', 'IV', 'V', 'iii', 'vi']

bass.notes.length; // 27
// Every kit voice is an event of its own, so the count pools the whole kit:
drums.notes.length; // 281
bass4.playability(bass.notes, 112).issues.length; // 0
```

## The plan is the arrangement's spine

`composer.progression` hands back a `Timeline`: the chords with a start and an end each, and the key under them. That is already what a part generator follows, so there is no step in which the host works out how long the last chord lasts and rebuilds the plan as segments. The same timeline drives the bass here, a counter line beside it, and the chord track a host writes out.

An analysis produces the same kind of value, so a part written over an existing piece is written the same way against a timeline read from its notes — see [DAW workflow](daw-workflow.md).

Every score a composer hands back is already read against the composer's meter and tempo, and the pitched ones against its key, so the parts line up with each other without being re-contextualized one at a time.

## One seed, one take

Settings and seed together decide the notes. Asking the same composer twice gives the same music; a different seed is a different take rather than an edit of the first:

```ts
import { Composer } from '@libraz/libcantus';

const composer = Composer.of({ key: 'C major', bpm: 112, seed: 24 });
const plan = composer.progression({ style: 'idol', bars: 8 });

composer.progression({ style: 'idol', bars: 8 }).equals(plan); // true
composer.withSeed(25).progression({ style: 'idol', bars: 8 }).equals(plan); // false
```

`withSeed`, `withKey` and `withComplexity` each return a new composer, so a variation is written beside the original rather than in place of it. Raising `complexity.rhythmic` adds onsets without moving what is already sounding, and `complexity.difficulty` removes candidates that are too hard rather than making the part simpler in general. See [Determinism and seeding](../determinism-and-seeding.md).

## Layering further passes

`composer.harmonize` and `composer.counterMelody` add parts over the same plan, and a `Score` carries its own passes: `ornament`, `humanize`, `groove`, `quantize`. Each returns a new score, so the source part survives its own treatment and a user can regenerate only the pass they changed:

```ts
import { Composer, Score } from '@libraz/libcantus';

const composer = Composer.of({ key: 'C major', bpm: 112, seed: 24 });
const plan = composer.progression({ style: 'idol', bars: 8 });

const melody = Score.of(
  [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, index) => ({
    pitch,
    startBeat: index * 4,
    durationBeat: 2,
  })),
);

// The default 'complement' rhythm writes where the melody is not moving, so a
// melody leaving the second half of each bar open gives it room to answer.
const counter = composer.counterMelody(melody, {
  timeline: plan.chordTimeline,
  register: 'above',
});
const loosened = counter.humanize();

counter.notes.length; // 21
loosened.notes.length; // 21
melody.notes[0]?.startBeat; // 0
```

The counter-melody generator takes the harmony either way: the `Timeline` itself, or the plain chord timeline `plan.chordTimeline` hands over.

## Before exporting

Name the instrument in the generator options, then verify the result against the same instrument:

```ts
import { Instrument } from '@libraz/libcantus';

const bass4 = Instrument.bass4();

bass4.range(); // { low: 28, high: 67 }
bass4.canSound(24); // false
bass4.foldIntoRange(24); // 36
```

`playability` is the fuller check, and its three layers separate "this note is not on the instrument" from "this is hard at this tempo" — see [Instruments and playability](../instruments-and-playability.md).

Store `composer.data` alongside the emitted notes. It is the whole reproduction recipe: the seed and the `algorithmVersion` the parts were drawn under are resolved into it even when the caller named neither, so `Composer.fromData` reopens the take rather than whatever the build it is reopened on happens to default to. Generation does not write a MIDI file, select a sound, or establish that a result is stylistically appropriate; those decisions belong to the host and its user.
