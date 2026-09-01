# Instruments and playability

An `InstrumentProfile` describes an instrument by what it is, not by the range it happens to have. The playability check then answers "can this passage be played on it, and how hard is it" without rewriting or rejecting anything — inspection is deliberately separate from generation.

MIDI pitch numbers, spelled notes and intervals are the vocabulary this page works in. [The pitch and intervals primer](primer/pitch-and-intervals.md) teaches them and names the API for each.

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

An entry point that takes an instrument takes either surface, and `toInstrumentProfile` is what widens whatever the caller holds — a profile a project file stored, a built-in constant, or an `Instrument` — to one plain profile. `toStringedProfile` narrows the same value to the stringed family, which is what a routine with only a neck to work with needs: a bass line placed on strings and frets cannot be written for a kit, and saying so by name is more use than a missing `tuning` surfacing later as a note the generator could not place.

```ts
import { DRUM_KIT, Instrument, toInstrumentProfile, toStringedProfile } from '@libraz/libcantus';

toInstrumentProfile(Instrument.guitar()).name; // 'guitar'
toInstrumentProfile(DRUM_KIT).kind; // 'percussion'
toStringedProfile(Instrument.bass4()).tuning; // [28, 33, 38, 43]
```

Both validate as they go, so a neck with no strings, a fret count that is no count, or a kit no limb reaches is an `InvalidInputError` naming the instrument rather than a failure further in.

## Fingerings and folding

```ts
import { fingeringsFor, foldIntoRange, GUITAR_STANDARD } from '@libraz/libcantus';

fingeringsFor(GUITAR_STANDARD, 64).length >= 1; // true
fingeringsFor(GUITAR_STANDARD, 64)[0]; // { string: 0, fret: 24 }

foldIntoRange(20, GUITAR_STANDARD); // 44
```

`fingeringsFor` returns every string/fret position that produces a pitch, which is what a tab renderer or a fingering picker needs. `foldIntoRange` answers with the nearest octave of the pitch that the instrument actually sounds — the upper one when two are equally near, and the pitch unchanged when no octave of it is available — for an importer that must keep a part playable rather than report it as impossible. A range need not be gapless, so on a kit the octave below can be the nearer one:

```ts
import { DRUM_KIT, foldIntoRange } from '@libraz/libcantus';

foldIntoRange(58, DRUM_KIT); // 46
foldIntoRange(100, DRUM_KIT); // 100
```

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

Layer 3 has one threshold per family, and they are physical rather than stylistic. A fretting hand shifts at most 100 frets per second along the neck, and one limb strikes at most once every 0.06 seconds; a passage asking for more raises `tooFast`. Each issue also says whether practice can fix it. `impossible` is true for layers 1 and 2, which the instrument alone decides, and false for `tooFast`, which is a matter of degree:

```ts
import { GUITAR_STANDARD, playability } from '@libraz/libcantus';

const leaps = [40, 64, 41, 65, 42, 66].map((pitch, i) => ({
  pitch,
  startBeat: i * 0.0625,
  durationBeat: 0.0625,
}));

const report = playability(leaps, GUITAR_STANDARD, 400);

report.issues[0]?.type; // 'tooFast'
report.issues[0]?.layer; // 3
report.issues.every((issue) => issue.impossible === false); // true
```

`placements` carries one entry per note, in the order the notes arrived, and reports how each note that has a position at all would be produced — string and fret, or the striking limb — whether or not the passage raised issues, so a caller can apply its own standard instead of this module's. A note the instrument cannot sound keeps its entry with neither field set.

A note of zero or negative length strikes nothing, so it takes no limb and no time: it keeps a `placements` entry, and two of them on the same voice at the same instant raise neither `limbConflict` nor `tooFast`. Its pitch is still checked, since whether the instrument has the note does not depend on how long it is held.

```ts
import { DRUM_KIT, playability } from '@libraz/libcantus';

const silent = [
  { pitch: 36, startBeat: 0, durationBeat: 0 },
  { pitch: 36, startBeat: 0.01, durationBeat: 0 },
];

playability(silent, DRUM_KIT, 200).issues.length; // 0
playability(silent, DRUM_KIT, 200).placements.length; // 2
```

A `Score` runs the same check against the instrument it is handed, and answers layer 3 from its whole tempo map rather than from one marking, so a passage under an accelerando is judged at the tempo actually in force across it. The beats the issues name are the score's own:

```ts
import { Instrument, Score } from '@libraz/libcantus';

const score = Score.of([{ pitch: 27, startBeat: 0, durationBeat: 1 }]);

score.playability(Instrument.bass4()).issues[0]?.type; // 'noteOutOfRange'
```

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

Written pitch and sounding pitch differ for most wind instruments: a transposing instrument is one whose part is written in a key other than the one it sounds in, so a written C on a clarinet in B-flat sounds a B-flat. `TRANSPOSING_INSTRUMENTS` names the common ones by their interval, and the two conversions move between the two worlds:

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

`Instrument.soundingPitch` looks the transposition up by the profile's own name, so a guitar names nothing at all — `GUITAR_STANDARD` and `GUITAR_DROP_D` both resolve to the guitar's octave. Every other profile takes one explicitly, the two basses and `DRUM_KIT` included, and otherwise raises an `InvalidInputError` naming the instrument it could not find:

```ts
import { Instrument } from '@libraz/libcantus';

Instrument.guitar().soundingPitch('C4').name; // 'C3'
Instrument.guitarDropD().soundingPitch('C4').name; // 'C3'
Instrument.guitar().soundingPitch('C4', '-P4').name; // 'G3'
Instrument.bass4().soundingPitch('C4', '-P8').name; // 'C3'
```

A guitar part is printed an octave above concert pitch, so the guitar answers `C3` for a written `C4` without being told. An electric bass sounds an octave below its part too — the double bass is in the table at `-P8` for exactly that reason — but the bass profiles are not in the table, so `Instrument.bass4().soundingPitch('C4')` raises rather than transposing. Name the `'-P8'`, or the `'doubleBass'` entry that spells it.

Analysis works on sounding pitch. Convert on the way in from a part written for a transposing instrument, and convert back on the way out when producing that player's part; see [Interoperability](interoperability.md).

## Articulations

`ARTICULATIONS` lists the techniques a `NoteEvent` can carry, and a profile lists the ones its instrument can produce. An articulation the profile does not list, but `ARTICULATIONS` does, raises `articulationUnavailable` at layer 1: it is not a difficulty, it is a note the instrument cannot make that way. A name outside `ARTICULATIONS` altogether is an `InvalidInputError` from `playability`, `Score.of` and `Score.fromJSON`, since nothing has been written that an instrument could fail to play.

## Note safety

For a host that has to decide what may sound next — an improvisation aid, a jam mode — `evaluateSafety` and `enumerateSafePitches` score pitches against the current harmony rather than against the instrument. `NoteSafety` and `ReasonFlag` give the verdict and the reasons behind it, so a UI can shade a keyboard rather than silently forbid keys.
