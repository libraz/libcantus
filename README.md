# @libraz/cantus

Pure-TypeScript music-theory and composition primitives: intervals, scales, and chords.

[![CI](https://github.com/libraz/libcantus/actions/workflows/ci.yml/badge.svg)](https://github.com/libraz/libcantus/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

| Module     | Exports                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| `interval` | `IntervalQuality`, `classifyInterval`, `isPerfectInterval`, `isConsonantInterval`                               |
| `scale`    | `KeyScale`, `majorKey`, `isScaleTone`, `nearestScaleTone`, `pitchToScaleDegree`, `diatonicPitchClasses`         |
| `chord`    | `Chord`, `ChordQuality`, `chordFromDegree`, `chordPitchClasses`, `chordToneRole`                                |

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

## License

MIT
