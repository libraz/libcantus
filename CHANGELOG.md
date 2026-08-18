# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **A chord voiced without its fifth keeps the seventh it plays.** The segment
  inference behind `chordTimelineFromNotes` weighed a candidate's key membership
  as heavily as the sounding pitch classes it failed to account for, so wherever
  the fifth was absent and the seventh chromatic in the key in force, the
  reading that discarded the seventh and asserted an unplayed fifth won: `C E Bb`
  came back as `C`, `C E Bb D` as an added-ninth chord, `C E Bb Eb` as a minor
  seventh, and `C Eb B` as a bare minor triad. Leaving a sounding pitch class
  unexplained now costs more than key membership can make up, while the absent
  perfect fifth `detectChord` already admits costs little, so a shell voicing is
  named by the chord it plays — `C7`, `C9`, `C13`, `C7#9`, `CmMaj7` — which is
  what `detectChordBest` returned for those pitches all along.

  Segments whose voicing omits the fifth therefore report a different chord than
  before, and everything layered on the timeline — `detectCadences`,
  `analyzeVoice` through the chord it is handed per beat, and
  `analyzeArrangement` — inherits the corrected reading. `detectChord` and
  `detectChordBest` never had the defect and are unchanged.

- **A chord's root is read from the bass, not from its loudest tone.** The same
  segment inference measured a candidate's root by nothing but the share of the
  window's weight that root carried, so a voicing whose upper tone was struck
  hardest was re-rooted onto it: `C E Bb` with the seventh loud and the root and
  third quiet came back as a B-flat chord over a C bass, discarding the E and
  asserting an F. A candidate the sounding bass puts in root position now has
  nearly full root standing however the velocities fell — nearly, rather than
  fully, so a pitch class that genuinely carries the window still outranks the
  bass and a chord voiced in inversion is not re-rooted onto its own bass note.

  Windows whose loudest pitch class is not the bass may therefore be named
  differently, root-position and shell voicings most of all. A window whose bass
  was filtered out as noise offers no bass to read and is unaffected.

## [1.0.0] - 2026-08-17

The first stable release. From here the public API follows Semantic Versioning
strictly: an export is not removed and a signature is not narrowed outside a
major. Getting there meant making the breaking changes now rather than carrying
them, so this release removes and reshapes more than any before it — read
**Changed** in full before upgrading.

The key stops being a single answer for a whole piece and becomes something the
analysis follows over time; chord boundaries are searched for rather than
assumed; keys become relatable and transposable by named interval; scale
degrees are counted the way musicians count them; and the vocabulary grows to
cover what a harmony exercise actually asks for — note names in German and
Japanese, augmented sixths, figured bass, part-writing violations, transposing
instruments, and a cadence that knows whether it is perfect.

Beyond that, the analysis gains units larger than the chord — phrases, sections,
hypermeter, motifs and a structural/passing reading of a progression — and
starts explaining itself: `analyzeChord`, `detectCadence`, `detectKey` and the
new `explainRoman` return the reasoning and the readings they rejected. Metre
may change mid-piece and a pickup may sound before the downbeat. Chords are
modelled as a base plus a set of alterations rather than a closed list of
names, so `C7(b9,#11)` parses; every parser gains a non-throwing sibling.
Generation gains articulation, instrument profiles that know which notes exist
on a four-string bass, a genre vocabulary held as data instead of branches, and
one continuous complexity dial in place of five differently-shaped knobs.

Most visibly, the library stops being a bag of functions. Twelve classes join
the five that existed, so a piece, its harmony over time, the settings it is
generated under, an arrangement of it, and a vertical set of voices are each
something you hold rather than a shape you pass from one function to the next —
and every entry point that takes a note, a key, a chord, or a meter now accepts
it as a name, as plain data, or as the class that holds one.

See **Changed** first — the degree change, the removal of
`ChordTimelineResult.key`, the replacement of `Cadence`, the meter map, the
re-addressed random number stream, the reshaped `Note.of`, the generation
options folded into the context, and three renamed types are all breaking.

Four of the changes are silent at the call site: the scale degrees, the
equal-length `TimeSignature.grouping`, the harmonizer's default
`harmonicRhythm`, and the `avoid`/`passing` split on `chordScaleReport`. Each
kept its name and its type, so nothing fails to compile and nothing throws —
what changes is the answer.

### Changed

- **The key is analyzed over time instead of once for the whole piece.**
  `chordTimelineFromNotes` and `analyzeArrangement` used to infer a single key
  from every note pooled together, so a piece that modulates had every Roman
  numeral, harmonic function, cadence and note-safety verdict after the
  modulation judged against the key it started in. Both now return
  `keys: KeyRegion[]` — one region per key area, each carrying its confidence,
  its relation to the region before it, and the pivot chord the modulation
  turned on where the chords name one — alongside `prevailingKey`, the key held
  longest, for callers that want a single answer.

  `ChordTimelineResult.key` and `ArrangementAnalysis.key` are gone; read
  `prevailingKey` for the old whole-piece value, or `keys` to follow the
  modulations. Passing `key` still pins one key across the whole span, since
  that is the caller answering the question rather than asking it; the new
  `keys` option supplies regions a previous pass already worked out.

  `detectCadences` and `analyzeVoice` now accept a key callback as well as a
  single key, so a cadence is classified in the key it arrives in and a leading
  tone is judged against the tonic it resolves onto. Passing a plain `KeyScale`
  behaves exactly as before.

