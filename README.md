# @libraz/libcantus

Pure-TypeScript music theory for MIDI note events. Build and spell chords, inspect harmony, analyze keys and form, and generate parts from the same data model. The package has no runtime dependencies.

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/libcantus/ci.yml?branch=main&label=CI)](https://github.com/libraz/libcantus/actions)
[![npm](https://img.shields.io/npm/v/@libraz/libcantus)](https://www.npmjs.com/package/@libraz/libcantus)
[![codecov](https://codecov.io/gh/libraz/libcantus/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/libcantus)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/libcantus/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![docs](https://img.shields.io/badge/docs-API%20reference-b5892e)](https://libraz.github.io/libcantus/)

## What it does

It sits between software that already holds notes or chord symbols — a DAW project, a MIDI parser, a practice tool — and what those notes mean harmonically. Give it note events and it recovers the harmony; give it that harmony back and it writes parts against it:

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

Chord boundaries are searched for rather than assumed, and so is the key, so a piece that modulates is not read against the key it started in.

What each layer covers:

- **[Pitch and notation](docs/en/pitch-and-notation.md)** — spelled notes and intervals, MIDI conversion, note names read and written in English, German, Japanese, Italian or fixed-do, and line spelling solved as one path instead of note by note. Every text parser has a non-throwing sibling (`tryParseNote`, `tryParseInterval`, `tryParseChordSymbol`, `tryParseKeyName`, `tryParseTimeSignature`, and `tryParse` on `Note`, `Interval`, `Key`, `Chord` and `Meter`), so a text field needs no `try`/`catch` per keystroke.
- **[Harmony](docs/en/harmony.md)** — chords as structured values, scales including modes, pentatonics and the `WORLD_SCALES` set, Roman numerals and function, voicing, figured bass, and the part-writing and species-counterpoint checkers that report a violation with the voice it happened in and the reason.
- **[Analysis](docs/en/analysis.md)** — chord and key detection over note events, timelines and cadences, harmonic reduction, phrases, sections, hypermeter, motifs, and arrangement reports.
- **[Generation](docs/en/generation.md)** — progressions, motifs, rhythms, drums, bass and counter-melody, all drawing on one `GenerationContext`: a project seed, three additive complexity dials (rhythmic, harmonic, ornament), a separate difficulty ceiling, the tempo, and the instrument each part is written for. Same context, same output.
- **[Time and arrangement](docs/en/time-and-arrangement.md)** — meter, tempo, positions in bars and beats, and analysis across several tracks at once.
- **[Class API](docs/en/api-reference.md)** — the same theory as one immutable class per thing the library works with, `Score`, `Timeline` and `Composer` included, each a thin skin over the functions above. Reach for a function or a class as it suits the call site; the answers are the same.

Answers say why they were reached. `analyzeChord`, `detectCadence` and `explainRoman` carry a `rationale`, `detectKey` attaches one on request, and each can report the readings it turned down as `alternatives`. Where the input cannot settle a question, the field comes back `null` rather than a plausible guess — grading a cadence perfect or imperfect needs a voicing, because only a voicing says what is in the soprano.

Spelling is kept wherever it decides the answer. A diminished fifth and an augmented fourth are the same distance in pitch classes but not the same interval, so the counterpoint and part-writing checkers take spelled notes rather than numbers.

Seven worked guides start from the data an application already has: [DAW workflow](docs/en/use-cases/daw-workflow.md), [piece analysis](docs/en/use-cases/piece-analysis.md), [modulation report](docs/en/use-cases/modulation-report.md), [harmony exercise checker](docs/en/use-cases/harmony-exercise-checker.md), [generative arrangement](docs/en/use-cases/generative-arrangement.md), [chord chart import](docs/en/use-cases/chord-chart-import.md), and [part preparation](docs/en/use-cases/part-preparation.md).

## What it doesn't do

- **No I/O, notation or audio.** No MIDI file reader or writer, no score rendering, no audio analysis, no playback. Bring your own parser and hand it note events. If that layer is what you need, [libsonare](https://github.com/libraz/libsonare) covers audio analysis, mastering, synthesis and SMF I/O; the two share no code and neither requires the other.
- **No microtonal analysis.** Frequencies, cents, equal divisions of the octave and just-intonation ratios live in `core`, but everything above the pitch layer runs on twelve pitch classes. Music organised in smaller steps than a semitone is out of reach, which is also why the maqāmāt built on half-flat degrees are left out of `WORLD_SCALES` rather than rounded to a twelve-tone neighbour.
- **No modal systems.** `WORLD_SCALES` records the pitch material a tradition names — a thāt, a maqām's set, a Japanese pentatonic — and not the system built on it: ascent and descent forms, the notes a phrase leans on, and the phrase grammar have no place in a mask.
- **No assumption that the material is tonal.** Roman numerals and functional harmony presuppose the common practice, and `supportsFunctionalHarmony` says whether a named scale admits that reading at all — `'dorian'` does, `'miyakoBushi'` does not.
- **No corpus.** Nothing is bundled to run statistics over.
- **Known gaps in functional harmony.** `functionOf` answers from a chord and a key alone, so a cadential six-four reads there as an inverted tonic; the dominant reading of it belongs to the layers that see time, and `detectCadence` gives it when the chord before the dominant is passed as `approach`.

## Requirements

Node.js >= 22.

## Install

```sh
yarn add @libraz/libcantus
```

## Quick start

The theory lives in tree-shakeable pure functions. On top of them sits an immutable class API — one class per thing the library works with, from a single `Note`, `Interval` or `Chord` up to the `Score`, `Timeline`, `Arrangement` and `Composer` that carry a whole piece — that reads the way theory is spoken:

```ts
import { Chord, Key } from '@libraz/libcantus';

const key = Key.major('C');
const dominant = key.chord(5, 'dom7');

dominant.symbol(); // 'G7'
dominant.analyze(key).roman; // 'V7'
Chord.parse('C7(b9,#11)').pitchClasses(); // [0, 1, 4, 6, 7, 10]
```

The functions are the library; every class is a thin skin over them. A class wraps a plain object it exposes as `.data`, and the functions return data a class can be built from, so neither side is a walled garden and the two give the same answers. What a class adds is holding a value together with its context, so a chain of calls does not restate the same facts: a `Score` carries its notes with their meter, tempo, and key, and a `Composer` carries the key, tempo, and seed one piece is written under.

## Import paths

The package root exports everything. To pull in a single layer, import its subpath instead:

```ts
import { parseNote, edo } from '@libraz/libcantus/core'; // pitch, meter, tempo, tuning
import { majorKey, makeChord } from '@libraz/libcantus/theory'; // scales, chords, voicing, rules
import { analyzeArrangement, detectKey } from '@libraz/libcantus/analyze';
import { generateDrums, generateProgression } from '@libraz/libcantus/generate';
import { Chord, Key, Note } from '@libraz/libcantus/model'; // class API
```

Both ESM and CommonJS builds ship for every path.

## Documentation

Start here: [Introduction](docs/en/introduction.md), [Getting started](docs/en/getting-started.md), [Use cases](docs/en/use-cases/index.md).

Domain guides: [Pitch and notation](docs/en/pitch-and-notation.md), [Scales and modes](docs/en/scales-and-modes.md), [Harmony](docs/en/harmony.md), [Key relations and modulation](docs/en/key-relations-and-modulation.md), [Voicing](docs/en/voicing.md), [Counterpoint and part-writing](docs/en/counterpoint-and-part-writing.md), [Time and arrangement](docs/en/time-and-arrangement.md), [Analysis](docs/en/analysis.md), [Melody and motifs](docs/en/melody-and-motifs.md), [Rhythm and groove](docs/en/rhythm-and-groove.md), [Generation](docs/en/generation.md), [Reharmonization](docs/en/reharmonization.md), [Instruments and playability](docs/en/instruments-and-playability.md), [Tuning and frequency](docs/en/tuning-and-frequency.md).

Cross-cutting: [Determinism and seeding](docs/en/determinism-and-seeding.md), [Errors and validation](docs/en/errors-and-validation.md), [Performance](docs/en/performance.md), [Interoperability](docs/en/interoperability.md).

Reference: [API reference](docs/en/api-reference.md), [Glossary](docs/en/glossary.md), [Questions and limitations](docs/en/faq.md).

Every `ts` example in these guides is executed by the test suite, and an expected value written as a trailing comment is checked against what the call returns. The generated TypeDoc reference is written to `docs/api` and is separate from the hand-authored guides.

## License

[@libraz/libcantus](https://github.com/libraz/libcantus) is released under the [Apache License 2.0](LICENSE).
