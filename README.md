# @libraz/cantus

Pure-TypeScript toolkit for working with music: name notes and chords, analyze
harmony, recognize what you're hearing, voice and reharmonize progressions, and
generate parts (bass, countermelody, drums, rhythm) — all with no runtime
dependencies.

[![CI](https://github.com/libraz/libcantus/actions/workflows/ci.yml/badge.svg)](https://github.com/libraz/libcantus/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/libraz/libcantus/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/libcantus)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

## What can you do with it?

- **Name and move notes** — parse `C4`, transpose it, convert to/from MIDI, spell
  intervals with correct enharmonics (`F#` vs `Gb`).
- **Build chords and progressions** — from scale degrees, Roman numerals
  (`V7/V`), or lead-sheet symbols (`Cmaj7`, `F#m7b5`, `C/G`).
- **Analyze harmony** — Roman-numeral analysis, harmonic function, cadence
  detection, and borrowed / modal-interchange chords.
- **Recognize what you hear** — notes in, chord or key out (the inverse of the
  builders).
- **Reharmonize** — tritone subs, chromatic mediants, negative harmony, modal
  interchange palettes.
- **Voice chords** — smooth 4-voice (SATB) leading, plus drop-2/3, shell, and
  rootless comping styles.
- **Generate parts** — bass lines, countermelodies, drums, rhythms, motifs, and
  whole progressions; deterministic for a given seed.
- **Arrange from a DAW / MIDI file** — feed raw multi-track notes, recover the
  harmony, get a whole-piece analysis (with per-note conflicts), and generate the
  missing parts against it.
- **Work with pitch as sound** — frequencies, cents, EDO, and just intonation.

Everything is available in two interchangeable styles: a **fluent, immutable
class API** that reads like music theory, and the underlying **tree-shakeable
pure functions**. Pick whichever fits.

## Install

```sh
yarn add @libraz/cantus
```

## Quick start

The class API chains immutably and carries key context, so analysis needs no
repetition:

```ts
import { Chord, Key, Note } from '@libraz/cantus';

const c = Key.major('C');

c.chord(4, 'dom7').pitchClasses(); // [2, 5, 7, 11]  (G7)
c.roman('V7/V').voice(); // [ ...SATB MIDI ]  (secondary dominant, voiced)
Note.of('C4').transpose(7).name; // 'G4'

// A ii–V–I, built and analyzed in one line:
c.chord(1, 'min').progressionTo(c.chord(4, 'dom7'), c.chord(0, 'maj')).analyze();
// { chords: [...functional analysis...], cadence: 'authentic' }

Chord.detect([60, 64, 67])[0].quality; // 'maj'
```

Every class wraps a plain object (`Chord.data`, `Note.data`) and delegates to the
pure functions, so the two styles interoperate freely. The same task with the
functional API:

```ts
import { chordFromDegree, chordPitchClasses, classifyInterval, majorKey } from '@libraz/cantus';

const cMajor = majorKey(0);

classifyInterval(7); // IntervalQuality.PerfectConsonance
chordPitchClasses(chordFromDegree(4, 'dom7', cMajor)); // [2, 5, 7, 11]  (G7)
```

## Name and move notes

Parse and format notes, convert to MIDI, and spell intervals so enharmonics the
pitch-class layer can't tell apart come out right:

```ts
import { parseNote, spelledInterval } from '@libraz/cantus';

spelledInterval(parseNote('C4'), parseNote('F#4')); // { number: 4, quality: 'A', semitones: 6 }
spelledInterval(parseNote('C4'), parseNote('Gb4')); // { number: 5, quality: 'd', semitones: 6 }
```

## Keys and scales

A `KeyScale` is a root pitch class plus a 12-bit `modeMask12` (bit `n` set means
pitch class `(rootPc + n) % 12` is in the scale). `majorKey`, `minorKey`, and
`scaleByName` cover the modes, pentatonics, blues, whole-tone, and octatonic
scales; `MAJOR_MASK` / `NATURAL_MINOR_MASK` let you define custom keys.

`nearestScaleTone` snaps a pitch to the closest in-scale MIDI pitch (preferring
the lower on a tie) — handy when constraining generated notes to a key.

## Build chords and progressions

From scale degrees, Roman numerals, or lead-sheet symbols — and back again:

```ts
import {
  chordToRoman, majorKey, makeChord, parseChordSymbol, romanToChord,
} from '@libraz/cantus';

const c = majorKey(0);

romanToChord('V7/V', c); // { rootPc: 2, quality: 'dom7' }  (D7)
chordToRoman(makeChord(7, 'dom7'), c); // 'V7'
parseChordSymbol('F#m7b5'); // { rootPc: 6, quality: 'm7b5', ... }
```

Chord vocabulary spans triads through thirteenths — `dim7`, `m7b5`, `minMaj7`,
`aug7`, sixths, and altered dominants included.

Or generate a progression from a style preset:

```ts
import { generateProgression } from '@libraz/cantus';

// One chord per bar, secondary dominants inserted where they fit:
generateProgression({ key: majorKey(0), style: 'idol', bars: 8, reharmonize: true, seed: 1 });
```

## Analyze harmony

Turn chords into Roman-numeral analysis with function, cadences, and modal
interchange — in major and minor, respecting inversions:

```ts
import { analyzeChord, makeChord, majorKey } from '@libraz/cantus';

// A minor iv in a major key reads as a borrowed subdominant:
analyzeChord(makeChord(5, 'min'), majorKey(0));
// { function: 'subdominant', borrowed: true, source: 'parallel-minor', roman: 'iv' }
```

## Recognize what you hear

Notes in, chord or key out — the inverse of the builders:

```ts
import { detectChord, detectKey } from '@libraz/cantus';

detectChord([60, 64, 67])[0]; // { rootPc: 0, quality: 'maj', exact: true }
detectKey([0, 0, 0, 4, 7])[0]; // C major, best fit
```

## Spell chords and scales

Give a spelled tonic and the pitch-class core produces letter names, correct in
major and minor:

```ts
import { minorKey, noteNames, parseNote, scaleByName, spellScale } from '@libraz/cantus';

noteNames(spellScale(parseNote('A'), scaleByName('harmonicMinor', 9)));
// ['A', 'B', 'C', 'D', 'E', 'F', 'G#']
noteNames(spellScale(parseNote('E'), minorKey(4)));
// ['E', 'F#', 'G', 'A', 'B', 'C', 'D']
```

## Reharmonize

Get substitution candidates for a chord — tritone, relative, borrowed, and
chromatic-mediant subs, plus modal-interchange palettes and negative harmony:

```ts
import { parseChordSymbol, substituteChord } from '@libraz/cantus';

substituteChord(parseChordSymbol('G7'), majorKey(0));
// [{ chord: Db7, type: 'tritone', ... }, ...]
```

## Choose scales and tensions

Find scales compatible with a chord, its available tensions and avoid notes, and
a continuity-optimized scale choice across a whole set of changes:

```ts
import { chordScales, makeChord } from '@libraz/cantus';

chordScales(makeChord(0, 'dom7'))[0]; // { name: 'mixolydian', rootPc: 0 }
```

## Voice chords

Realize a progression into smooth 4-voice (SATB) MIDI voicings with minimal
motion, or apply a comping style (drop-2/3, shell, rootless):

```ts
import { makeChord, voiceProgression } from '@libraz/cantus';

voiceProgression([makeChord(0, 'maj'), makeChord(5, 'maj'), makeChord(7, 'dom7'), makeChord(0, 'maj')]);
// [[...], [...], [...], [...]]  (one ascending pitch per voice, minimal motion)
```

`voiceLeadingCost` and `nextVoicing` let you steer the leading, and the
`counterpoint` predicates (parallel/hidden perfects, spacing, voice crossing,
leading-tone resolution, …) let you validate it.

## Generate parts

Seeded, deterministic generators for melody and accompaniment:

```ts
import {
  generateBassLine, generateCounterMelody, generateDrums, generateRhythm,
  generateMotif, parseTimeSignature,
} from '@libraz/cantus';

generateRhythm(parseTimeSignature('4/4'), { seed: 1, density: 0.5 }); // strong-beat-weighted onsets
generateMotif({ key: majorKey(0), length: 4, contour: 'arch', seed: 1 }); // a short melodic cell
```

`humanize`, `extractGrooveTemplate`, and `applyGrooveTemplate` add a meter-aware
feel — or capture the feel of one performance and transplant it onto another.

## Arrange from a DAW or MIDI file

The arrangement layer takes raw multi-track `NoteEvent`s, recovers the harmony,
then analyses and generates against it:

```ts
import {
  analyzeArrangement, chordTimelineFromNotes, generateBassLine, generateCounterMelody,
} from '@libraz/cantus';

// Infer a chord progression (and the key) from played notes:
const { timeline, key } = chordTimelineFromNotes(melodyAndChordNotes);

// Whole-piece analysis: inferred chords, cadences, per-note theory labels, and
// notes that clash with the sounding harmony (with reasons and suggestions):
const report = analyzeArrangement([
  { role: 'melody', notes: melodyNotes },
  { role: 'harmony', notes: chordNotes },
]);
report.conflicts; // [{ beat, trackName, pitch, safety, reasons, rationale }, ...]

// Generate the missing parts from the recovered timeline:
generateBassLine({ segments: timeline.segments, key, style: 'walking', seed: 1 });
generateCounterMelody({ melody: melodyNotes, chordAt: timeline.at, key, register: 'below' });
```

`harmonizeMelody` goes the other way — given a bare melody, it searches for the
best key, transpose, and chord path (with optional reharmonization) to harmonize
it.

Note events shared across the arrangement and generation modules use one type,
`NoteEvent` (`{ pitch, startBeat, durationBeat, velocity? }`, MIDI pitch in
quarter-note beats). Seeded generators (`bass`, `groove`, `countermelody`,
`rhythm`, `drums`, `motif`, `progression`) are deterministic for a given seed.

## Work with pitch as sound

Frequencies, cents, EDO, and just intonation — for tuning, microtonality, and
analysis:

```ts
import { frequencyOf, edo, justDeviationCents } from '@libraz/cantus';
```

Meter helpers (`TimeSignature`, `parseTimeSignature`, `beatsPerBar`,
`metricWeight`, `isStrongBeat`, `tuplet`) cover simple and compound meters and
back the accent-aware generators.

## License

Apache-2.0