- **`chordTimelineFromNotes` searches for chord boundaries instead of assuming
  them.** The span used to be cut every `harmonicRhythm` beats — one bar by
  default — so a bar holding two chords collapsed into one segment and a chord
  crossing a bar line was split in two. Boundaries are now chosen by a dynamic
  program over fine slots, trading each slot's harmonic fit against a cost per
  chord change that a strong beat discounts, so segments follow the harmonic
  rhythm the notes actually have. Under the new default, `harmonicRhythm` is a
  prior on the expected chord length rather than the window size, and
  `minChordBeats` (default one beat) bounds how fine a change may be reported.
  Pass `segmentation: 'grid'` for the previous fixed-window behaviour.

  Segment boundaries, segment counts, `segmentConfidence`, and the `atBeat` of
  every cadence found by `detectCadences` therefore move for inputs whose
  harmony did not change exactly once per `harmonicRhythm`. The chord reported
  for a settled segment is inferred exactly as before.

- **`detectKey` ranks by key-profile correlation instead of scale membership.**
  Every scale tone used to count the same, so a key and its relative — which
  share all seven pitch classes — were separated only by a flat bonus on the
  tonic, and on a bare scale they tied outright. Candidates are now ranked by
  the Pearson correlation between the weighted pitch-class distribution and the
  candidate key's profile, which is what the standard key-finding algorithms
  do. `score` is that correlation, in [-1, 1], where it was previously a
  membership sum in [0, 1.5]. A new `profile` option selects
  `'krumhansl'` (the default), `'temperley'`, `'flat'` (the previous
  membership behaviour), or a caller's own pair of 12-entry vectors.

  Minor-variant selection is now independent of ranking: candidates are ranked
  with the minor profile, and the reported `variant` is whichever of natural,
  harmonic, and melodic minor best covers the input. `fit` is unchanged.
  Ranking is deterministic, with ties broken by fit, then tonic, then mode.

- **Scale degrees are 1-based throughout the public API.** Degree 1 is the
  tonic and degree 5 the dominant, so the numbering agrees with the Roman
  numerals the same classes already speak. `chordFromDegree`, `diatonicTriad`,
  `diatonicSeventh`, `secondaryDominant`, `Key.chord`, `Key.diatonicTriad`,
  `Key.diatonicSeventh` and `assertDegree` all take a degree from 1;
  `pitchToScaleDegree` returns one from 1, keeping `-1` for a pitch outside the
  scale. Degree 0 is rejected rather than wrapping onto the leading tone, so an
  un-migrated call throws instead of quietly naming the wrong chord. Degrees
  past the end of the scale still wrap, so degree 8 of a heptatonic key is the
  tonic. Progression presets follow: diatonic codes in a `degrees` array move to
  1..7, while the `BORROWED_DEGREES` codes are unchanged, and `ChordSpan.degree`
  is now the 1-based degree its documentation always described.

  Upgrading: add one to every degree argument. The presets, chord qualities and
  pitch classes they produce are unchanged.

- **A cadence is a description rather than a label.** `detectCadence` returned
  one of four strings, which could not say whether an authentic cadence was
  perfect, and had no name for the Phrygian cadence, the bVII–I of rock and
  pop, or a dominant that resolves onto an inversion. It now returns a
  `CadenceResult` carrying `type` — widened with `'phrygian'` and `'modal'` —
  along with `strength` for the perfect/imperfect distinction, the `soprano`
  scale-degree role, whether both chords stand in `rootPosition`, and whether
  the arrival is `evaded`.

  A perfect authentic cadence needs root position in both chords and the tonic
  in the soprano, so `detectCadence` takes an optional `voicing`. Without one
  the soprano is unknowable and `strength` is `null` rather than a guess; a
  leading-tone approach is reported `'imperfect'` even so, since it can never
  be perfect. `CadenceHit.type` becomes `CadenceHit.cadence`, and
  `Progression.analyze().cadence` returns the same structure. The `Cadence`
  type is gone; read `CadenceResult['type']` for the old value.

- **The metre may change during a piece.** Analysis carried one
  `ts: TimeSignature` for a whole work, so a metre change could not be
  expressed and every bar line after it was wrong. `chordTimelineFromNotes`,
  `keyTimelineFromNotes` and `analyzeArrangement` take
  `meters: { startBeat, ts }[]`; `ts` remains accepted as sugar for a
  one-element map, and naming both is an error. Everything positional —
  `metricWeight`, `isStrongBeat`, `beatToBarPosition` and the rest — takes
  `MeterLike` and derives its position from the bar in force rather than from a
  single global modulo, so a 4/4 → 3/4 change puts the accents where the score
  puts them.

- **An equal-length `TimeSignature.grouping` states no accent of its own.** A
  grouping is how an irregular division is declared — `[2, 2, 3]` on 7/8 — and
  each group head other than the downbeat is a secondary strong pulse. Groups
  that are all the same length declare the division the meter already has, and
  promoting every one of those heads erased the difference between a group head
  and a real secondary strong pulse: 9/8 as `[1, 1, 1]` accented all three
  dotted-quarter pulses alike, where the bar's midpoint is not a pulse at all and
  the meter has no secondary strong pulse to give. `metricWeight` and
  `isStrongBeat` now weigh such a bar exactly as an ungrouped one, so
  `9/8 [1,1,1]`, `9/8 [3,3,3]`, `6/8 [3,3]`, `12/8 [1,1,1,1]`, `4/4 [1,1,1,1]`
  and `3/4 [1,1,1]` all report different weights — `6/8 [3,3]` in `metricWeight`
  alone, its strong beats being where they already were. Unequal groupings are
  unaffected, and so are equal ones whose second group head is already the bar
  midpoint — `6/8 [1,1]` and `4/4 [2,2]` weighed as ungrouped bars either way.

  The field kept its name, its type and its position, so an equal-length
  grouping still compiles and still returns plausible numbers; what changes is
  that a caller placing accents, weighting a histogram or driving humanization
  from metric weight gets flatter output across every bar that declared its
  division. No equal-length grouping reproduces the old per-group accents.

