# @libraz/cantus

Pure-TypeScript music-theory and composition primitives: pitch spelling,
intervals, scales, chords, functional harmony, and voice-leading.

[![CI](https://github.com/libraz/libcantus/actions/workflows/ci.yml/badge.svg)](https://github.com/libraz/libcantus/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

| Module        | Exports                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `model`       | `Note`, `Interval`, `Key`, `Chord`, `Progression` (fluent, immutable class API over the functions below)                     |
| `pitch`       | `NoteData`, `parseNote`, `formatNote`, `noteToMidi`, `midiToNote`, `spelledInterval` (letter-name spelling, enharmonics)     |
| `interval`    | `IntervalQuality`, `classifyInterval`, `isPerfectInterval`, `isConsonantInterval`                                            |
| `scale`       | `KeyScale`, `majorKey`, `minorKey`, `scaleByName`, `NAMED_SCALES` (modes, pentatonic, blues, whole-tone, octatonic, …)       |
| `chord`       | `ChordData`, `ChordQuality`, `chordFromDegree`, `diatonicTriad`, `diatonicSeventh`, `chordPitchClasses`, `chordToneRole`     |
| `functional`  | `romanToChord`, `chordToRoman`, `functionOf`, `analyzeChord`, `isBorrowedChord`, `borrowedSource`, `detectCadence`, `secondaryDominant` (major & minor, inversions, modal interchange) |
| `chordscale`  | `chordScales`, `availableTensions`, `avoidNotes`, `chordScaleReport` (compatible scales and tensions for a chord)            |
| `spelling`    | `spellScale`, `spellChord`, `spellPitchClasses`, `noteNames` (letter-name output from a spelled tonic)                       |
| `detect`      | `detectChord`, `detectChordBest`, `detectKey` (recognition: notes → chord/key, with inversions)                              |
| `counterpoint`| parallel/hidden-perfect, unison, overlap, spacing, voice-crossing, leading-tone, and dissonance predicates                   |
| `voicing`     | `voiceChord`, `voiceProgression`, `voiceLeadingCost`, `SATB_RANGES` (realize chords into smooth N-voice MIDI voicings)       |
| `rhythm`      | `generateRhythm`, `onsetWeightCurve`, `rhythmDensity` (seeded rhythm generation weighted by metric accent)                   |
| `meter`       | `TimeSignature`, `parseTimeSignature`, `beatsPerBar`, `metricWeight`, `isStrongBeat`, `tuplet` (simple & compound meters)     |
| `tuning`      | `frequencyOf`, `edo`, `centsBetweenFreq`, `ratioToCents`, `JUST_RATIOS`, `justDeviationCents` (Hz, cents, EDO, just intonation) |

Chord vocabulary spans triads through thirteenths, including `dim7`, `m7b5`,
`minMaj7`, `aug7`, sixths, and altered dominants.

Two interchangeable API styles over the same engine: a fluent, immutable class
API (`Note`, `Interval`, `Key`, `Chord`, `Progression`) for expressive chaining,
and the underlying pure functions (plain inputs in, plain objects out) for
maximum tree-shaking. No runtime dependencies.

## Install

```sh
yarn add @libraz/cantus
```

## Usage

The fluent class API reads as music theory and chains immutably:

```ts
import { Chord, Key, Note } from '@libraz/cantus';

const c = Key.major('C');

c.chord(4, 'dom7').pitchClasses(); // [2, 5, 7, 11]  (G7)
c.roman('V7/V').voice(); // [ ...SATB MIDI ]  (secondary dominant, voiced)
Note.of('C4').transpose(7).name; // 'G4'

// Chords built from a key carry that context, so analysis needs no repetition:
c.chord(1, 'min').progressionTo(c.chord(4, 'dom7'), c.chord(0, 'maj')).analyze();
// { chords: [...functional analysis...], cadence: 'authentic' }  (ii–V–I)

Chord.detect([60, 64, 67])[0].quality; // 'maj'
```

Every class wraps a plain object (`Chord.data`, `Note.data`) and delegates to the
pure functions below, so the two styles interoperate freely.

### Functional API

The same capabilities are exposed as tree-shakeable pure functions. The plain
object types are `NoteData` and `ChordData` (the `Note` and `Chord` names belong
to the classes):

```ts
import { chordFromDegree, chordPitchClasses, classifyInterval, majorKey } from '@libraz/cantus';

const cMajor = majorKey(0);

classifyInterval(7); // IntervalQuality.PerfectConsonance
chordPitchClasses(chordFromDegree(4, 'dom7', cMajor)); // [2, 5, 7, 11]  (G7)
```

### Keys and scales

A `KeyScale` is a root pitch class plus a 12-bit `modeMask12`, where bit `n` set
means pitch class `(rootPc + n) % 12` is in the scale. `majorKey(rootPc)` builds
a major key; `MAJOR_MASK` and `NATURAL_MINOR_MASK` are provided for custom keys.

`nearestScaleTone` snaps a pitch to the closest in-scale MIDI pitch and prefers
the lower pitch on a tie.

### Roman numerals, recognition, and spelling

```ts
import {
  chordToRoman,
  detectChord,
  detectKey,
  majorKey,
  makeChord,
  parseNote,
  romanToChord,
  spelledInterval,
} from '@libraz/cantus';

const c = majorKey(0);

romanToChord('V7/V', c); // { rootPc: 2, quality: 'dom7' }  (D7)
chordToRoman(makeChord(7, 'dom7'), c); // 'V7'

// Recognition (notes -> chord/key), the inverse of the builders:
detectChord([60, 64, 67])[0]; // { rootPc: 0, quality: 'maj', exact: true }
detectKey([0, 0, 0, 4, 7])[0]; // C major, best fit

// Spelling distinguishes enharmonics the pitch-class layer cannot:
spelledInterval(parseNote('C4'), parseNote('F#4')); // { number: 4, quality: 'A', semitones: 6 }
spelledInterval(parseNote('C4'), parseNote('Gb4')); // { number: 5, quality: 'd', semitones: 6 }
```

Give a spelled tonic and the pitch-class core produces letter names, correct
in major and minor:

```ts
import { minorKey, noteNames, parseNote, scaleByName, spellScale } from '@libraz/cantus';

noteNames(spellScale(parseNote('A'), scaleByName('harmonicMinor', 9)));
// ['A', 'B', 'C', 'D', 'E', 'F', 'G#']
noteNames(spellScale(parseNote('E'), minorKey(4)));
// ['E', 'F#', 'G', 'A', 'B', 'C', 'D']
```

### Voicing, chord scales, and rhythm

```ts
import {
  analyzeChord,
  chordScales,
  generateRhythm,
  majorKey,
  makeChord,
  parseTimeSignature,
  voiceProgression,
} from '@libraz/cantus';

const c = majorKey(0);

// Realize a progression into smooth 4-voice (SATB) MIDI voicings:
voiceProgression([makeChord(0, 'maj'), makeChord(5, 'maj'), makeChord(7, 'dom7'), makeChord(0, 'maj')]);
// [[...], [...], [...], [...]]  (one ascending pitch per voice, minimal motion)

// Modal interchange: a minor iv in a major key reads as a borrowed subdominant:
analyzeChord(makeChord(5, 'min'), c);
// { function: 'subdominant', borrowed: true, source: 'parallel-minor', roman: 'iv' }

// Which scales fit over a chord, and its available tensions:
chordScales(makeChord(0, 'dom7'))[0]; // { name: 'mixolydian', rootPc: 0 }

// Seeded rhythm weighted toward strong beats:
generateRhythm(parseTimeSignature('4/4'), { seed: 1, density: 0.5 });
// [{ position: 0, duration: ... }, ...]
```

## License

MIT
