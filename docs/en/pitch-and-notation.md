# Pitch and notation

If the musical vocabulary here is unfamiliar, [Pitch and intervals](primer/pitch-and-intervals.md) in the primer teaches the terms this page uses.

## Notes and MIDI

`Note` preserves a letter, an alteration, and an optional octave. Use `Note.parse` to read a name into a class value, `Note.of` to build one from its parts, or `parseNote` for the plain-data API. A note without an octave has a pitch class but no MIDI number.

```ts
import { Note, parseNote, tryParseNote } from '@libraz/libcantus';

const c4 = Note.parse('C4');
c4.name; // 'C4'
c4.midi; // 60
c4.transpose(7).name; // 'G4'

parseNote('Bb3'); // { letter: 6, alter: -1, octave: 3 }
tryParseNote('C#b').ok; // false
```

`tryParseNote` and the corresponding `tryParseInterval`, `tryParseChordSymbol`, `tryParseKeyName` and `tryParseTimeSignature` functions return a parse result for invalid text, as do the `tryParse` methods on `Note`, `Interval`, `Key`, and `Chord`. Their options remain validated API arguments, so malformed options can still raise `InvalidInputError`. This is useful for text fields and importers; see [Errors and validation](errors-and-validation.md).

The conversions between spelled notes and MIDI are separate functions, because they lose different things:

```ts
import { formatNote, midiToNote, noteToMidi, noteToPitchClass, parseNote } from '@libraz/libcantus';

noteToMidi(parseNote('Bb3')); // 58
noteToPitchClass(parseNote('Db')); // 1
formatNote(midiToNote(58)); // 'A#3'
```

`midiToNote` has no key context, so it picks a default spelling. Use `spellPitch`, `spellPitchClass`, or `spellLine` when the spelling matters.

## Spelled intervals

A `SpelledInterval` has four required fields: `number`, the diatonic size counted in letters, so a third is 3 whatever its quality; `quality`, one of `P`, `M`, `m`, or a run of `A` or `d` for augmented and diminished; `semitones`, the signed chromatic span; and `descending`. Carrying the number alongside the span is what preserves the difference between an augmented fourth and a diminished fifth, which sound the same and are written differently:

```ts
import { Interval, Note } from '@libraz/libcantus';

Interval.between(Note.parse('C4'), Note.parse('F#4')).name; // 'A4'
Interval.between(Note.parse('C4'), Note.parse('Gb4')).name; // 'd5'
Note.parse('C4').transposeBy('A4').name; // 'F#4'
```

`descending` is required and is not read off the sign of `semitones`: a descending unison spans zero semitones, and a doubly diminished second climbs a letter while the pitch falls. The text form marks the direction with a leading `-`, which `parseInterval` reads and `Interval.name` writes:

```ts
import { Interval, Note, parseInterval, spelledInterval } from '@libraz/libcantus';

parseInterval('-P5'); // { number: 5, quality: 'P', semitones: -7, descending: true }
parseInterval('dd2'); // { number: 2, quality: 'dd', semitones: -1, descending: false }
spelledInterval(Note.parse('G4'), Note.parse('C4')); // { number: 5, quality: 'P', semitones: -7, descending: true }
Interval.between(Note.parse('G4'), Note.parse('C4')).name; // '-P5'
```

The functional equivalents are `spelledInterval`, `parseInterval`, `transposeByInterval`, and `transposeNote`.

Intervals also classify by consonance — how stable two notes sound together — which is what the counterpoint rules are built on:

```ts
import { classifyInterval, ConsonanceClass, isConsonantInterval, isPerfectInterval } from '@libraz/libcantus';

classifyInterval(7); // ConsonanceClass.PerfectConsonance
classifyInterval(5); // ConsonanceClass.Dissonance
classifyInterval(5, false); // ConsonanceClass.ImperfectConsonance
isPerfectInterval(7); // true
isConsonantInterval(4); // true
```

The perfect fourth is the reason `classifyInterval` takes a second argument. In two-voice writing it counts as a dissonance; supported from below in a fuller texture it does not. The default is the two-voice reading, which is what species counterpoint assumes.

The class the fourth falls into with `twoVoice` off is `ImperfectConsonance`, and that is a convention of this API rather than of theory: conventional theory calls a consonant fourth a perfect consonance. `ConsonanceClass` exists to separate the intervals the parallel-motion rules watch — the unison, octave, and fifth — from the ones they do not, and the fourth is not watched. That is the same reason `isPerfectInterval` answers `false` for it. Both answers describe what the rule set watches, not what the interval is.

`classifyInterval` reads a semitone count, so it cannot tell a diminished fourth from a major third. `classifySpelledInterval` takes the spelled interval instead and lets the spelling decide, which is the form to reach for when the input is already spelled:

```ts
import { classifySpelledInterval, ConsonanceClass, parseInterval } from '@libraz/libcantus';

classifySpelledInterval(parseInterval('M3')); // ConsonanceClass.ImperfectConsonance
classifySpelledInterval(parseInterval('d4')); // ConsonanceClass.Dissonance
classifySpelledInterval(parseInterval('P4')); // ConsonanceClass.Dissonance
classifySpelledInterval(parseInterval('P4'), false); // ConsonanceClass.ImperfectConsonance
```

A diminished fourth sounds like a major third and still counts as a dissonance, which is what a counterpoint check has to see.

## Keys and scales

`Key` pairs a tonic spelling with a scale mask. Use named constructors for common scales and `Key.named` or `scaleByName` for named modes:

```ts
import { Key, supportsFunctionalHarmony } from '@libraz/libcantus';

Key.major('C').relative().toString(); // 'A minor'
Key.minor('D').transposeBy('A4').toString(); // 'G# minor'
Key.named('miyakoBushi', 'E').noteNames(); // ['E', 'F', 'A', 'B', 'C']
supportsFunctionalHarmony('miyakoBushi'); // false
```

Key relations use the circle of fifths and retain a practical spelling. For example, the relative key of D-flat major is B-flat minor rather than A-sharp minor. See [Key relations and modulation](key-relations-and-modulation.md) for the full set, and [Scales and modes](scales-and-modes.md) for the mask representation.

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

A rising chromatic line takes sharps and a falling one takes flats, which is what a reader expects and what a note-by-note choice cannot produce. Pass a chord timeline as the second argument to spell each note against the harmony sounding under it, and `tonic` in the options when the piece writes its key differently from the conventional spelling.

The related functions cover the smaller cases: `spellPitch` for one pitch in a key, `spellPitchClass` for one pitch class, `spellPitchClasses` for several, `spellChord` and `spellChordFromRoot` for a chord, `spellScale` for a scale, and `spellVoicing` for a voicing.

## Note names in other systems

Names are read and written in English, German, Japanese, Italian, and fixed-do. On parsing the system is detected; on formatting it defaults to English. See [Interoperability](interoperability.md).

## Frequencies

Nothing above involves frequency. When actual pitch in hertz is needed — a tuner, microtonal playback, an analysis bridge — see [Tuning and frequency](tuning-and-frequency.md).
