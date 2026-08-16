# Use case: a reproducible generative arrangement

Use one seed per composition and derive every generated part from the same harmonic plan. A preview is then repeatable, while the host stays free to store or edit the emitted note events. A `Composer` is where the seed, the key, the tempo and the complexity dials live, so each part inherits them instead of restating them.

```ts
import { Composer, Instrument } from '@libraz/libcantus';

const bass4 = Instrument.bass4();
const composer = Composer.of({
  key: 'C major',
  bpm: 112,
  seed: 24,
  complexity: { rhythmic: 0.6, ornament: 0.3, difficulty: 3 },
});

const plan = composer.progression({ style: 'idol', bars: 8, reharmonize: true });
const bass = composer.bass(plan, { style: 'pop', instrument: bass4.data });
const drums = composer.drums({ bars: 8, style: 'funk', section: 'chorus' });

plan.segments.length; // 8
plan.totalBeats; // 32
plan.roman().map((entry) => entry.roman);
// ['IV', 'V', 'iii', 'vi', 'IV', 'V', 'iii', 'vi']

bass.notes.length; // 27
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
const plan = composer.progression({ style: 'idol', bars: 8, reharmonize: true });

const melody = Score.of(
  [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, index) => ({
    pitch,
    startBeat: index,
    durationBeat: 1,
  })),
);

const counter = composer.counterMelody(melody, { timeline: plan.chordTimeline, style: 'thirds' });
const loosened = counter.humanize();

counter.notes.length; // 2
loosened.notes.length; // 2
melody.notes[0]?.startBeat; // 0
```

The counter-melody generator reads the harmony as a plain chord timeline rather than as a `Timeline`, which is what `plan.chordTimeline` hands it; the bass generator takes the timeline itself.

## Before exporting

Name the instrument in the generator options — as `bass4.data`, since the generators take the profile rather than the class around it — then verify the result against the same instrument:

```ts
import { Instrument } from '@libraz/libcantus';

const bass4 = Instrument.bass4();

bass4.range(); // { low: 28, high: 67 }
bass4.canSound(24); // false
bass4.foldIntoRange(24); // 36
```

`playability` is the fuller check, and its three layers separate "this note is not on the instrument" from "this is hard at this tempo" — see [Instruments and playability](../instruments-and-playability.md).

Store the seed, the resolved `algorithmVersion`, and every option alongside the emitted notes; `composer.data` is the settings half of that record. Generation does not write a MIDI file, select a sound, or establish that a result is stylistically appropriate; those decisions belong to the host and its user.
