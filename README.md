# @libraz/libcantus

Pure-TypeScript music theory engine. It takes MIDI note numbers and chord
symbols and gives back harmonic meaning (Roman numerals, function, cadence,
key), then generates new parts against that meaning. Built for the tools that
sit next to a DAW: analyzers, generators, and composition assistants.

It is a theory layer, not an I/O or audio layer. There is no MIDI file reader or
writer, no audio analysis, and no playback — bring your own parser and hand it
note events. No runtime dependencies. If you need that other layer as well,
[libsonare](https://github.com/libraz/libsonare) covers audio analysis,
mastering, synthesis, and SMF I/O, and its npm binding sits alongside this one;
the two share no code and neither requires the other.

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/libcantus/ci.yml?branch=main&label=CI)](https://github.com/libraz/libcantus/actions)
[![npm](https://img.shields.io/npm/v/@libraz/libcantus)](https://www.npmjs.com/package/@libraz/libcantus)
[![codecov](https://codecov.io/gh/libraz/libcantus/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/libcantus)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/libcantus/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![docs](https://img.shields.io/badge/docs-API%20reference-b5892e)](https://libraz.github.io/libcantus/)

## What can you do with it?

- **Name and move notes** — parse `C4`, transpose it, convert to/from MIDI, spell
  intervals with correct enharmonics (`F#` vs `Gb`).
- **Build chords and progressions** — from scale degrees, Roman numerals
  (`V7/V`), or lead-sheet symbols (`Cmaj7`, `F#m7b5`, `C/G`).
- **Analyze harmony** — Roman-numeral analysis, harmonic function, cadence
  detection, and borrowed / modal-interchange chords.
- **Recognize chords and keys** — notes in, chord or key out (the inverse of the
  builders).
- **Reharmonize** — tritone subs, chromatic mediants, negative harmony, modal
  interchange palettes.
- **Voice chords** — smooth 4-voice (SATB) leading, plus drop-2/3, shell, and
  rootless comping styles.
- **Generate parts** — bass lines, countermelodies, drums, rhythms, motifs, and
  whole progressions; deterministic for a given seed.
- **Analyze a whole arrangement** — feed raw multi-track note events, recover the
  harmony, get a whole-piece analysis (with per-note conflicts), and generate the
  missing parts against it.
- **Work with pitch as sound** — frequencies, cents, EDO, and just intonation.

The theory itself lives in **tree-shakeable pure functions**. On top of them sits
a **fluent, immutable class API** (`Note`, `Interval`, `Chord`, `Key`,
`Progression`) that reads like music theory. Which one you get follows a single
rule: the musical **values** — notes, chords, keys, progressions — have both
forms and interoperate freely, while operations over **collections and
timelines** (part generation, whole-arrangement analysis, key ranking) take
arrays of note events and are exposed as functions only.

## Install

```sh
yarn add @libraz/libcantus
```

## Subpath imports

The package root exports everything. To pull in a single layer, import its
subpath instead:

```ts
import { Chord, Key, Note } from '@libraz/libcantus/model'; // class API
import { majorKey, makeChord } from '@libraz/libcantus/theory'; // scales, chords
import { generateDrums, generateProgression } from '@libraz/libcantus/generate';
import { analyzeArrangement, detectKey } from '@libraz/libcantus/analyze';
import { parseNote, edo } from '@libraz/libcantus/core'; // pitch, meter, tuning
```

The layers are `core`, `theory`, `analyze`, `generate`, and `model`.

## Quick start

The class API chains immutably and carries key context, so analysis needs no
repetition:

```ts
import { Chord, Key, Note } from '@libraz/libcantus';

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
import { chordFromDegree, chordPitchClasses, classifyInterval, ConsonanceClass, majorKey } from '@libraz/libcantus';

const cMajor = majorKey(0);

classifyInterval(7); // ConsonanceClass.PerfectConsonance
chordPitchClasses(chordFromDegree(4, 'dom7', cMajor)); // [2, 5, 7, 11]  (G7)
```

## Name and move notes

Parse and format notes, convert to MIDI, and spell intervals so enharmonics the
pitch-class layer can't tell apart come out right:

```ts
import { Interval, Note } from '@libraz/libcantus';

Note.of('C4').transpose(7).name; // 'G4'
Note.of('C4').midi; // 60
Interval.between(Note.of('C4'), Note.of('F#4')).name; // 'A4'  (augmented fourth)
Interval.between(Note.of('C4'), Note.of('Gb4')).name; // 'd5'  (diminished fifth)
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
import { Chord, Key } from '@libraz/libcantus';

const c = Key.major('C');

c.roman('V7/V').symbol(); // 'D7'  (a secondary dominant)
c.chord(4, 'dom7').roman(); // 'V7'
Chord.parse('F#m7b5').pitchClasses(); // [0, 4, 6, 9]
```

Chord vocabulary spans triads through thirteenths — `dim7`, `m7b5`, `minMaj7`,
`aug7`, sixths, and altered dominants included.

Or generate a progression from a style preset (a collection-level operation, so
it stays functional):

```ts
import { generateProgression, majorKey } from '@libraz/libcantus';

// One chord per bar, secondary dominants inserted where they fit:
generateProgression({ key: majorKey(0), style: 'idol', bars: 8, reharmonize: true, seed: 1 });
```

## Analyze harmony

Turn chords into Roman-numeral analysis with function, cadences, and modal
interchange — in major and minor, respecting inversions:

```ts
import { Chord, Key } from '@libraz/libcantus';

// A minor iv in a major key reads as a borrowed subdominant:
Chord.of('F', 'min').analyze(Key.major('C'));
// { function: 'subdominant', borrowed: true, source: 'parallelMinor', roman: 'iv' }
```

## Recognize chords and keys

Notes in, chord or key out — the inverse of the builders:

```ts
import { Chord, detectKey } from '@libraz/libcantus';

Chord.detect([60, 64, 67])[0].symbol(); // 'C'
Chord.detectBest([60, 63, 67, 70])?.symbol(); // 'Cm7'
detectKey([0, 0, 0, 4, 7])[0]; // C major, best fit  (key ranking stays functional)
```

## Spell chords and scales

A `Key` carries a spelled tonic, so the pitch-class core produces letter names,
correct in major and minor:

```ts
import { Chord, Key } from '@libraz/libcantus';

Key.named('harmonicMinor', 'A').noteNames(); // ['A', 'B', 'C', 'D', 'E', 'F', 'G#']
Key.minor('E').noteNames(); // ['E', 'F#', 'G', 'A', 'B', 'C', 'D']

// Chords spell in a key's context too:
Key.major('C').chord(4, 'dom7').spell().map((n) => n.name); // ['G', 'B', 'D', 'F']
```

## Reharmonize

Reflect a chord through negative harmony on the class, or list substitution
candidates — tritone, relative, borrowed, and chromatic-mediant subs, plus
modal-interchange palettes — with the functions:

```ts
import { Chord, Key, majorKey, parseChordSymbol, substituteChord } from '@libraz/libcantus';

Key.major('C').chord(4, 'dom7').negativeHarmony().symbol(); // 'Dm7b5'

// Substitution/palette search returns lists, so it stays functional:
substituteChord(parseChordSymbol('G7'), majorKey(0));
// [{ chord: Db7, type: 'tritone', ... }, ...]
```

## Choose scales and tensions

Find scales compatible with a chord and its available tensions and avoid notes
on the class; get a continuity-optimized scale choice across a whole set of
changes with `scalesForChanges`:

```ts
import { Chord } from '@libraz/libcantus';

Chord.of('C', 'dom7').scales()[0]; // { name: 'mixolydian', rootPc: 0 }
Chord.of('C', 'maj7').tensions('ionian'); // [2, 9]  (9 and 13; the 11 is an avoid note)
```

## Voice chords

Realize a progression into smooth 4-voice (SATB) MIDI voicings with minimal
motion, or voice a single chord in a comping style (drop-2/3, shell, rootless):

```ts
import { Chord, Key } from '@libraz/libcantus';

const c = Key.major('C');

// A whole progression, voiced with minimal motion:
c.chord(0, 'maj').progressionTo(c.chord(5, 'maj'), c.chord(4, 'dom7'), c.chord(0, 'maj')).voice();
// [[...], [...], [...], [...]]  (one ascending pitch per voice)

// A single chord in a shell comping voicing:
Chord.of('C', 'maj7').styledVoicing({ style: 'shell' }); // root, third, seventh
```

`voiceLeadingCost` and `nextVoicing` let you steer the leading, and the
`counterpoint` predicates (parallel/hidden perfects, spacing, voice crossing,
leading-tone resolution, …) let you validate it.

## Generate parts

Seeded, deterministic generators for melody and accompaniment:

```ts
import {
  generateBassLine, generateCounterMelody, generateDrums, generateRhythm,
  generateMotif, majorKey, parseTimeSignature,
} from '@libraz/libcantus';

generateRhythm(parseTimeSignature('4/4'), { seed: 1, density: 0.5 }); // strong-beat-weighted onsets
const motif = generateMotif({ key: majorKey(0), bars: 2, contour: 'arch', seed: 1 });
motif.notes.length > 0; // true — a deterministic short melodic cell
```

`humanize`, `extractGrooveTemplate`, and `applyGrooveTemplate` add a meter-aware
feel — or capture the feel of one performance and transplant it onto another.

## Analyze and extend an arrangement

The arrangement layer takes raw multi-track `NoteEvent`s — whatever your DAW or
MIDI-file parser produced — recovers the harmony, then analyses and generates
against it:

```ts
import {
  analyzeArrangement, chordTimelineFromNotes, generateBassLine, generateCounterMelody,
} from '@libraz/libcantus';

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
generateCounterMelody({ melody: melodyNotes, timeline, key, register: 'below' });
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
import { frequencyOf, edo, justDeviationCents } from '@libraz/libcantus';
```

Meter helpers (`TimeSignature`, `parseTimeSignature`, `beatsPerBar`,
`metricWeight`, `isStrongBeat`, `tuplet`) cover simple and compound meters and
back the accent-aware generators.

## Documentation

Full API reference — every export with signatures, categorized by domain and
with runnable examples — is generated from the source and published at
**[libraz.github.io/libcantus](https://libraz.github.io/libcantus/)**.

## License

Apache-2.0
