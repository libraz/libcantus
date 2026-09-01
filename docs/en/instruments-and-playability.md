# Instruments and playability

An `InstrumentProfile` describes an instrument by what it is, not by the range it happens to have. The playability check then answers "can this passage be played on it, and how hard is it" without rewriting or rejecting anything — inspection is deliberately separate from generation.

## Profiles

A stringed profile is a tuning, a fret count, and a stretch limit. The sounding range follows from those: string `s` sounds from `tuning[s]` to `tuning[s] + frets`.

```ts
import { BASS_4_STRING, canSound, GUITAR_DROP_D, GUITAR_STANDARD, instrumentRange } from '@libraz/libcantus';

GUITAR_STANDARD.kind; // 'stringed'
GUITAR_STANDARD.tuning; // [40, 45, 50, 55, 59, 64]
instrumentRange(BASS_4_STRING); // { low: 28, high: 67 }

canSound(GUITAR_DROP_D, 38); // true
canSound(GUITAR_STANDARD, 38); // false
```

Storing `[min, max]` instead would make a five-string bass, a drop tuning, and an extended-range neck three unrelated special cases, and would leave "the neck is not long enough" indistinguishable from "the note is below the instrument".

A percussion profile is described by limbs rather than range: `reach` says which limbs can strike each voice, in preference order. A voice no limb can reach is not on the instrument, and two voices needing the same limb at the same instant cannot both sound.

`overdub` names the voices played on a pass of their own. A tambourine or a shaker riding a groove whose backbeat already commits both hands is a second pass, not a third arm, so an overdubbed voice takes no limb from the kit and none from another overdub — it still keeps its `reach` entry, because it is held in a hand on its own pass.

The built-in stringed profiles are `BASS_4_STRING`, `BASS_5_STRING`, `GUITAR_STANDARD`, and `GUITAR_DROP_D`; `DRUM_KIT` is the built-in percussion profile, a kit whose limbs and reach are already filled in. Anything else is a plain object literal of the same shape.

## The Instrument class

`Instrument` wraps a profile and answers the same questions with it already bound. The built-in profiles have factories of their own, and `Instrument.of` takes any profile — a built-in constant, `DRUM_KIT`, or a caller's own literal:

```ts
import { DRUM_KIT, Instrument } from '@libraz/libcantus';

Instrument.guitar().range(); // { low: 40, high: 88 }
Instrument.guitarDropD().canSound(38); // true
Instrument.guitar().canSound(38); // false
Instrument.of(DRUM_KIT).kind; // 'percussion'
```

`Instrument.bass4` and `Instrument.bass5` cover the two basses, and `Instrument.data` hands the plain profile back for storage or transport. The rest of this page shows both surfaces; the [generation guide](generation.md) and the use-case pages use the class form throughout.

## Fingerings and folding

```ts
import { fingeringsFor, foldIntoRange, GUITAR_STANDARD } from '@libraz/libcantus';

fingeringsFor(GUITAR_STANDARD, 64).length >= 1; // true
fingeringsFor(GUITAR_STANDARD, 64)[0]; // { string: 0, fret: 24 }

foldIntoRange(20, GUITAR_STANDARD); // 44
```

`fingeringsFor` returns every string/fret position that produces a pitch, which is what a tab renderer or a fingering picker needs. `foldIntoRange` moves a pitch by octaves until it lies inside the instrument, for an importer that must keep a part playable rather than report it as impossible.

An instrument gives the same two answers without repeating the profile:

```ts
import { Instrument } from '@libraz/libcantus';

const guitar = Instrument.guitar();

guitar.fingerings(64)[0]; // { string: 0, fret: 24 }
guitar.foldIntoRange(20); // 44
```

`fingerings` throws for a kit, which has no neck to place a pitch on; `foldIntoRange` applies to both families.

## The three layers of playability

`playability` reports three distinct kinds of obstacle. They are returned together but stay separate, because no amount of skill puts a note on an instrument that does not have it.

| Layer | Meaning | Issue types |
| --- | --- | --- |
| 1 | The note does not exist on the instrument. | `noteOutOfRange`, `articulationUnavailable` |
| 2 | The arrangement does not hold together. | `stringConflict`, `stretchTooWide`, `limbConflict`, `polyphonyExceeded` |
| 3 | There is not enough time. | `tooFast` |

```ts
import { BASS_4_STRING, playability } from '@libraz/libcantus';

const report = playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }], BASS_4_STRING);

report.issues[0]?.type; // 'noteOutOfRange'
report.issues[0]?.layer; // 1
report.difficulty >= 1; // true
```

