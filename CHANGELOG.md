# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.3] - 2026-07-15

### Added

- Core-layer note-event index: `createNoteEventIndex` with the `NoteEventIndex`
  and `IndexedNoteEvent` types, giving fast sounding-at-beat and time-window
  lookups over a note list. The chord-timeline analyzer now builds on it.
- Core-layer runtime validation helpers — `assertNoteEvent`, `assertNoteEvents`,
  `assertRange`, `assertTimeSignature`, `assertInteger`, `assertPositiveInt`,
  `assertFiniteNumber`, `assertGenerationBudget`, and `DEFAULT_GENERATION_BUDGET`.
- Optional `DetectChordOptions` argument on `detectChord` and `detectChordBest`
  (defaults preserve the previous behavior).
- `bench:timeline` script for benchmarking the note-event index.

### Changed

- Public generation and analysis entry points now validate their inputs and
  throw a descriptive error on malformed note events, out-of-range values, or an
  invalid time signature instead of producing undefined results.

### Fixed

- Type resolution for CommonJS consumers: the `exports` map points each `require`
  condition at a dedicated `.d.cts` declaration, so `require()`-based TypeScript
  projects resolve the correct types.

## [0.9.2] - 2026-07-07

### Added

- Per-layer subpath entry points, so a consumer can import a single layer
  instead of the whole package: `@libraz/libcantus/core`, `/theory`,
  `/analyze`, `/generate`, and `/model`. The package root still exports
  everything.

### Changed

- Renamed public option and record types for cross-surface naming consistency
  (the values they configure are unchanged):
  - `DrumGenOptions` → `DrumsOptions`
  - `GenerateMotifOptions` → `MotifOptions`
  - `GenerateProgressionOptions` → `ProgressionOptions`
  - `GeneratedChord` → `ChordSpan`

## [0.9.1] - 2026-07-07

A correctness pass across every public surface. Most entries are bug fixes, but
several change observable output or defaults — see **Changed** before upgrading.

### Added

- Additive-meter grouping via an optional `TimeSignature.grouping` (e.g.
  `[2, 2, 3]` for 7/8); group-head pulses carry an accent in `metricWeight` /
  `isStrongBeat`.
- Euclidean kick generation via `generateDrums({ euclideanKick })`, and the
  `house` / `synthpop` drum styles.
- Optional `jitter` option for `generateMotif` (off by default).
- Optional spelling hints (`rootSpelling` / `bassSpelling`) on chords produced by
  `parseChordSymbol`, preserved through the class API so flat-named chords keep
  their spelling.
- `toJSON()` on `Note`, `Key`, `Interval`, and `Progression`.

### Changed

- `chordToRoman` / `romanToChord` now round-trip across all chord qualities; the
  Roman-numeral output for several sixth, sus, and extended qualities changed
  shape (e.g. an added sixth renders `add6` instead of a figured-bass `6`).
- `detectKey` scores minor keys against natural, harmonic, and melodic minor, so
  cadential leading tones no longer misrank the tonic; empty input returns `[]`.
- `analyzeArrangement` re-checks each sustained note against every chord its span
  crosses (a held note can now yield multiple conflicts) and splits block-chord
  tracks into monophonic sub-voices before applying melodic labels.
- Cadence detection no longer pairs chord segments across a rest.
- `generateRhythm` forces an onset on every bar's downbeat and clamps `density`
  to `[0, 1]`.
- Groove templates carry their time signature and reject a mismatched meter on
  apply; the unrecorded-velocity sentinel is now `null` (`GrooveSlot.velocity` is
  `number | null`), so a genuine velocity of 0 survives extract/apply.
- `generateProgression` throws on an unknown preset id instead of silently
  substituting a random preset.
- `harmonizeMelody({ key: 'infer' })` can infer minor keys.
- Numeric-root `Key.major` / `Key.minor` spell with the fewest accidentals;
  `Note.transpose(0)` preserves the original spelling and `Chord.invert(0)` is
  root position.

### Fixed

- `spelledInterval` (and `Interval.between` / `Note.intervalTo`) no longer returns
  a malformed quality for descending same-letter semitones (e.g. `E` to `Eb`).
- `6/9` slash chords and flat-spelled chord symbols now round-trip through
  `parseChordSymbol` / `formatChordSymbol`; `parseChordSymbol` accepts lowercase
  roots.
- `detectChord` reports `exact` only when there are no extra **and** no missing
  tones.
- Voice leading penalizes hidden / direct perfect fifths and octaves, clamps
  voicings into MIDI range, and no longer double-counts parallel octaves.
- Bass generators sound the actual altered fifth for diminished / augmented /
  half-diminished chords and keep octave pickups within the register; the arch
  motif contour is symmetric and returns to the tonic.
- Low-energy drum fills are no longer occasionally silent, all fill variations are
  reachable, and the swung 16th-note "a" position lands in the correct place.
- Suspension subtype is measured from the bass rather than the root, and
  zero-length notes are dropped at ingest so they no longer appear only in
  labels / conflicts.

## [0.9.0] - 2026-07-07

Initial public release.

### Added

- Pure-TypeScript music-theory core: pitch, interval, scale, and tuning primitives.
- Chord and key recognition, functional harmony analysis, and pitch spelling.
- Composition modules: motif, rhythm, meter, progression, voicing, and chord-scale with modal interchange.
- Arrangement, reharmony, and chord-symbol modules.
- Fluent immutable class API (`Note`, `Chord`, `Key`, ...) layered over the tree-shakeable functional core.
- Dual ESM/CJS builds with bundled type declarations.

[0.9.3]: https://github.com/libraz/libcantus/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/libraz/libcantus/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/libraz/libcantus/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/libraz/libcantus/releases/tag/v0.9.0
