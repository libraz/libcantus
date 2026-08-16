# Reharmonization

Reharmonization replaces the chords under a melody or a progression while keeping something fixed — the melody, the bass, the function, or just the length. The library offers the substitutions as proposals with their reasons attached, so a host can present them and let a user choose.

## Substitutions for one chord

`substituteChord` returns every substitution it can justify for a chord in a key, each with its relationship, numeral, and harmonic function:

```ts
import { formatChordSymbol, majorKey, makeChord, substituteChord } from '@libraz/libcantus';

const subs = substituteChord(makeChord(7, 'dom7'), majorKey(0));

subs.map((sub) => sub.type).includes('tritone'); // true
formatChordSymbol(subs.find((sub) => sub.type === 'tritone')?.chord ?? makeChord(0, 'maj'));
// 'Db7'
```

The tritone substitute of G7 in C major is spelled Db7, not C#7 — it is the flat second degree of the key, and the spelling says so.

The five relationships:

| Type | Applies to | What it does |
| --- | --- | --- |
| `tritone` | Dominant-type chords | Replaces the dominant with the one a tritone away; the guide tones are shared. |
| `relative` | Triads and sevenths | Swaps in a chord sharing two triad tones. |
| `borrowed` | Any chord | Takes the same degree from the parallel mode. |
| `chromaticMediant` | Any chord | A third away, with one common tone and a chromatic shift. |
| `secondaryDominant` | Any chord | The applied dominant of the following harmony. |

### Keeping the melody consonant

A substitution that clashes with the note above it is not a substitution. Pass the melody's pitch classes and only chords containing all of them are kept:

```ts
import { majorKey, makeChord, substituteChord } from '@libraz/libcantus';

const all = substituteChord(makeChord(0, 'maj'), majorKey(0));
const overE = substituteChord(makeChord(0, 'maj'), majorKey(0), { melodyPcs: [4] });

overE.length <= all.length; // true
overE.every((sub) => sub.chord.intervals.length > 0); // true
```

Without it the result is the full set of theoretically available substitutions; with it, only the ones that fit the melody already written.

## The modal-interchange palette

Rather than asking chord by chord, take the whole set of chords available from the parallel mode:

```ts
import { formatChordSymbol, majorKey, modalInterchangePalette } from '@libraz/libcantus';

modalInterchangePalette(majorKey(0)).map((borrowed) => formatChordSymbol(borrowed.chord));
// ['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Db']
```

Each entry carries its numeral and its `source`, so a UI can group them by where they were borrowed from. The spellings stay on the flat side, as borrowed chords in a major key are written.

## Negative harmony

`negativeHarmonyMirror` reflects a chord across the axis of its key:

```ts
import { majorKey, makeChord, negativeHarmonyMirror } from '@libraz/libcantus';

const mirrored = negativeHarmonyMirror(makeChord(7, 'maj'), majorKey(0));

mirrored.rootPc; // 5
mirrored.quality; // 'min'
```

G major reflected across C's axis becomes F minor. It is a transformation rather than a proposal: there is exactly one result, and whether that result suits the piece is a compositional decision.

## Reharmonizing a whole progression

`generateProgression` takes a `reharmonize` flag, which is sugar for a middle setting of `complexity.harmonic`. Using the context directly says *how much* rather than *whether*:

```ts
import { generateProgression, majorKey } from '@libraz/libcantus';

const key = majorKey(0);
const plain = generateProgression({ key, style: 'idol', bars: 8, ctx: { seed: 5 } });
const rich = generateProgression({
  key,
  style: 'idol',
  bars: 8,
  ctx: { seed: 5, complexity: { harmonic: 1 } },
});

plain.length; // 8
rich.length; // 8
```

At `harmonic: 0` the preset is left alone. At 1, every chord the voice-leading rules allow is replaced by the secondary dominant of what follows. The length does not change, because reharmonization substitutes rather than inserts.

`presetId` picks a specific built-in progression; `preset` supplies caller-provided degrees, with `BORROWED_DEGREES` naming the non-diatonic ones:

```ts
import { BORROWED_DEGREES, generateProgression, majorKey } from '@libraz/libcantus';

BORROWED_DEGREES.bVII; // 10

const chords = generateProgression({
  key: majorKey(0),
  style: 'rock',
  bars: 4,
  preset: { degrees: [1, BORROWED_DEGREES.bVII, 4, 1] },
});

chords.map((span) => span.rootPc); // [0, 10, 5, 0]
```

## Harmonizing a melody from scratch

`harmonizeMelody` is the other direction: given a melody, choose chords under it. It classifies each melody note first, so a passing tone does not drag the harmony with it:

```ts
import { harmonizeMelody } from '@libraz/libcantus';

const result = harmonizeMelody({
  melody: [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 62, startBeat: 1, durationBeat: 1 },
    { pitch: 64, startBeat: 2, durationBeat: 1 },
    { pitch: 65, startBeat: 3, durationBeat: 1 },
    { pitch: 67, startBeat: 4, durationBeat: 4 },
  ],
});

result.chords.length >= 1; // true
result.melodyRoles.length; // 5
result.transposeSemitones; // 0
```

`result.chords` holds one `ChordSpan` per chord change on the harmonic-rhythm grid, and `result.melodyRoles` gives each melody note's role in the chord that ended up under it. `result.key` is the key the chords are written in, and `transposeSemitones` is how far the melody was moved to get there — a melody that was not in a key the harmonizer could work in comes back with the offset that puts it there, rather than with chords in the wrong key.

`classifyMelodyTones` runs the non-chord-tone classification on its own, for a UI that shades passing and auxiliary tones without committing to a harmonization.

## Presenting a reharmonization

Every function here returns proposals with their reasons attached. Present the reason alongside the chord: `type` and `roman` name the relationship, which the chord symbol alone does not.

Keep the original chords. Reharmonization is a proposal about existing music, so the user has to be able to compare, reject, and revert. The same applies to generated parts; see [Generation](generation.md).
