# Use case: preparing a part for a player

A part that a person will read has to satisfy two conditions the sounding pitches do not: it must be playable on the instrument, and it must be written at the pitch that player reads.

The flow starts from note events at concert pitch — what everything else in the library produces — and an instrument profile. For the vocabulary here, chiefly the transposing instrument and the key signature that travels with it, see the [primer](../primer/index.md).

```ts
import { Instrument, Score } from '@libraz/libcantus';

const bass = Instrument.bass4();
const part = Score.of(
  [27, 31, 34, 38, 41, 45].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
  { tempo: 100 },
);

// The score reads itself against the instrument, at its own tempo:
part.playability(bass).issues[0]?.type; // 'noteOutOfRange'

const fitted = part.map((note) => ({ ...note, pitch: bass.foldIntoRange(note.pitch) }));

fitted.notes.every((note) => bass.canSound(note.pitch)); // true
fitted.playability(bass).issues.length; // 0
bass.range(); // { low: 28, high: 67 }
```

## Fitting the part to the instrument

`playability` reports three layers of obstacle, and only the first is about existence. It holds two issue types: `noteOutOfRange` means the instrument does not have the note at all, and `articulationUnavailable` that it does not offer the technique the note was written with. `Instrument.foldIntoRange` answers a note out of range with the nearest octave of it the instrument sounds, which is what a player would do with a bass line written below the low string, and `Score.map` carries the whole part through that fold in one step while keeping its meter and tempo.

The second layer — stretches, string conflicts, limb conflicts, polyphony — cannot be fixed by folding, because it is about how the notes sit together. The third layer, `tooFast`, depends on the tempo, which a `Score` already holds; call `Instrument.playability(notes)` with no bpm instead to see only what the instrument itself decides.

`difficulty` from 1 to 5 gives a single figure for a part-difficulty display; `placements` gives the string and fret, or the striking limb, for every note, which a tab or drum-notation renderer needs. `Instrument.fingerings(pitch)` answers the same question for one note, which is what a fingering picker offers a user.

## Writing it at the right pitch

Analysis and generation both work in sounding pitch. A part for a transposing instrument has to be converted on the way out, and the key signature has to travel with it:

```ts
import { Instrument, Key, Note, Score, spellLine } from '@libraz/libcantus';

const bass = Instrument.bass4();
const key = Key.major('C');
const line = Score.of(
  [27, 31, 34, 38, 41, 45].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
).map((note) => ({ ...note, pitch: bass.foldIntoRange(note.pitch) }));

// Accidentals are chosen for the line as a whole. That is a question about a
// melody, and a melody is the one thing here with no class to hold it:
const spelled = spellLine(line.notes, null, key);
spelled.map((note) => Note.fromData(note).name); // ['Eb2', 'G1', 'Bb1', 'D2', 'F2', 'A2']

Note.parse('C4').forInstrument('clarinetBb').name; // 'D4'
key.forInstrument('clarinetBb').toString(); // 'D major'
```

The opening Eb2 is the only note the fold touched: it was written an octave lower, below the instrument's lowest string, and `foldIntoRange` lifted it by exactly that octave.

`Note.forInstrument` produces what the player reads, and `Instrument.soundingPitch` goes the other way, for a part that arrives already transposed. Both work on spelled notes, because the interval decides the letter. A concert C on a clarinet in B-flat is written D, and a semitone count alone cannot say whether that D should be spelled D or C-double-sharp. `TRANSPOSING_INSTRUMENTS` names the common instruments, and an interval string covers anything it does not list.

`Key.forInstrument` moves the signature by the same interval. Spell the line against that transposed key, or the accidentals will fight the signature.

## Spelling the line

`spellLine` chooses accidentals for the whole voice at once, so a rising chromatic passage takes sharps and a falling one flats. Pass a chord timeline as its second argument — `score.timeline().chordTimeline` is the shape it wants — to spell each note against the harmony sounding under it. See [Pitch and notation](../pitch-and-notation.md).

For a full score, `Duration.ofBeats` turns a beat length into a note value with its dots and tuplet, and `Duration.tieChain` splits a length no single value can write into tied ones; see [Time and arrangement](../time-and-arrangement.md).

## What the library leaves to the editor

Page turns, cue notes, rehearsal marks, and articulation editorial are outside the library's scope. So is the decision about whether to fold a note or rewrite the passage: folding keeps the part playable, but an octave displacement in the middle of a line is a musical choice, and a host should offer it rather than apply it silently.