- **A pickup may sound before the downbeat.** `NoteEvent.startBeat` was
  required to be non-negative, and the documented workaround — shift the whole
  piece — moved every strong beat off its bar line and made metric analysis
  musically wrong. Negative onsets are now how an anacrusis is written: the
  downbeat is beat 0, the pickup is bar -1, and `pickupBeats` declares how far
  back a note may legitimately start. Nonsensical onsets are still rejected.

- **A melody is harmonized from its structural tones.** `harmonizeMelody`
  weighed an accented non-chord tone more heavily than `V→I` and a descending
  fifth combined, so note coverage beat functional harmony: Twinkle in C major
  came back as `C C F Em F Am Dm`, ending away from the tonic, and under
  `reharmonize: 'secondaryDominant'` the tonic never appeared at all. Ornamental
  tones are now classified from the melody and its metre *before* any chord is
  chosen and left out of the fit cost, the cost table is scaled so the harmonic
  terms are of the same order, and a phrase-final cadence carries comparable
  weight. Twinkle returns `C F C F C G C`. `transposeSearch` moves the melody
  into the target key and harmonizes it there — it used to move the melody and
  leave the key behind, so the two disagreed — and the register adjustment it
  was documented to perform is now `octaveSearch`.

- **Generation draws its randomness by position rather than by call order.**
  Changing a parameter in the middle of a piece redrew the whole stream. Each
  decision is now addressed by where it happens (bar, beat, voice) from a seed
  derived per part, so a change anywhere leaves everything else alone. The same
  seed produces different output than before; `algorithmVersion` is the contract
  a caller pins to.

- **Complexity is one continuous dial.** `density` was quantised to three values
  inside the drum generator — 0.1 and 0.3 were the same 32 hits, 0.7 and 0.9 the
  same 80 — and every other generator expressed "how elaborate" as a different
  kind of thing: an enum, a boolean, a contour. `GenerationContext.complexity`
  carries `rhythmic`, `harmonic` and `ornament` on 0..1 with a `difficulty`
  ceiling. The additive dials are monotone by construction — raising one only
  adds events, and what was already sounding stays where it was. Above the
  neutral middle, `rhythmic` also syncopates the figures drawn from the genre
  vocabulary, which displaces onsets rather than adding them. `bpm` moves onto
  the context, so the bass generator can finally see it.

- **A seed, a tempo and a complexity dial go on the generation context and
  nowhere else.** Every generator also took a `seed`, most took a `bpm`, and the
  drum generator took a `density` — each of them sugar for a field of `ctx`,
  each with its own precedence rule against the context, and each silently
  ignored when the other was set. All of them are gone; write
  `ctx: { seed, bpm }` and `ctx: { complexity: { rhythmic } }`. The boolean
  `reharmonize` on `generateProgression` stood for the middle of the harmonic
  dial and is gone with them — write `ctx: { complexity: { harmonic: 0.5 } }`.
  The strategy-valued `reharmonize` on the harmonizer stays, as do the tempo
  fields on the context and the vocabulary; those name things rather than
  duplicate them. `GenerationContext.seed` becomes optional, so a context naming
  only a tempo stays writable now that the context is the only place a seed can
  go.

  A dropped option is not a type error when it sits in an object literal that
  still matches — the extra property is discarded and the call runs on the
  default. Check for `seed`, `bpm`, `density` and `reharmonize: true` at
  generator call sites rather than trusting the build.

- **`Note.parse` reads a note name; `Note.of` builds a note from its parts.**
  `Note.of` accepted both a name and a set of parts, which made it the one
  constructor in the family that did two jobs — `Chord`, `Key` and `Interval`
  all read a name through `parse`. `Note.of` now takes a letter, an alteration
  and an optional octave, and refuses a name carrying an accidental or an
  octave with an error naming `Note.parse` as the way to read it. Replace
  `Note.of('Eb4')` with `Note.parse('Eb4')`. `Chord.from`, a third spelling of
  `Chord.fromData`, is dropped.

- **A cadence is read against the harmony it stands on and the degrees its key
  has.** A cadential six-four was read as a tonic in second inversion arriving
  on its own dominant — two chords, the first of them given the wrong function.
  `detectCadence` now takes the chord before `from` as `approach` and reports
  the pair as one cadence that began there, `reduceProgression` keeps that
  six-four in the frame, and a six-four resolving onto its own dominant is one
  harmony moving inside itself rather than a cadence. Cadence types are judged
  against the degrees the key itself has instead of fixed semitone distances, so
  a mode evades onto its own submediant and an arrival on a dominant that
  carries no leading tone rests as a half cadence — while a borrowed minor `v`
  in a major key still does not.

  `checkPartWriting` exempts the cross relations that chromatic harmony, a
  stepwise approach or a pair of inner voices explains, reports each pair once,
  and resolves spacing and ranges through the voicing validators, so a limit
  that cannot be met fails instead of switching a rule off unnoticed.
  `analyzeVoice` gains the appoggiatura and withholds a suspension figure whose
  interval the note does not form, and `classifyMelodyTones` reads an onset
  against the pulse, so a played phrase forms the figures the notated one does.
  `checkSpecies` grades the shape of a line and lets the cambiata and the double
  neighbour stand as the figures they are. The reduction level `auxiliary` is
  renamed `neighbor`, the word `analyzeVoice` already uses for that figure, and
  each chord of a reduction carries the beats it holds.

  The same input can read differently than before: cadence types and rationales
  in modal and six-four contexts, reduction levels, the ornament labels on a
  melody, and part-writing violations that now carry an explanation.

