# Key relations and modulation

A key is a root pitch class plus a mode mask, which says nothing about how it is written. The relation functions add that: they travel around the circle of fifths and read the tonic back off it, which is what keeps the spelling right.

## Spelling a key

`SpelledKey` pairs a key with the spelled tonic that anchors its letter names. The tonic carries no octave, because a key is rooted on a pitch class:

```ts
import { formatNote, majorKey, scaleByName, spelledKeyOf } from '@libraz/libcantus';

formatNote(spelledKeyOf(majorKey(1)).tonic); // 'Db'
formatNote(spelledKeyOf(scaleByName('harmonicMinor', 8)).tonic); // 'G#'
```

Among the signatures in [-7, 7] whose key has the requested root, the one with the fewest accidentals names it — so pitch class 1 in major is Db with five flats rather than C# with seven sharps. A scale that is not a diatonic mode keeps its own mask and borrows only the tonic spelling of its parallel major or minor: G# harmonic minor is spelled G# and stays harmonic minor.

## Key signatures

```ts
import { formatNote, keyFromFifths, keySignatureFifths, majorKey, parseNote } from '@libraz/libcantus';

keySignatureFifths(parseNote('D'), majorKey(2)); // 2
keySignatureFifths(parseNote('Eb'), majorKey(3)); // -3

const twoSharps = keyFromFifths(2, 'major');
formatNote(twoSharps.tonic); // 'D'
```

The count is signed: positive is sharps, negative is flats. `keyFromFifths` is the inverse, and takes the mode because one signature names two keys.

## The closely related keys

```ts
import { formatNote, majorKey, parseNote, relatedKeysOf } from '@libraz/libcantus';

const related = relatedKeysOf(parseNote('C'), majorKey(0));

related.map((entry) => entry.relation);
// ['relative', 'parallel', 'dominant', 'subdominant', 'relativeOfDominant', 'relativeOfSubdominant']
related.map((entry) => formatNote(entry.tonic));
// ['A', 'C', 'G', 'F', 'E', 'D']
```

Each relation is also available on its own — `relativeKeyOf`, `parallelKeyOf`, `dominantKeyOf`, `subdominantKeyOf` — and `enharmonicKeyOf` gives the other spelling of the same sounding key, or `null` when there is no conventional one.

```ts
import { formatNote, majorKey, parseNote, relativeKeyOf } from '@libraz/libcantus';

formatNote(relativeKeyOf(parseNote('Db'), majorKey(1)).tonic); // 'Bb'
```

The relative of D-flat major is B-flat minor, not A-sharp minor. Every relation but the parallel is computed in fifths space for exactly this reason; the parallel travels no fifths, so it keeps the tonic spelling it was given.

`keyRelationBetween` answers the reverse question:

```ts
import { keyRelationBetween, majorKey, minorKey, parseNote } from '@libraz/libcantus';

const cMajor = { tonic: parseNote('C'), key: majorKey(0) };

keyRelationBetween(cMajor, { tonic: parseNote('A'), key: minorKey(9) }); // 'relative'
keyRelationBetween(cMajor, { tonic: parseNote('Eb'), key: minorKey(3) }); // null
```

Relations are tested in a fixed order and the first match wins. Only the identity test looks at the tonic spelling, so C-sharp minor and D-flat minor both read as the relative of E major.

## Finding modulations in a piece

Key regions are inferred, not declared. `keyTimelineFromNotes` searches note events directly; `detectModulations` works from an already-inferred chord timeline, which is usually the better input because chords carry more evidence per beat than raw pitches.

```ts
import { chordTimelineFromChords, detectModulations } from '@libraz/libcantus';

const timeline = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj', startBeat: 0 },
    { rootPc: 7, quality: 'dom7', startBeat: 4 },
    { rootPc: 0, quality: 'maj', startBeat: 8 },
    { rootPc: 2, quality: 'dom7', startBeat: 12 },
    { rootPc: 7, quality: 'maj', startBeat: 16 },
    { rootPc: 4, quality: 'min', startBeat: 20 },
    { rootPc: 9, quality: 'min7', startBeat: 24 },
    { rootPc: 2, quality: 'dom7', startBeat: 28 },
    { rootPc: 7, quality: 'maj', startBeat: 32 },
  ],
  36,
);

const regions = detectModulations(timeline.segments);
regions.length >= 1; // true
regions[0]?.startBeat; // 0
```

Each `KeyRegion` carries its span, the key in force, and a `confidence` in [0, 1] — the correlation between the span's pitch-class distribution and the key's profile. A modulation is a proposal supported by evidence, not a fact: show the confidence and let a user override the reading.

Both functions take the same options. The ones that matter most in practice:

- `ts` or `meters` — the meter, so bar lines and metric accents are read correctly. Give one when the piece is not in 4/4.
- `expectedKeyBeats` — how long a key is expected to hold, which sets how eagerly the search proposes a new region. It defaults to four bars.
- `minKeyBeats` — the shortest region the search will emit, one bar by default. Raise it when brief tonicizations are being reported as modulations.

`prevailingKeyOf` collapses a set of regions to the single key that holds for most of the span, which is what a global label in a UI should show.

## Pivot chords

A pivot chord is diatonic in both the old key and the new one, and it is the smoothest way to explain a modulation to a reader:

```ts
import { majorKey, pivotChords } from '@libraz/libcantus';

pivotChords(majorKey(0), majorKey(7)).map((pivot) => `${pivot.romanFrom}=${pivot.romanTo}`);
// ['I=IV', 'iii=vi', 'V=I', 'vi=ii']
```

Each entry gives the chord and its numeral in both keys. When key regions come from `detectModulations`, the chord that straddles the boundary is attached to the region, so a report can name the pivot rather than only the beat where the key changed.

## Tonicization without modulation

Not every chromatic chord is a key change. A secondary dominant tonicizes a degree for a moment and leaves the key intact:

```ts
import { Chord, chordToRoman, majorKey, secondaryDominant, secondaryDominantOf } from '@libraz/libcantus';

const key = majorKey(0);

chordToRoman(secondaryDominant(5, key), key); // 'II7'
chordToRoman(secondaryDominant(5, key), key, { applied: true }); // 'V7/V'
chordToRoman(secondaryDominantOf(Chord.of('A', 'min').data), key, { applied: true }); // 'V7/vi'
```

`applied` is off by default. Naming the root against the home key is always a correct spelling; whether a chromatic dominant is genuinely *applied* is a reading only the caller can make. Turning it on also makes `chordToRoman` the exact inverse of `romanToChord` for the chords `secondaryDominant` builds.

Borrowed chords are the other common case: the chord comes from the parallel mode and the tonic does not move.

```ts
import { borrowedSource, Chord, isBorrowedChord, majorKey, parallelKey } from '@libraz/libcantus';

const key = majorKey(0);

isBorrowedChord(Chord.of('F', 'min').data, key); // true
borrowedSource(Chord.of('F', 'min').data, key); // 'parallelMinor'
parallelKey(key).rootPc; // 0
```

The distinction matters in a UI. A tonicization or a borrowed chord should be labelled inside the current key; only a sustained change of tonal centre deserves a new key region. See [Harmony](harmony.md) for how these chords are analyzed and [Reharmonization](reharmonization.md) for using them deliberately.
