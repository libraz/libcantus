# Use case: preparing a part for a player

A part that a person will read has to satisfy two conditions the sounding pitches do not: it must be playable on the instrument, and it must be written at the pitch that player reads.

```ts
import {
  BASS_4_STRING,
  canSound,
  foldIntoRange,
  formatNote,
  majorKey,
  midiToNote,
  playability,
  spellLine,
  toWrittenPitch,
} from '@libraz/libcantus';

const sounding = [27, 31, 34, 38, 41, 45].map((pitch, i) => ({
  pitch,
  startBeat: i,
  durationBeat: 1,
}));

const before = playability(sounding, BASS_4_STRING, 100);
before.issues[0]?.type; // 'noteOutOfRange'

const fitted = sounding.map((note) => ({ ...note, pitch: foldIntoRange(note.pitch, BASS_4_STRING) }));

fitted.every((note) => canSound(BASS_4_STRING, note.pitch)); // true
playability(fitted, BASS_4_STRING, 100).issues.length; // 0

const spelled = spellLine(fitted, null, majorKey(0));
formatNote(spelled[0] ?? midiToNote(0)); // 'Eb2'

formatNote(toWrittenPitch(midiToNote(60), 'clarinetBb')); // 'D4'
```

## Fitting the part to the instrument

`playability` reports three layers of obstacle, and only the first is about existence: `noteOutOfRange` means the instrument does not have the note at all. `foldIntoRange` moves such a note by octaves until it fits, which is what a player would do with a bass line written below the low string.

The second layer — stretches, string conflicts, limb conflicts, polyphony — cannot be fixed by folding, because it is about how the notes sit together. The third layer, `tooFast`, depends on the tempo passed as the third argument. Omit the tempo to see only what the instrument itself decides.

`difficulty` from 1 to 5 gives a single figure for a part-difficulty display; `placements` gives the string and fret, or the striking limb, for every note, which a tab or drum-notation renderer needs.

## Writing it at the right pitch

Analysis and generation both work in sounding pitch. A part for a transposing instrument has to be converted on the way out:

- `toWrittenPitch(note, instrument)` produces what the player reads.
- `toSoundingPitch(note, instrument)` goes the other way, for a part that arrives already transposed.

Both take spelled notes, because the interval decides the letter. A concert C on a clarinet in B-flat is written D, and a semitone count alone cannot say whether that D should be spelled D or C-double-sharp. `TRANSPOSING_INSTRUMENTS` names the common instruments, and an interval string covers anything it does not list.

The key signature moves with the part. Transpose the key by the same interval and spell the line against the transposed key, or the accidentals will fight the signature.

## Spelling the line

`spellLine` chooses accidentals for the whole voice at once, so a rising chromatic passage takes sharps and a falling one flats. Pass the chord timeline as its second argument to spell each note against the harmony sounding under it. See [Pitch and notation](../pitch-and-notation.md).

For a full score, `beatsToDuration` and `beatsToTiedDurations` convert beat lengths into note values, dots, and tuplets; see [Time and arrangement](../time-and-arrangement.md).

## What the library leaves to the editor

Page turns, cue notes, rehearsal marks, and articulation editorial are outside the library's scope. So is the decision about whether to fold a note or rewrite the passage: folding keeps the part playable, but an octave displacement in the middle of a line is a musical choice, and a host should offer it rather than apply it silently.