- **A named phrase end cuts the chord grid.** `harmonizeMelody` divided the grid
  on the harmonic rhythm alone, so a phrase closing mid-bar was harmonized
  across its own cadence. Every beat named in `phraseEnds` now ends a slot, and
  the grid resumes on the harmonic rhythm's own boundaries after it. Each slot
  carries its own length on `Segment.beats` and the transition and phrase-end
  scores are weighed by it, so a slot cut short is worth what it lasts. A close
  is required to change the harmony — a cadence being a chord change — wherever
  the candidate vocabulary offers more than one harmony to move to, and the note
  a phrase comes to rest on is kept as a structural tone, so a close on the
  tonic between two supertonics is no longer read as a lower neighbour of the
  next phrase's first note. A call passing `phraseEnds` can harmonize the same
  melody differently than before; a call that names none is scored exactly as it
  was.

- **`harmonizeMelody` reads its default `harmonicRhythm` from the meter.** The
  default was a flat 2 beats whatever `ts` said. That is half a bar of 4/4 and an
  arbitrary length in anything else — in 3/4 it cut across the bar line, and in
  2/4 it covered a whole bar where 4/4 got half of one. The default is now half a
  bar where the half falls on a pulse and the whole bar where it does not: 2 in
  4/4, 1 in 2/4, 1.5 in 6/8, 3 in 12/8, and the full bar in 3/4 (3) and 5/4 (5).
  A 4/4 caller sees no change, which is also what makes this easy to miss; a 3/4
  caller on the default now gets slots half again as long, and a 2/4 caller twice
  as many, from the same melody.

  `HarmonizeResult.chords` also emits one span per chord change rather than one
  per grid slot, so a chord held across several slots is one span and
  `chords.length` is no longer the slot count.

- **`ChordScaleReportEntry.avoid` narrowed to the melodic reading, and the rest
  moved to `passing`.** One list answered two questions at once — which scale
  tones must not be *sounded* against the chord, and which a line may not even
  pass through — so the perfect fourth over `Cmaj7`, which a line passes through
  freely, was reported exactly like the flat ninth over a phrygian `Cmin`, which
  it cannot. `chordScaleReport` now returns `avoid` for the melodic reading alone
  and a new `passing` for the remainder; `avoid` concatenated with `passing` is
  the old value. `avoidNotes` gains `opts.use`, `'harmonic'` (the previous
  behaviour, and still the default) or `'melodic'`, which is the same split seen
  from the other side.

  `avoid` kept its name and its type, so a view rendering it alone still compiles
  and silently stops listing the tones that moved — over `Cmaj7` and `C7` that is
  the perfect fourth, and over `Cmin` the minor sixth.

- **Input that used to be taken on trust is refused where it is given.** An
  entry point that received something it could not use would fall back to a
  default, propagate a `NaN`, or answer from a value nobody meant — and the
  caller learned of it, if at all, several steps later as a wrong number. These
  now raise one of the library's own errors, so the cause is named at the call
  that caused it and a caller can tell "fix the input" from "loosen the
  constraint" by `code` rather than by reading the message. Among them:
  `parseTimeSignature` and `parseKeyName` given a non-string; `midiToNote` and
  `transposeNote` given a spelling name with no table entry, which used to fall
  back to sharps; `intervalSemitones` given a number outside 1..75 or a quality
  that number cannot take; `parseInterval` given `'d1'`, since a unison cannot
  be diminished; `formatNote`, `noteToMidi` and their neighbours given a letter
  outside 0..6; the tempo conversions and `createNoteEventIndex` queries given
  `NaN` or an infinity; the spelling functions given a tonic that does not
  sound the key's root; `profileWeights` and the safety queries given an
  unknown profile; `checkPartWriting`, `checkSpecies` and `voiceIndependence`
  given lines of unequal length; and `analyzeArrangement` given a
  `harmonyTracks` index naming no track. `voiceChord` and `analyzeArrangement`
  raise `BudgetExceededError` before building a search that cannot finish,
  where the work used to grow unchecked.

  This is the class of change most likely to surface at runtime rather than at
  the build: the call sites still typecheck, and what changes is that a
  malformed value stops being absorbed.

- **`TheoryLabel` gained a member, and some notes moved onto it.**
  `analyzeVoice` reports `{ kind: 'appoggiatura'; resolveTo: number }` for a
  note approached by leap that resolves by step in the other direction. Those
  notes used to come back as `{ kind: 'needsResolution' }`, so a view filtering
  on `needsResolution` no longer sees them; `needsResolution` itself stays and
  is still returned for everything else. A `switch` over `kind` with an
  exhaustiveness check no longer compiles until the new member is handled.

- **`SubstitutionType` lost `'secondaryDominant'`.** `substituteChord` proposes
  four kinds and no longer offers an applied dominant: which dominant applies
  is a question about the target chord rather than about the chord in hand.
  Build one with `secondaryDominantOf`, or let `harmonizeMelody` open its
  vocabulary with `reharmonize: 'secondaryDominant'`, which is unrelated and
  unchanged. Code matching on the removed member is now dead.

- **One name per section, and it is the one a caller writes.** `Section`,
  `PublicSection` and `SectionType` were all published for what is two
  concepts. `SectionType` is the narrower set the pattern tables are keyed by —
  it answers to `'a'` and `'b'` and refuses `'verse'` and `'prechorus'` — so a
  caller who reached for the most obvious-looking name was held to a vocabulary
  that is not the public one. It is now internal, `PublicSection` is renamed to
  `Section`, and `Section` is the only name published. `KickSlot.sections`
  moves to the public vocabulary with it: a slot restricted to the prechorus is
  written `sections: ['prechorus']`, where it used to be `['b']`.

