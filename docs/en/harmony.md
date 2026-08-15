# Harmony

## Chords are structured values

Chord symbols are parsed into a `ChordSpec`: a base quality plus sevenths, alterations, additions, omissions, and an optional bass. The model is not limited to a fixed list of chord names.

```ts
import { Chord, Key, chordSpecOf } from '@libraz/libcantus';

Key.major('C').roman('V7/V').symbol(); // 'D7'
Chord.parse('F#m7b5').pitchClasses(); // [0, 4, 6, 9]

const altered = Chord.parse('C7(b9,#11)');
chordSpecOf(altered.data).alterations;
// [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }]
```

`Chord` values can be inverted, transposed, formatted, and converted to a progression. The pure functions `makeChord`, `chordFromSpec`, `chordPitchClasses`, and `formatChordSymbol` expose the same data model without class wrappers.

## Functional harmony

Pass a key when you want a Roman-numeral or function reading. The result carries the chosen interpretation and its rationale:

```ts
import { Chord, Key } from '@libraz/libcantus';

const result = Chord.of('F', 'min').analyze(Key.major('C'));
result.roman; // 'iv'
result.function; // 'subdominant'
result.borrowed; // true
```

`chordToRoman`, `romanToChord`, `analyzeChord`, `functionOf`, and `explainRoman` are the corresponding functional entry points. Borrowed chords, secondary dominants, and augmented-sixth chords keep their spelling and can report rejected alternatives when requested.

## Progressions and voicing

The class API builds a progression from key degrees and can voice it as SATB:

```ts
import { Key } from '@libraz/libcantus';

const c = Key.major('C');
const voicing = c
  .chord(1, 'maj')
  .progressionTo(c.chord(6, 'min'), c.chord(5, 'dom7'), c.chord(1, 'maj'))
  .voice();

voicing;
// [[48, 60, 64, 67], [45, 60, 64, 69], [43, 62, 65, 71], [48, 60, 64, 72]]
```

The functional voicing tools are `voiceChord`, `voiceProgression`, `nextVoicing`, and `voiceLeadingCost`. `Chord.styledVoicing` and `voiceChordStyled` cover shell, drop, and comping-style choices.

## Figured bass and counterpoint

Figured-bass intervals are taken from the key, so the same figure can produce different spellings at different degrees. `realizeFiguredBass`, `spellChord`, `checkPartWriting`, and `checkSpecies` work with spelled notes and return violations or explanations rather than silently rewriting the exercise.

```ts
import { Key, formatNote, parseNote, realizeFiguredBass, spellChord } from '@libraz/libcantus';

const chord = realizeFiguredBass(parseNote('D'), '6', Key.major('C').scale);
spellChord(chord, parseNote('B'), Key.major('C').scale).map(formatNote);
// ['B', 'D', 'F']
```
