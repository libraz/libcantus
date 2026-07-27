# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.4] - 2026-07-27

A correctness and API pass across every layer. Most entries are bug fixes, but
several change observable output, tighten input validation, or rename a public
symbol — see **Changed** and **Removed** before upgrading.

### Added

- The note-event index gains an `OnsetTieBreak` option and a caller-supplied
  budget, and now backs the arrangement analysis and the countermelody generator
  as well as the chord timeline.
- Core-layer validation helpers `assertOneOf` and `dropSilentNotes`, and the
  `NoteEventAssertOptions` type.
- Coded errors: `InvalidInputError`, `NoSolutionError`, and
  `BudgetExceededError`, each carrying a `LibcantusErrorCode`, plus the
  `isLibcantusError` guard. They extend the built-in error types a caller
  already catches, so a rejected argument is still a `RangeError`. A voicing
  failure inside `voiceProgression` names the chord and its index.
- Interval primitives: `intervalSemitones`, `parseInterval`, and
  `transposeByInterval`, with the `IntervalQualityLabel` type.
- Transposition: `transposeChord`, and `transpose` methods on `Chord`, `Key`,
  and `Progression` that carry the key and keep interval sets a symbol round
  trip would lose. `Note.transposeBy` applies a spelled interval.
- Class API completeness: `toString` on all five classes, `fromJSON` on all five,
  `Chord.fromData`, `Progression.fromSpans`, `Progression.at`, progression
  iteration, `equals` on `Key` and `Progression`, `Chord.detectMatches`,
  `Key.detect`, and `Key.detectBest`. `Interval` gains `parse`, `fromData`,
  `invert`, `isConsonant`, and `equals`, and validates its own components.
- Recognition: `detectKeyBest` and `detectKeyFromNotes`, and `DetectKeyOptions`
  with per-pitch weights. `KeyMatch` now reports `variant` and `score`.
- Meter: `pulseBeats`, `barPositionToPulse`, and `formatBarPosition`, so a
  compound-meter position can be displayed as a musician reads it.
  `formatTimeSignature` can render an additive grouping.
- Tuning: `stepOf`, `centsFromNearestStep`, `stepsOfCents`, and `centsToRatio`,
  so a cents offset can be applied and not only measured.
- Scales: the melodic-minor modes `lydianDominant`, `mixolydianB13`,
  `locrianNatural2`, and `altered`, plus `phrygianDominant`, with the
  `ScaleName` and `ScaleNameInput` types and `requireScaleMask`.
- Chord vocabulary: `7sus4`, `7b5`, `7alt`, `13b9`, `maj13`, `maj7#11`, `min11`,
  `min13`, `minAdd9`, and `min6/9`, plus the ASCII stand-ins `o`, `o7`, `h`, and
  `h7` for the degree and half-diminished glyphs.
- Generators: `DRUM_NOTES` and `drumVoiceOf`, `rhythmToNoteEvents`,
  `motifToNoteEvents`, `BASS_STYLES`, `BORROWED_DEGREES`,
  `pickProgressionPreset`, and a caller-supplied `preset` on
  `generateProgression`. `generateCounterMelody` accepts a `ChordTimeline`.
  `generateMotif` and `developMotif` take a time signature.
- Analysis: `toVoiceNotes` and the `IdentifiedVoiceNote` and `SuspensionFigure`
  types. `tensionCurveFrom` reuses an existing analysis. `ArrangementOptions`
  gains `timeline`, `harmonyTracks`, and `minSeverity`; `Conflict` gains
  `trackIndex`, `originalIndex`, `noteId`, and `labels`.
- `PitchSpelling`, `ChordSegment`, and `ChordToneRole` as shared public types,
  and `intervalAboveRoot` / `isChordMember` as the shared chord predicates.
- Per-subpath `typesVersions` for consumers on the pre-`exports` resolver, and
  `./package.json` in the `exports` map.

### Changed

- **Breaking.** `ChordSpan` moved from the generate layer to the theory layer.
  It is still exported from the package root and from both subpaths.
- **Breaking.** The consonance enum is now `ConsonanceClass`; the spelling
  labels are typed as `IntervalQualityLabel`. The two senses of "interval
  quality" no longer share one name.
- **Breaking.** `Note.intervalTo` returns an `Interval` rather than a plain
  `SpelledInterval`. Call `toJSON()` for the plain record.