- **`parallelKey` is no longer published.** It returned a `KeyScale`, which has
  nowhere to put a spelling, so the parallel of D-flat major came back as a key
  whose root is pitch class 1 with no way to tell D-flat minor from C-sharp
  minor. Beside `parallelKeyOf`, which keeps the tonic, it was the shorter name
  with the simpler signature and the silent loss. Use `parallelKeyOf(tonic,
  key)`, which sits with `relativeKeyOf`, `dominantKeyOf` and
  `subdominantKeyOf`, or `Key.parallel()`.

- **Three types are renamed to free the bare name for the class that holds
  one.** `Tuning` becomes `TuningTable` — it is the table of steps a temperament
  is defined by, not the temperament itself; the melody module's `Motif` result
  becomes `MotifData`; and the written-duration `Duration` becomes
  `DurationData`, matching `NoteData` and `ChordData`. The renames are
  type-only: `edo`, `frequencyOf`, `nearestStep`, `MotifCell`, `MotifNote`,
  `SpelledDuration`, `NoteValue`, `Tuplet` and every function keep their names
  and behaviour, and a type-only rename fails the build rather than the run.

### Added

- **Note names in German, Japanese and Italian.** `parseNote` and `formatNote`
  take a `system` of `'english'`, `'german'`, `'japanese'`, `'italian'` or
  `'fixedDo'`, and `parseKeyName` / `formatKeyName` / `Key.parse` /
  `key.toString` do the same for key names, so `gis moll` and 嬰ト短調 can be
  written as they are written. Double accidentals round-trip in every system.

  With no `system`, the notation is detected, and a name that reads as English
  is read as English: `B` stays B natural, and German is chosen only on a cue
  no other system uses — `H`, an `-is` or `-es` ending, or `dur` / `moll`. A
  name that mixes systems, such as `gis major`, is rejected rather than
  guessed. `detectNoteNameSystem` exposes the same decision.

  Chord symbols take the same option but never detect, because `B` is B flat in
  German and B natural in English with no mode word to separate them:
  `parseChordSymbol('H7', { system: 'german' })` is a B dominant seventh, while
  the default reading of every existing symbol is unchanged.

- **Augmented sixths and the Neapolitan sixth.** `romanToChord` and
  `chordToRoman` speak `It6`, `Fr6`, `Ger6` and `Ger65`, applied to a degree
  like any other numeral, so `Ger6/V` is read. All three stand on the lowered
  submediant with the augmented sixth above it — spelled as an augmented sixth,
  never as the minor seventh it sounds like — and all three are classified as
  predominants. `augmentedSixthChord`, `spellAugmentedSixth` and
  `augmentedSixthKind` are available directly. A first-inversion Neapolitan
  renders as `N6` under `chordToRoman(..., { neapolitan: true })`, with `bII6`
  remaining the default.

- **Figured bass.** `realizeFiguredBass(bass, figures, key)` reads a figured
  bass into a chord: the triad and seventh-chord positions, accidentals
  attached to a figure or standing alone to raise the third, and moving
  suspensions such as `4-3`. Every unfigured interval is the one the key gives,
  so the same `6` names a different chord on each scale degree.
  `figuredBassRealization` returns the spelled notes and the suspensions
  alongside the chord, and `figuredBassOf` writes the figures back.

- **Part-writing violations.** `checkPartWriting(voicings, chords, key)` walks a
  progression and reports parallel fifths and octaves, hidden perfects, cross
  relations, voice crossing, overlap, spacing, range, unresolved leading tones
  and sevenths, and augmented melodic intervals — each with the voices, the
  chord indices, and a sentence saying why. It takes spelled notes rather than
  MIDI numbers, which is what lets it tell an augmented second from a minor
  third and a cross relation from an ordinary chromatic step; `spellVoicing`
  converts a voicing that only has integers.

- **Transposing instruments.** `toSoundingPitch` and `toWrittenPitch` convert
  between written and sounding pitch for the `TRANSPOSING_INSTRUMENTS` table or
  any interval of your own, and `Key.forInstrument` gives the key a player
  reads. Each transposition is a spelled interval, so a written D♯ on a
  clarinet in A sounds B♯ rather than C, and the octave rides in the interval:
  an alto saxophone sounds a major sixth lower where an E♭ clarinet sounds a
  minor third higher.

- **Key regions.** `keyTimelineFromNotes` finds where the key changes in raw
  notes by correlating each slot against all 24 key profiles and choosing the
  run of keys that best explains the piece, paying a cost per modulation that
  rises with the distance travelled around the circle of fifths and falls on
  strong beats. `detectModulations` does the same from a chord sequence, where a
  dominant seventh resolving to its tonic is read as the cadence it is, and
  names the pivot chord each modulation turned on. `prevailingKeyOf` reduces a
  run of regions to the key held longest.

- **`pivotChords(from, to)`** lists the triads two keys share, each with its
  Roman numeral in both — the chords a modulation between them can pivot on.

- **`spelledKeyOf(key)`** gives a `KeyScale` the tonic spelling its key
  signature would use, so pitch class 1 major comes back as Db and pitch class 6
  minor as F#.

- Key relations, on the circle of fifths so the result is spelled the way the
  key is written: `relativeKeyOf`, `parallelKeyOf`, `dominantKeyOf`,
  `subdominantKeyOf`, `enharmonicKeyOf`, `relatedKeysOf`, and
  `keyRelationBetween`, with the `SpelledKey`, `KeyRelation`, and `KeyMode`
  types.
- The same relations on the `Key` class — `relative`, `parallel`,
  `dominantKey`, `subdominantKey`, `enharmonic`, `relatedKeys`, `relationTo` —
  plus `fifths` and `Key.fromFifths`, which put the existing key-signature
  functions within reach of the class API.
