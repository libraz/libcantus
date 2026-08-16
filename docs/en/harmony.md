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

A symbol survives a round trip — a chord no quality name covers included — and an inversion is carried as a bass pitch class rather than as a reordered interval list:

```ts
import { Chord, formatChordSymbol, parseChordSymbol } from '@libraz/libcantus';

formatChordSymbol(parseChordSymbol('Cmaj7')); // 'Cmaj7'
formatChordSymbol(parseChordSymbol('Cmaj7sus4')); // 'Cmaj7sus4'
formatChordSymbol(parseChordSymbol('C6/9(#11)')); // 'C6/9(#11)'
Chord.parse('C/E').data.bassPc; // 4
Chord.parse('C/E').pitchClasses(); // [0, 4, 7]
```

`chordToneRole` names what a pitch class does in a chord, and `isChordMember` tests membership — both are what a UI needs to shade a piano roll against the current harmony.

## Chords from a key

A chord can be built from a scale degree instead of a root, which is what lets a progression be written as degrees and transposed by changing the key alone:

```ts
import { chordFromDegree, diatonicSeventh, diatonicTriad, formatChordSymbol, majorKey } from '@libraz/libcantus';

const key = majorKey(0);

formatChordSymbol(diatonicTriad(2, key)); // 'Dm'
formatChordSymbol(diatonicSeventh(5, key)); // 'G7'
formatChordSymbol(chordFromDegree(6, 'min7', key)); // 'Am7'
```

## Functional harmony

A key turns a chord into a Roman-numeral and function reading. The result carries the chosen interpretation and the reasoning behind it:

```ts
import { Chord, Key } from '@libraz/libcantus';

const result = Chord.of('F', 'min').analyze(Key.major('C'));
result.roman; // 'iv'
result.function; // 'subdominant'
result.borrowed; // true
result.source; // 'parallelMinor'
```

`rationale` is always present and states the rule that settled the function. `alternatives` is empty unless asked for:

```ts
import { analyzeChord, makeChord, majorKey } from '@libraz/libcantus';

const plain = analyzeChord(makeChord(2, 'dom7'), majorKey(0));
const withRivals = analyzeChord(makeChord(2, 'dom7'), majorKey(0), { alternatives: true });

plain.alternatives.length; // 0
withRivals.alternatives.length >= 1; // true
typeof withRivals.rationale; // 'string'
```

The rivals are the readings the analysis turned down — the function the degree alone would have carried, the tonicizing reading a dominant sonority could have had, and the numerals the other rendering options would emit. They cost work that most callers do not need, so they are off by default. `explainRoman` gives the same reasoning attached to a single numeral.

`chordToRoman`, `romanToChord`, `analyzeChord`, `functionOf`, `isDiatonic`, and `isMinorKey` are the corresponding functional entry points.

## Chromatic chords that keep their spelling

```ts
import { augmentedSixthChord, augmentedSixthKind, chordToRoman, formatNote, majorKey, spellAugmentedSixth, parseNote } from '@libraz/libcantus';

const key = majorKey(0);
const german = augmentedSixthChord('german', key);

augmentedSixthKind(german, key); // 'german'
chordToRoman(german, key); // 'Ger6'
spellAugmentedSixth('german', parseNote('C')).map(formatNote); // ['Ab', 'C', 'Eb', 'F#']
```

No Roman numeral names an augmented sixth, so the three render as `It6`, `Fr6`, and `Ger6`. The Neapolitan does have a numeral — `bII6` in first inversion — and renders as `N6` only when `neapolitan: true`, since both spellings are correct and the choice is a house style.

Secondary dominants and borrowed chords are covered in [Key relations and modulation](key-relations-and-modulation.md); deliberate substitution is in [Reharmonization](reharmonization.md).

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

The functional voicing tools are `voiceChord`, `voiceProgression`, `nextVoicing`, and `voiceLeadingCost`. `Chord.styledVoicing` and `voiceChordStyled` cover shell, drop, and comping-style choices. See [Voicing](voicing.md) for the search options and the styles.

## Figured bass and counterpoint

Figured-bass intervals are taken from the key, so the same figure can produce different spellings at different degrees. `realizeFiguredBass`, `spellChord`, `checkPartWriting`, and `checkSpecies` work with spelled notes and return violations or explanations rather than silently rewriting the exercise. Every spelling function is given the key's own tonic; a tonic sounding a different pitch class than the key root is rejected rather than spelled.

```ts
import { Key, formatNote, parseNote, realizeFiguredBass, spellChord } from '@libraz/libcantus';

const chord = realizeFiguredBass(parseNote('D'), '6', Key.major('C').scale);
spellChord(chord, parseNote('C'), Key.major('C').scale).map(formatNote);
// ['B', 'D', 'F']
```

`figuredBassOf` goes the other way, naming the figure a chord and bass would be written with. The part-writing and species checkers are covered in [Counterpoint and part-writing](counterpoint-and-part-writing.md).

## Where harmony is inferred rather than given

Everything above starts from a chord the caller already has. Recognizing chords from note events, labelling them over time, and finding cadences are covered in [Analysis](analysis.md).