The class form of the same check reads the passage against an instrument that already holds its profile:

```ts
import { Instrument } from '@libraz/libcantus';

const bass = Instrument.bass4();
const report = bass.playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }]);

report.issues[0]?.type; // 'noteOutOfRange'
report.difficulty >= 1; // true
```

Only layer 3 consults `bpm`. Omitting the tempo therefore reports what the instrument alone decides:

```ts
import { GUITAR_STANDARD, playability } from '@libraz/libcantus';

const run = [60, 62, 64, 65, 67, 69, 71, 72].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.25,
  durationBeat: 0.25,
}));

playability(run, GUITAR_STANDARD).difficulty <= playability(run, GUITAR_STANDARD, 200).difficulty;
// true
```

`difficulty` maps movement per unit time onto 1 (trivial) to 5 (at the limit). Without a tempo the passage is measured at 120 BPM so the number stays comparable between passages; with one it rises as the tempo does.

`placements` reports how every note would be produced — string and fret, or the striking limb — whether or not the passage raised issues, so a caller can apply its own standard instead of this module's.

## Constraining generation

Naming an instrument in a `GenerationContext` is itself the request that the part be playable on it. The range and physical limits then always apply, whatever the difficulty ceiling says:

```ts
import { BASS_4_STRING, canSound, generateBassLine, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const segments = [
  { chord: { rootPc: 0, quality: 'maj' as const, intervals: [0, 4, 7] }, startBeat: 0, endBeat: 4 },
];

const line = generateBassLine({
  segments,
  key,
  style: 'root',
  ctx: { seed: 4, bpm: 100, instruments: { bass: BASS_4_STRING } },
});

line.every((note) => canSound(BASS_4_STRING, note.pitch)); // true
```

`complexity.difficulty` governs the timing layer alone. Whether the note exists, and whether the shape can be held, come from the profile — see [Determinism and seeding](determinism-and-seeding.md) for how the two interact.

## Transposing instruments

Written pitch and sounding pitch differ for most wind instruments. `TRANSPOSING_INSTRUMENTS` names the common ones by their interval, and the two conversions move between the two worlds:

```ts
import { formatNote, instrumentTransposition, parseNote, toSoundingPitch, toWrittenPitch, TRANSPOSING_INSTRUMENTS } from '@libraz/libcantus';

TRANSPOSING_INSTRUMENTS.clarinetBb; // '-M2'
TRANSPOSING_INSTRUMENTS.piccolo; // 'P8'

instrumentTransposition('piccolo');
// { number: 8, quality: 'P', semitones: 12, descending: false }

formatNote(toSoundingPitch(parseNote('C4'), 'clarinetA')); // 'A3'
formatNote(toSoundingPitch(parseNote('D#4'), 'clarinetA')); // 'B#3'
formatNote(toWrittenPitch(parseNote('A3'), 'clarinetA')); // 'C4'
formatNote(toSoundingPitch(parseNote('C4'), '-P4')); // 'G3'
```

Both conversions take spelled notes, because the interval decides the letter: a written D-sharp on a clarinet in A sounds B-sharp, and a semitone count alone would answer C natural and lose the letter the part is written on. A note carrying an octave moves register with it; an octave-less note stays octave-less.

An interval string works in place of a name, so an instrument the table does not list — an alto flute at `-P4` — needs no addition to the library.

Hold the instrument and you name nothing at all: `Instrument.soundingPitch` looks the transposition up by the profile's own name, and takes one explicitly for a profile the table does not carry, which is every profile a caller writes:

```ts
import { Instrument } from '@libraz/libcantus';

Instrument.guitar().soundingPitch('C4').name; // 'C3'
Instrument.guitar().soundingPitch('C4', '-P4').name; // 'G3'
```

A guitar part is printed an octave above concert pitch, so the guitar answers `C3` for a written `C4` without being told.

Analysis works on sounding pitch. Convert on the way in from a part written for a transposing instrument, and convert back on the way out when producing that player's part; see [Interoperability](interoperability.md).

## Articulations

`ARTICULATIONS` lists the techniques a `NoteEvent` can carry, and a profile lists the ones its instrument can produce. An articulation the profile does not list raises `articulationUnavailable` at layer 1: it is not a difficulty, it is a note the instrument cannot make that way.

## Note safety

For a host that has to decide what may sound next — an improvisation aid, a jam mode — `evaluateSafety` and `enumerateSafePitches` score pitches against the current harmony rather than against the instrument. `NoteSafety` and `ReasonFlag` give the verdict and the reasons behind it, so a UI can shade a keyboard rather than silently forbid keys.