- Scale degrees on `Key`: `degree`, `keyOnDegree`, and
  `keyHavingTonicAsDegree`, the last two being inverses.
- Transposition by a named interval: `Key.transposeBy`, `Chord.transposeBy`,
  `Progression.transposeBy`, `Progression.transposeTo`, and `Key.intervalTo`.
  An augmented fourth and a diminished fifth now transpose to different
  spellings.
- `toSpelledInterval` and the `IntervalLike` type, so any entry point taking an
  interval accepts a name, plain interval data, or an `Interval` instance.
- `parseInterval` and `Interval.parse` accept a leading `-` for a descending
  interval (`'-A4'`), and `Interval` gained `isDescending` and `negate`.

- **Units larger than the chord.** `phrasesFromTimeline` splits a piece into
  phrases from cadences, rests, repetition and hypermetric position, each with
  its closing cadence and a confidence; `structuralCadences` ranks them, so
  "the cadence of this piece" is answerable rather than a flat list.
  `hypermeter` infers the grouping of bars into hyperbars, and
  `sectionsFromNotes` recovers an A/B/A form from repetition. Sections are
  lettered, never named "chorus" — repetition alone cannot tell a chorus from a
  second verse.

- **Melodic analysis.** `extractMotifs` finds recurring cells by interval
  contour and rhythmic profile, so a restatement at another pitch level or in
  wider note values is recognised as the same figure. `relateMotifs` names how
  two statements relate — repetition, transposition, inversion, retrograde,
  retrograde inversion, augmentation, diminution — and distinguishes a real
  sequence from a tonal one, which is the difference the key makes.
  `melodicSimilarity` and `melodicContour` cover the cases no exact
  transformation explains.

- **A structural reading of a progression.** `reduceProgression` marks each
  chord `structural`, `passing` or `auxiliary`, so `Cmaj7 → C#dim7 → Dm7` is no
  longer three chords of equal standing. The default position — a chord is
  structural unless it is demonstrably an embellishment — is stated in the
  module, and the salience reading is available as `basis: 'duration'`.

- **The analysis explains itself.** `analyzeChord`, `detectCadence` and
  `detectKey` carry a `rationale` in the style `analyzeVoice` already used, plus
  the readings they considered and rejected. `explainRoman` returns a Roman
  numeral together with the reasoning behind it, derived from the same pass that
  produces the numeral so the two cannot drift apart.

- **Whole-line spelling.** `spellLine` solves a voice's spelling as one path
  instead of note by note, so a line stops alternating between sharp and flat
  readings of the same idea. A rising chromatic line takes sharps and a falling
  one flats; a tone the chord names follows the chord's spelling, which is what
  makes the seventh of `Db7` read `Cb`.

- **Incremental re-analysis.** `createArrangementSession` recomputes only the
  beats an edit affects and splices them into the previous analysis, for callers
  re-analysing on every keystroke. The result equals a full re-analysis of the
  same input; where it cannot be made equal, the session falls back to a full
  pass rather than returning something close.

- **Modal key candidates.** `detectKey` can rank the church modes alongside the
  24 major and minor keys under `{ modes: true }`, reporting the mode in
  `KeyMatch.scaleName` while `mode` stays the major or minor key it leans on.
  Off by default, and the default ranking is unchanged.

- **Pitch material from outside the Western canon.** `WORLD_SCALES` holds the
  Japanese *in* and *yo* scales, four maqāmāt and the Hindustani *thāṭ* sets,
  each documenting the tradition it comes from. `ScaleSystem` and
  `supportsFunctionalHarmony` let analysis decline to apply Roman-numeral
  function to material that does not take it. The maqāmāt built on half-flat
  degrees are absent rather than approximated, which is stated where a reader
  will look for them.

- **A structured chord model.** `ChordSpec` describes a chord as a base, an
  optional seventh, and sets of alterations, additions and omissions, so
  `Cmaj7(#11)`, `C7(b9,#11)`, `C7(13)`, `Csus4(add9)` and `C-∆9` parse — a
  closed list of names could never cover the combinations a lead sheet writes.
  The 45 existing quality names remain, `Chord.quality` is derived, and pitch
  content, inversion and symbol formatting all run through the spec.

- **Non-throwing parsers.** `Chord.tryParse`, `tryParseChordSymbol`,
  `tryParseNote` and `tryParseInterval` return
  `{ ok: true; value } | { ok: false; error }`, so a chord-entry field does not
  need a try/catch per keystroke. The throwing versions are built on them.

- **Tempo and note values.** `beatsToSeconds` / `secondsToBeats` integrate a
  piecewise-constant `TempoMap` exactly across tempo changes, with
  `beatsToTicks` / `ticksToBeats` for a PPQ grid. `beatsToDuration` spells a
  length the way it is notated — 1.5 beats is a dotted quarter, a third of a
  beat is an eighth triplet — and `beatsToTiedDurations` decomposes what no
  single note value spells.

- **Species counterpoint and voice independence.** `checkSpecies` grades the
  five species against the shared part-writing violation vocabulary. The
  counterpoint predicates take spelled notes, so an augmented second is no
  longer indistinguishable from a minor third and the melodic prohibition on it
  is detectable at all. `voiceIndependence` measures motion, rhythmic
  complementarity, registral separation and consecutive perfect consonances and
  returns numbers rather than a verdict, because species rules applied to pop
  music flag parallel thirds and pedal points as errors. `imitate` writes a
  canonic entry, real or tonal, which `transformMotif` could not express.

