# @libraz/libcantus

Pure-TypeScript music theory for MIDI note events. Recover the harmony from notes, and write new parts against that same reading. No runtime dependencies.

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/libcantus/ci.yml?branch=main&label=CI)](https://github.com/libraz/libcantus/actions)
[![npm](https://img.shields.io/npm/v/@libraz/libcantus)](https://www.npmjs.com/package/@libraz/libcantus)
[![codecov](https://codecov.io/gh/libraz/libcantus/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/libcantus)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/libcantus/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![docs](https://img.shields.io/badge/docs-API%20reference-b5892e)](https://libraz.github.io/libcantus/)

![From note events to parts, and back](docs/images/pipeline.svg)

The library sits between software that already holds notes or chord symbols — a DAW project, a MIDI parser, a practice tool — and what those notes mean harmonically. Note events go in, the harmony comes out, and the generators write against the harmony that was just read.

## What it does

```ts
import { Composer, Score } from '@libraz/libcantus';

// Four bars of block chords, as a DAW would hand them over:
const harmony = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const chords = Score.of(harmony).timeline();
chords.roman().map((entry) => entry.roman); // ['I', 'IV', 'V7', 'I']
chords.cadences().at(-1)?.cadence.type; // 'authentic'

// A walking bass over the harmony that was just recovered:
Composer.of({ key: chords.key, bpm: 120, seed: 1 }).bass(chords, { style: 'walking' }).notes;
// 16 notes: [{ pitch: 36, startBeat: 0, durationBeat: 1, velocity: 100 }, ...]
```

Chord boundaries are searched for rather than assumed, and so is the key, so a piece that modulates is not read against the key it started in. Answers carry their evidence: a chord analysis, a cadence and a Roman numeral each come with a `rationale` and the readings they turned down, and where the input cannot settle a question the field comes back `null` rather than a plausible guess.

## Use cases

| Use case | What it does | Worked guide |
|---|---|---|
| A DAW assistant | Infers the harmony from tracks, then writes a bass line against it. | [DAW workflow](docs/en/use-cases/daw-workflow.md) |
| A piece analyzer | Key regions, cadences, harmonic reduction, phrases, sections and motifs from one score. | [Piece analysis](docs/en/use-cases/piece-analysis.md) |
| A modulation report | Key changes with their pivot chords, confidences and relations. | [Modulation report](docs/en/use-cases/modulation-report.md) |
| A harmony exercise checker | Part-writing and species-counterpoint violations, each with the voice it happened in and the rule it broke. | [Harmony exercise checker](docs/en/use-cases/harmony-exercise-checker.md) |
| A generative arrangement | One seeded composer writing a progression, its parts and its drums, then a playability check. | [Generative arrangement](docs/en/use-cases/generative-arrangement.md) |
| A chord chart importer | Typed chord symbols turned into a timeline, voicings and a bass line. | [Chord chart import](docs/en/use-cases/chord-chart-import.md) |
| Part preparation | A part fitted to an instrument and written at the pitch its player reads. | [Part preparation](docs/en/use-cases/part-preparation.md) |

## Install

Node.js 22 or later.

```sh
yarn add @libraz/libcantus
```

The package root exports the whole API. `@libraz/libcantus/core`, `/theory`, `/analyze`, `/generate` and `/model` are narrower import boundaries onto the same symbols, and every path ships an ESM and a CommonJS build.

## Documentation

New to music theory? [The primer](docs/en/primer/index.md) teaches the concepts this API is built on — pitch and intervals, scales and keys, chords, harmony, voices, rhythm and meter — for a reader who writes TypeScript rather than scores.

Otherwise start at [Introduction](docs/en/introduction.md) and [Getting started](docs/en/getting-started.md), which index the domain guides and the reference pages. Every `ts` example in the guides is executed by the test suite, and a trailing comment that names a literal — with or without the reason for it after an em dash — is checked against what the call returns.

## What it doesn't do

- **No I/O, notation or audio.** No MIDI file reader or writer, no score rendering, no audio analysis, no playback. Bring your own parser and hand it note events. For the layer below, [libsonare](https://github.com/libraz/libsonare) covers audio analysis, mastering, synthesis and SMF I/O; the two share no code and neither requires the other.
- **No microtonal analysis.** Frequencies, cents, equal divisions of the octave and just-intonation ratios live in `core`, but everything above the pitch layer runs on twelve pitch classes.
- **No modal systems.** `WORLD_SCALES` records the pitch material a tradition names — a thāt, a maqām's set, a Japanese pentatonic — and not the grammar built on it.
- **No corpus.** Nothing is bundled to run statistics over.

[Questions and limitations](docs/en/faq.md) covers the rest, including where a functional reading does not apply and what the engine will not guess.

## License

[@libraz/libcantus](https://github.com/libraz/libcantus) is released under the [Apache License 2.0](LICENSE).
