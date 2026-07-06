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
| `pitch`       | `Note`, `parseNote`, `formatNote`, `noteToMidi`, `midiToNote`, `spelledInterval` (letter-name spelling, enharmonics)         |
| `interval`    | `IntervalQuality`, `classifyInterval`, `isPerfectInterval`, `isConsonantInterval`                                            |
| `scale`       | `KeyScale`, `majorKey`, `minorKey`, `scaleByName`, `NAMED_SCALES` (modes, pentatonic, blues, whole-tone, octatonic, …)       |
| `chord`       | `Chord`, `ChordQuality`, `chordFromDegree`, `diatonicTriad`, `diatonicSeventh`, `chordPitchClasses`, `chordToneRole`         |
| `functional`  | `romanToChord`, `chordToRoman`, `functionOf`, `detectCadence`, `isMinorKey`, `secondaryDominant` (major & minor, inversions) |
| `spelling`    | `spellScale`, `spellChord`, `spellPitchClasses`, `noteNames` (letter-name output from a spelled tonic)                       |
| `detect`      | `detectChord`, `detectChordBest`, `detectKey` (recognition: notes → chord/key, with inversions)                              |
| `counterpoint`| parallel/hidden-perfect, unison, overlap, spacing, voice-crossing, leading-tone, and dissonance predicates                   |
| `meter`       | `TimeSignature`, `parseTimeSignature`, `beatsPerBar`, `metricWeight`, `isStrongBeat`, `tuplet` (simple & compound meters)     |
| `tuning`      | `frequencyOf`, `edo`, `centsBetweenFreq`, `ratioToCents`, `JUST_RATIOS`, `justDeviationCents` (Hz, cents, EDO, just intonation) |

Chord vocabulary spans triads through thirteenths, including `dim7`, `m7b5`,
`minMaj7`, `aug7`, sixths, and altered dominants.

All functions are pure: plain inputs in, plain TypeScript objects out. No runtime dependencies.

## Install

```sh
yarn add @libraz/cantus
```

## Usage

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

## License

MIT