- **Articulation and playability.** `NoteEvent` and `DrumHit` carry an optional
  `articulation`; the flam that was hard-coded as a pair of notes inside one
  drum fill is now an attribute any material can take. `InstrumentProfile`
  derives an instrument's range from its tuning and fret count rather than
  storing it, so a five-string bass, drop D and a seven-string guitar all fall
  out of one formula. `playability` reports what does not exist, what cannot be
  fingered, and what cannot be reached in time — the first two depending on the
  instrument alone. A bass line whose register leaves the instrument is folded
  by the octave, as a player would; passing no profile leaves generation exactly
  as it was.

- **Genre vocabulary as data.** The drum fill archetypes, kick figures and ghost
  densities move out of `switch` statements into dictionaries, and bass gains a
  lick dictionary held as chord-relative degrees. `Vocabulary<T>` carries each
  figure's applicability — genre, section, tempo range, metre, difficulty — so
  selection is a lookup. Genre selects the material, complexity deforms it and
  difficulty rejects it, which keeps the three from fighting.
  `GenerationContext.vocabulary` lets a caller bring their own. `KickPattern`
  widens to a sixteenth grid, without which most of what belongs in the
  dictionary cannot be written. No entry reproduces a phrase from a particular
  recording; each records the basis on which it qualifies as common currency.

- **Ornamentation as a separate pass.** `ornament(notes, …)` adds ghosts, flams,
  drags and slides to material that already exists, in the same position as
  `humanize`, so making one fill easier no longer means generating it again.

- **Randomness primitives.** `deriveSeed` derives every part from one project
  seed; `createPositionalRng` answers by position rather than by call order; and
  `includeAt` makes a complexity dial monotone by construction.

- **A class API over the whole library.** `Chord`, `Key`, `Note`, `Interval` and
  `Progression` covered the things small enough to name; everything larger was a
  shape threaded from one function to the next, so reading a transcription meant
  hand-wiring a chain of calls and carrying the meter, the tempo and the key
  alongside it by hand. Twelve classes join them:

  - `Score` — note events with the meter map, tempo map and key they are read
    against, so which chords, which phrases and where the sections fall are
    methods on the music. Onsets stay absolute and unbounded below, so a pickup
    survives slicing, shifting and quantizing instead of collapsing onto beat 0,
    and tick-valued events are read and written directly, since that is the
    shape a MIDI importer holds before anything else.
  - `Timeline` — the timed counterpart of `Progression`: chord segments that
    keep their onsets, with the key regions found under them and the reductions,
    cadences and Roman numerals read off them.
  - `Composer` — the key, meter, tempo, seed, dials, instruments and vocabulary
    one piece is written under, held once and handed to every generator, so a
    part is one call rather than a call plus a repeated context. Harmonizing a
    melody hands back the melody beside its chords, because harmonizing may move
    the melody into the chords' key and the chords alone would be half an answer.
  - `Arrangement` — the tracks, the analysis of how they fit and the conflicts
    between them; a track comes back as a `Score` and the harmony as a
    `Timeline`, so an arrangement leads into the rest of the class API rather
    than out of it. `update` stays incremental while the class stays immutable:
    the edited session is handed to the new instance, so nothing is re-analyzed.
  - `Voicing` — the pitches sounding together, low to high, with the voicing,
    part-writing, counterpoint and safety functions as its methods. The order
    the caller gave is kept, since an out-of-order voicing is voice crossing and
    the check has to be able to report it.
  - `Rhythm` and `Motif` — an onset pattern with its meter and a motivic cell,
    with the deformations, transformations and similarity readings as methods
    that return one, so material shaped to chain finally does. Both hand back a
    `Score`.
  - `Meter`, `Tempo`, `Duration`, `Instrument` and `Tuning` — over the meter,
    tempo, written-duration, instrument-profile and temperament modules.

  Every class is immutable and follows the conventions the existing five set:
  `data` returns a fresh copy, `toJSON` equals it, `fromData` / `fromJSON` round
  trip, and `equals` compares by value. Each method exposes every option its
  delegate accepts, with the same optionality, so a method cannot quietly offer
  less than the function under it. The functional API is unchanged and remains
  the layer the classes are built on — neither is a wrapper you are expected to
  unwrap.

- **A note, key, chord, meter or instrument may be given in whatever form the
  caller holds it.** `NoteLike`, `KeyLike`, `ChordLike`, `MeterLike` and
  `InstrumentProfileLike` join the existing `IntervalLike`, each accepting a
  name, the plain data, or a value whose `toJSON` returns it, so `'Eb4'`, `60`,
  a `NoteData` and a `Note` are all a note, and `'4/4'`, a `TimeSignature` and a
  `Meter` are all a meter. A class therefore crosses a layer boundary without
  the layer below importing it. `toNoteData`, `toKeyScale`, `toChordData` and
  `toMeterData` are the only places that read text, rather than a parse call
  spread through every entry point that takes one; a number is read as a MIDI
  pitch, spelled the way `midiToNote` spells one, and a name is whatever the
  existing parser already accepts, with no shorthand of its own. Coercion
  happens once at the public boundary, so a search loop does not re-read a name
  per candidate.

- **Further entry points.** `tryParseKeyName` and `tryParseTimeSignature` join
  the non-throwing parsers; `augmentedSixthFromPitchClasses` reads an augmented
  sixth from a pitch-class set and `gridMetricWeight` gives a sixteenth-grid
  step its weight within the bar, which is what decides the events a vocabulary
  figure sheds first when asked for something easier; `KeyData` and
  `ProgressionData` name the
  plain forms, each with a `fromData` beside `fromJSON`; and the chord-scale and
  cadence option types are exported so a caller can name them.

### Fixed

