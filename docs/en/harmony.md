# Harmony

The musical vocabulary this page assumes — chord, degree, function, cadence — is taught in [the primer's harmony page](primer/harmony.md).

## Chords are structured values

A chord symbol is parsed into chord data: a root pitch class, the intervals above it, and an optional bass. The structural reading of that data is a separate step — `chordSpecOf` derives a `ChordSpec`, a base quality plus sevenths, alterations, additions, omissions, and an optional bass. The model is not limited to a fixed list of chord names.

```ts
import { Chord, Key, chordSpecOf } from '@libraz/libcantus';

Key.major('C').roman('V7/V').symbol(); // 'D7'
Chord.parse('F#m7b5').pitchClasses(); // [0, 4, 6, 9]

const altered = Chord.parse('C7(b9,#11)');

altered.spec.alterations;
// [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }]
chordSpecOf(altered.data).alterations;
// [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }]
```

`Chord.spec` is the one-step form; `chordSpecOf` reads plain chord data, which is why it has to be handed `chord.data`. `Chord` values can be inverted, transposed, formatted, and converted to a progression. The pure functions `makeChord`, `chordFromSpec`, `chordPitchClasses`, and `formatChordSymbol` expose the same data model without class wrappers.

A symbol survives a round trip — a chord no quality name covers included — and an inversion is carried as a bass pitch class rather than as a reordered interval list. Omissions are the one exception: a tone a chord leaves out is not written, so `'C7(omit3)'` formats as `'C7'` and parses back with its third. The round trip holds for the root, the slash bass, and the sounding tones, less whatever `chordSpecOf(chord).omissions` names:

```ts
import { Chord, formatChordSymbol, parseChordSymbol } from '@libraz/libcantus';

formatChordSymbol(parseChordSymbol('Cmaj7')); // 'Cmaj7'
formatChordSymbol(parseChordSymbol('Cmaj7sus4')); // 'Cmaj7sus4'
formatChordSymbol(parseChordSymbol('C6/9(#11)')); // 'C6/9(#11)'
Chord.parse('C/E').data.bassPc; // 4
Chord.parse('C/E').pitchClasses(); // [0, 4, 7]
```

`chordToneRole` names what a pitch class does in a chord, and `isChordMember` tests membership — both are what a UI needs to shade a piano roll against the current harmony.

`chordQualities()` is the whole vocabulary of quality names, which is what a quality picker is populated from. The order is the order the qualities are declared, and it is stable — chord detection uses it as a final tie-break — so a menu built from it keeps its arrangement between runs. It is neither alphabetical nor a ranking:

```ts
import { chordQualities } from '@libraz/libcantus';

chordQualities().length; // 43
chordQualities().slice(0, 4); // ['maj', 'min', 'dim', 'aug']
```

`transposeChord` moves chord data by a signed number of semitones, root and bass together, and `transposeChordSymbol` does the same to the text, reading and writing it in one notation system. `ChordSymbolOptions.flats` picks the side of the staff the whole symbol is written on, so a symbol never comes back pairing a flat root with a sharp bass:

```ts
import { formatChordSymbol, parseChordSymbol, transposeChord, transposeChordSymbol } from '@libraz/libcantus';

formatChordSymbol(transposeChord(parseChordSymbol('C/E'), 2)); // 'D/F#'
transposeChordSymbol('Bb/F', 1); // 'B/F#'
transposeChordSymbol('Bb/F', 1, { flats: true }); // 'Cb/Gb'
```

Left to itself the transposition respells whatever would otherwise be a name no chart writes, which is why raising `Bb/F` a semitone gives `B/F#`. Asking for flats keeps the chord on one side instead, `Cb/Gb` and not the `B/Gb` that is no chord at all.

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

The three augmented sixths are predominants — chords that lead to the dominant — standing on the lowered sixth degree, each carrying an augmented sixth above that bass whose two notes resolve outward onto the dominant. An interval is a matter of written letters, so these chords are identified from their spelling rather than from their pitch classes: over an Ab bass the augmented sixth is F#, and the same sounding note written Gb is the minor seventh of an ordinary bVI7.

```ts
import { augmentedSixthChord, augmentedSixthKind, chordToRoman, formatNote, majorKey, spellAugmentedSixth, parseNote } from '@libraz/libcantus';

const key = majorKey(0);
const german = augmentedSixthChord('german', key);

augmentedSixthKind(german, key); // 'german'
chordToRoman(german, key); // 'Ger6'
spellAugmentedSixth('german', parseNote('C')).map((note) => formatNote(note)); // ['Ab', 'C', 'Eb', 'F#']
```

No Roman numeral spells an augmented sixth, so the three always render as `It6`, `Fr6`, and `Ger6` and need no rendering switch of their own. They do take a target the way any other numeral does, so under `applied: true` an analysis can say which degree a chromatic predominant points at:

```ts
import { chordToRoman, majorKey, romanToChord } from '@libraz/libcantus';

const home = majorKey(0);
const pointingAtV = romanToChord('Ger6/V', home);

chordToRoman(pointingAtV, home, { applied: true }); // 'Ger6/V'
chordToRoman(pointingAtV, home); // 'bIII7'
```

That reading is taken only from a chord carrying its own tone spellings. A chord that arrives with no letters is spelled by stacking thirds, and that stack writes a French sixth correctly by accident, so reading six candidate degrees from bare pitch classes would take altered dominants nobody spelled and call them exotic chords. A caller holding pitch classes alone gets the letters from `augmentedSixthFromPitchClasses`, which reads a set of sounding pitch classes over a sounding bass and hands back the chord spelled, or `null` where they spell no augmented sixth:

```ts
import { augmentedSixthFromPitchClasses, majorKey, noteNames } from '@libraz/libcantus';

const home = majorKey(0);
const german = augmentedSixthFromPitchClasses([8, 0, 3, 6], 8, home);

noteNames(german?.toneSpellings ?? []); // ['Ab', 'C', 'Eb', 'F#']
augmentedSixthFromPitchClasses([0, 4, 7], 0, home); // null
```

The Neapolitan — the major triad built on the lowered second degree — does have a numeral, `bII6` in first inversion, and renders as `N6` only when `neapolitan: true`, since both spellings are correct and the choice is a house style.

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

Figured bass writes a harmony as digits under its bass note, each digit an interval above that bass. Those intervals are taken from the key, so the same figure can produce different spellings at different degrees. `realizeFiguredBass`, `spellChord`, `checkPartWriting`, and `checkSpecies` work with spelled notes and return violations or explanations rather than silently rewriting the exercise. Every spelling function is given the key's own tonic; a tonic sounding a different pitch class than the key root is rejected rather than spelled.

```ts
import { Key, formatNote, parseNote, realizeFiguredBass, spellChord } from '@libraz/libcantus';

const chord = realizeFiguredBass(parseNote('D'), '6', Key.major('C').scale);
spellChord(chord, parseNote('C'), Key.major('C').scale).map((note) => formatNote(note));
// ['B', 'D', 'F']
```

`figuredBassOf` goes the other way, naming the figure a chord and bass would be written with. `figuredBassRealization` is the full reading in the first direction — the chord, its spelled notes, and any suspension a moving figure such as `4-3` names — where `realizeFiguredBass` returns the chord alone. The two directions are exact inverses: `figuredBassOf` reads its own figures back before returning them, so a chord it figures realizes to the chord it was figured from, and a chord the digits would only approximate has no figures at all rather than figures that fail to realize.

An accidental written on a figure names its note exactly as the same sign does on the staff, rather than naming a distance from the key. A minor key whose signature already flattens its seventh degree therefore writes its leading tone `n3` and not `#3`: in C minor the third above the dominant is the B the signature flattens, and a score prints a natural in front of it. The crossed or slashed figure, typed `+`, is the one sign that moves an interval instead of naming it — it raises whatever the key gives by a semitone, so `+3` is the leading tone in either key.

```ts
import { figuredBassOf, figuredBassRealization, Key, makeChord, noteNames, parseNote } from '@libraz/libcantus';

figuredBassOf(makeChord(7, 'maj'), Key.minor('C')); // 'n3'
figuredBassOf(makeChord(4, 'maj'), Key.minor('A')); // '#3'

noteNames(figuredBassRealization(parseNote('G'), '+3', Key.minor('C')).notes); // ['G', 'B', 'D']
noteNames(figuredBassRealization(parseNote('E'), '+3', Key.minor('A')).notes); // ['E', 'G#', 'B']
```

The French sixth is the one member of the augmented-sixth family that stacks in thirds over a root of its own, so it is the one the notation reaches, written `#643`. The Italian and German sixths stack over no root and have no figures.

```ts
import { augmentedSixthChord, figuredBassOf, figuredBassRealization, majorKey, noteNames, parseNote } from '@libraz/libcantus';

figuredBassOf(augmentedSixthChord('french', majorKey(0)), majorKey(0)); // '#643'
noteNames(figuredBassRealization(parseNote('Ab'), '#643', majorKey(0)).notes);
// ['Ab', 'C', 'D', 'F#']
```

The part-writing and species checkers are covered in [Counterpoint and part-writing](counterpoint-and-part-writing.md).

## Where harmony is inferred rather than given

Everything above starts from a chord the caller already has. Recognizing chords from note events, labelling them over time, and finding cadences are covered in [Analysis](analysis.md).
