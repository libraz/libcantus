# Introduction

`@libraz/libcantus` is a TypeScript music-theory engine for software that already has notes or chord symbols. It works with MIDI pitch numbers, spelled notes, chord specifications, keys, and timed note events. It does not read or write MIDI files, render notation, analyze audio, or play sound.

## The mental model

The library has two kinds of public operation:

- Values such as `Note`, `Chord`, `Key`, and `Progression` have immutable class wrappers and plain-data forms.
- Collections and timelines are handled by pure functions over arrays of `NoteEvent` values.

The two styles interoperate. A class exposes its plain value through `.data`, and functions that analyze or generate music return data that can be passed to another function or wrapped by a class.

Every `NoteEvent` uses MIDI pitch and quarter-note beats:

```ts
import type { NoteEvent } from '@libraz/libcantus';

const note: NoteEvent = {
  pitch: 60,
  startBeat: 0,
  durationBeat: 1,
  velocity: 96,
};
```

Negative `startBeat` values represent a pickup. Optional `velocity` and `articulation` fields carry performance detail without changing the timing model.

## Layers

The package root exports the complete public API. The same exports are grouped into five subpaths:

| Subpath | Focus |
| --- | --- |
| `@libraz/libcantus/core` | pitch, intervals, meter, tempo, tuning, validation, and instrument data |
| `@libraz/libcantus/theory` | scales, chords, spelling, harmony rules, and voicing |
| `@libraz/libcantus/analyze` | chord/key detection, timelines, form, and arrangement analysis |
| `@libraz/libcantus/generate` | progressions, motifs, rhythms, drums, bass, and counter-melody |
| `@libraz/libcantus/model` | immutable `Note`, `Interval`, `Chord`, `Key`, and `Progression` classes |

## What the engine assumes

Analysis above the pitch layer uses twelve pitch classes. Frequencies, cents, equal divisions of the octave, and just-intonation ratios are available in `core`, but harmonic analysis does not model microtonal pitch classes. Functional harmony is intended for compatible tonal material; `supportsFunctionalHarmony` lets a caller check a named scale before applying that reading.

The engine keeps spelling information when it matters. A diminished fifth and an augmented fourth can share a pitch-class distance, but they are not the same written interval. Part-writing, counterpoint, and line spelling therefore accept spelled notes or a key context instead of reducing everything to numbers.