- **Breaking.** The substitution and borrowing kinds are named in one casing:
  `'chromaticMediant'`, `'secondaryDominant'`, `'parallelMinor'`,
  `'parallelMajor'`.
- **Breaking.** `chordPitchClasses` counts a slash bass among the chord's pitch
  classes, so `F/G` reports `[0, 5, 7, 9]`. Pass `{ includeBass: false }` for
  the interval template alone. `Chord.spell()` likewise appends a foreign bass.
- **Breaking.** `avoidNotes` and `availableTensions` throw on an unknown scale
  name instead of returning `[]`, which already means "this scale has none
  here".
- **Breaking.** `generateDrums` returns its hits in onset order, ties broken by
  pitch, rather than in the order the voices were accumulated.
- **Breaking.** The published package no longer ships `src` or `tsconfig.json`;
  the sourcemaps already carry the same sources.
- Input validation reaches the entry points it had missed and covers more of
  what an argument can get wrong: an unknown style, preset, or scale name is
  rejected, and a note pitch must be a MIDI number in [0, 127].
- Zero-length notes are accepted and ignored everywhere rather than throwing in
  some places and being dropped in others.
- `createRng` rejects a seed the 32-bit state cannot hold, and `Rng.prob`
  validates before drawing, so a rejected call leaves the stream where it was.
- `NoteEventIndex.at` resolves simultaneous onsets by a named voice — highest by
  default — rather than by input order. The countermelody generator picks the
  voice on the side of the texture it is writing against, so a chord in the
  melody track no longer makes its output depend on array order.
- A spelled interval's quality is read in the direction the letters move, so
  C# to Dbb is a doubly diminished second; comparing a note that carries an
  octave with one that does not is rejected rather than silently switching
  measurement modes.
- `harmonizeMelody` requires only `melody`; every other option has a default.
- `analyzeVoice` takes plain note events and defaults its other-voices callback.
- `extractGrooveTemplate` defaults its subdivision to a sixteenth-note grid.
- Chord-scale results are ordered by fit and then by conventional preference, so
  a chord that states no third no longer names a minor mode as its best fit.
  The list is documented as a fit ranking rather than an idiom ranking.
- Each layer barrel re-exports the types its own public signatures name, so a
  single-subpath consumer can spell every type it needs.
- `CounterMelodyOptions.chordChangeBeats` was added alongside a rewrite of
  candidate selection; a given seed can produce a different line than in 0.9.3.
  The seed now also breaks ties between equally good candidate pitches.
- The chord-progression cycle collapses a repeated degree only when the two
  degrees come from different steps of the preset.

### Removed

- **Breaking.** `IntervalQuality` — renamed to `ConsonanceClass`.

### Fixed

- `evaluateSafety` no longer reports a chord's own tones as dissonant, which had
  made every downstream judgement — countermelody, arrangement conflicts,
  tension curve — unreliable for diminished, half-diminished, and dominant
  chords.
- Spelling follows the key across every path: transposition, altered tensions,
  slash basses, non-heptatonic scales, `spell`, `withKey`, and the `Key`
  factories all resolve a spelling the same way.
- Voice leading resolves tendency tones: the chordal seventh falls by step and
  the leading tone rises, and the voicing search is bounded so an impossible
  request fails instead of running away.
- Roman numerals and chord detection agree with each other: applied dominants,
  modal numerals, inversion figures, and the `#III` / `bVII` readings.
- Arrangement analysis handles real multi-track input: percussion tracks are
  excluded from harmony, polyphonic tracks are split into monophonic
  sub-voices, and every conflict maps back to the caller's own note.
- Bass approach notes stay inside the register band; motif transforms that would
  leave the MIDI range are rejected.
- Relative substitutions are measured against the source chord's triad, so a
  seventh chord is offered the same relatives as its triad.
- The CommonJS build shares its chunks, so a class reached through the package
  root and through the `/model` subpath is one class; cross-entry `equals` and
  `instanceof` answered with a brand-check crash before.

### Performance

- `analyzeArrangement` is roughly linear in note count rather than quadratic.
- `generateDrums` indexes its onsets instead of scanning the accumulator.
- `generateCounterMelody` resolves each boundary once per onset rather than once
  per candidate pitch, so the caller's chord callback is no longer invoked once
  per pitch in the register.

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

[0.9.4]: https://github.com/libraz/libcantus/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/libraz/libcantus/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/libraz/libcantus/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/libraz/libcantus/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/libraz/libcantus/releases/tag/v0.9.0