- A method that reads a key first and its options second says so when the
  options arrive on their own. `chord.roman({ applied: true })` and
  `progression.cadences({ alternatives: true })` took the bag for the key and
  failed later against a key field the caller never wrote — `modeMask12 must be
  finite; received undefined` for an object whose only property was
  `alternatives`. The argument is checked where it is given, and the error says
  a `Key` was expected and where the options go. `Chord.roman`,
  `Chord.analyze`, `Progression.roman`, `Progression.analyze` and
  `Progression.cadences` are the five affected.
- `Voicing.independence` no longer forwards its own `key` option to the
  counterpoint function underneath. `key` spells the two lines and means
  nothing below; the delegate discards an unknown property, so this changed no
  answer, but it would have become a real defect the moment that function took
  a `key` of its own.
- `Key.transpose` spells its result the way the key is written, as its
  documentation always claimed: `Key.major('Db').transpose(1)` is D major, not
  Ebb major. A result needing more than seven sharps or flats is respelled to
  its enharmonic key; keys inside that range are untouched, so
  `Key.major('C').transpose(6)` is still F# major.
- `Note.transposeBy` accepts the plain interval data `parseInterval` returns,
  not only an `Interval` instance. It previously threw `TypeError`, which
  contradicted the documented interoperability of the functional and class
  styles.
- `spellScale` gives every tone of a gapped scale its own letter. A hemitonic
  pentatonic has no third for the existing rule to lean on, so the semitone
  above the tonic was spelled as a raised tonic and reused a letter: C miyako-
  bushi read `C C# F G G#` instead of `C Db F G Ab`. Scales that already had one
  letter per tone are unchanged, and a set with more tones than there are
  letters keeps the previous reading.
- `chordTimelineFromNotes` reports its key regions from the same beat the
  analysis starts on when the caller supplies a key. It began at beat 0 while
  the inferring path began at the pickup, so a note before the downbeat fell
  outside every region.
- `keyTimelineFromNotes` reads the notes of a pickup instead of dropping them,
  and weighs each beat in the metre actually in force there.
- `voiceProgression` and the chord-boundary search hold their tables in typed
  arrays rather than allocating an object per cell. Voicing a 200-chord
  progression drops from 13.9 ms to 3.2 ms with scavenging collections down by
  96%, and the boundary search allocates 86% less. The output is unchanged, and
  pinned as such.

## [0.9.5] - 2026-08-05

Additive across the public API — no export was removed and no signature was
narrowed. Several entries change observable output, and arguments that used to
travel into the pitch maths are now rejected where they are given; see
**Changed** before upgrading.

### Added

- A spelled interval carries an optional `descending` flag, so `transposeNote`,
  `transposeByInterval`, and the `Interval` class round-trip a descending span
  back to the letters it came from.
- Additive time signatures parse into their grouping, and a sub-pulse position
  formats as `bar.pulse+fraction`.
- Chord vocabulary: `minMaj9`, `minMaj11`, and `minMaj13`. The Roman-numeral
  parser accepts figured-bass slashes.
- Validation helpers `assertMidiPitch`, `clampToMidi`, `assertDegree`,
  `assertFiniteSemitones`, and `soundingNotesOnly`, plus the `DetectedKeyMatch`
  type.
- `analyzeChord` takes `ChordToRomanOptions` and `detectKeyFromNotes` takes the
  key-detection options, both as a trailing optional argument.
- `README_ja.md`, a Japanese counterpart to the README, ships in the package.

### Changed

- A caller-supplied chord timeline reports 0 confidence instead of 1. It was
  never measured against the notes it was handed, so reporting full confidence
  turned a confidence gate into an unconditional pass.
- A sub-pulse bar position no longer formats as a decimal, which read back as a
  different position.
- A MIDI pitch, a bounded degree, and a finite semitone offset are required at
  the entry points that reach the pitch maths, so an out-of-range argument
  throws where it was passed rather than propagating.
- The note-event index freezes the notes it indexed, so later mutation of the
  caller's array cannot desynchronise it.
- The generation budget threads through key detection.
- The README states the library's actual input and output, names the tools it is
  built for, and draws the scope boundary: no MIDI file reader or writer, no
  audio analysis, no playback. Two headings that implied otherwise were renamed.
- The toolchain is pinned in `mise.toml` (Node 22.23.2, Yarn 4.18.0) rather than
  a `volta` block, and Biome moves to 2.5.6.
- The docs build fails on an undocumented export or an invalid link.

### Fixed

- `isLibcantusError` recognises a library error by its code rather than by
  `instanceof`, so a failure that crossed a realm boundary still matches.
- An unaltered `viio` in a minor key reads as the harmonic-minor leading tone on
  both the parse and the render path.
- Splitting sub-voices pairs simultaneous onsets with the free lanes in register
  order, so a block chord no longer manufactures a voice crossing.
- Spelling prefers the plainer enharmonic letter where a chromatic spelling would
  need a double accidental, and the idiomatic chord scale ranks first.
- A chord's explicit spelling hints move with its transposition, and `spell` and
  `toJSON` derive from an explicit key instead of the carried one.

### Performance

- The note-event index answers from a segment tree over note ends, which one long
  held note no longer defeats.
- Arrangement analysis reuses one sounding-voice snapshot per beat, collapses a
  tension sample to its distinct pitches, and runs the first safety pass without
  the replacement-pitch search, so only a reported conflict pays for it.

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

[1.0.0]: https://github.com/libraz/libcantus/compare/v0.9.5...v1.0.0
[0.9.5]: https://github.com/libraz/libcantus/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/libraz/libcantus/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/libraz/libcantus/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/libraz/libcantus/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/libraz/libcantus/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/libraz/libcantus/releases/tag/v0.9.0
