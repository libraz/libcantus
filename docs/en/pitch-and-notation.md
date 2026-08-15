# Pitch and notation

## Notes and MIDI

`Note` preserves a letter, an alteration, and an optional octave. Use `Note.of` for a class value, or `parseNote` for the plain-data API. A note without an octave has a pitch class but no MIDI number.

```ts
import { Note, parseNote, tryParseNote } from '@libraz/libcantus';

const c4 = Note.of('C4');
c4.name; // 'C4'
c4.midi; // 60
c4.transpose(7).name; // 'G4'

parseNote('Bb3'); // { letter: 6, alter: -1, octave: 3 }
tryParseNote('C#b'); // { ok: false, error: InvalidInputError }
```

`tryParseNote` and the corresponding `tryParseInterval`, `tryParseChordSymbol`, and `Chord.tryParse` methods return a parse result instead of throwing. This is useful for text fields and importers.

## Spelled intervals

An interval includes both its diatonic number and chromatic span. That distinction lets the library preserve the difference between an augmented fourth and a diminished fifth:

```ts
import { Interval, Note } from '@libraz/libcantus';

Interval.between(Note.of('C4'), Note.of('F#4')).name; // 'A4'
Interval.between(Note.of('C4'), Note.of('Gb4')).name; // 'd5'
Note.of('C4').transposeBy('A4').name; // 'F#4'
```

The functional equivalents are `spelledInterval`, `parseInterval`, `transposeByInterval`, and `transposeNote`.

## Keys and scales

`Key` pairs a tonic spelling with a scale mask. Use named constructors for common scales and `Key.named` or `scaleByName` for named modes:

```ts
import { Key, supportsFunctionalHarmony } from '@libraz/libcantus';

Key.major('C').relative().toString(); // 'A minor'
Key.minor('D').transposeBy('A4').toString(); // 'G# minor'
Key.named('miyakoBushi', 'E').noteNames(); // ['E', 'F', 'A', 'B', 'C']
supportsFunctionalHarmony('miyakoBushi'); // false
```

Key relations use the circle of fifths and retain a practical spelling. For example, the relative key of D-flat major is B-flat minor rather than A-sharp minor.

## Spelling a line

`spellLine` considers a whole voice and its key or chord timeline, instead of choosing an accidental independently for every pitch:

```ts
import { majorKey, noteNames, spellLine } from '@libraz/libcantus';

const rising = [60, 61, 62, 63, 64].map((pitch, i) => ({
  pitch,
  startBeat: i,
  durationBeat: 1,
}));

noteNames(spellLine(rising, null, majorKey(0)));
// ['C4', 'C#4', 'D4', 'D#4', 'E4']
```

