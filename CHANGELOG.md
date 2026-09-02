# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`assertModeMask` is published.** A mode mask is read with bit operations,
  and those coerce, so a value that is not a mask reads as one and every answer
  taken from it — the form a key stands in, whether its signature is its own,
  which system it belongs to — becomes a musical claim about nothing. The check
  the library now applies at each of those readings is the one a caller can apply
  at its own boundary, next to `assertKeyVariant` and the other validators.

- **`toInstrumentProfile` and `toStringedProfile` are published.** The widening
  coercers of every other kind — `toNoteData`, `toKeyScale`, `toChordData`,
  `toMeterData`, `toVoiceNotes` — were already exported, and the instrument pair
  was not, so a caller holding an `Instrument`, a stored profile or a built-in
  such as `BASS_4_STRING` could hand it to an entry point but could not perform
  that same widening themselves. Both now come from the package root and from
  the `core` subpath: an instrument-shaped value can be resolved to a plain
  profile, or narrowed to the stringed family with the neck-or-nothing refusal a
  bass line needs, at a caller's own boundary rather than only inside the
  library.

- **`chordToRoman` names an augmented sixth applied to a degree.** `Ger6/V`,
  `Fr6/V` and `It6/V` parsed into the German, French and Italian sixths of the
  dominant, but reading one of those chords back gave `V7/VI` or `bIII7`, the
  numerals its pitch classes take against the home key. Under `applied` the
  render direction now tries the degrees the key can tonicize as local keys —
  the same local key the numeral is parsed in — so an augmented sixth of any
  tonicizable degree comes back as the numeral that built it, and an analysis
  can say which degree a chromatic predominant is aimed at instead of naming a
  dominant seventh a fifth away from it. The reading is taken only from a chord
  carrying its own tone spellings, since the French sixth is the one kind a bare
  stack of thirds spells by accident; a caller holding pitch classes alone gets
  those letters from `augmentedSixthFromPitchClasses`.

- **A checked instrument profile is a type of its own.** `toInstrumentProfile`
  and `toStringedProfile` return a `ValidatedProfile` — the same object, marked
  by the type system as having been read against the domain every field
  declares. Nothing is added to the value, so it serializes exactly as the
  profile it was made from; what the mark buys is that the routines reading a
  profile note by note take only a profile that has been through the checks, so
  a path that skips them does not compile rather than failing on the one passage
  that would have exposed it.

### Changed

- **The passes that read a piece read it once.** Four analyses asked a question
  of the whole input once per unit of that same input, so the cost grew with the
  square of the piece and a request the budget accepted could take half a minute
  on scans whose answer never changed. `detectModulations` now merges its
  shortest key areas from a heap with running score totals rather than
  regrouping the whole search per merge, reads each region's confidence from the
  chords it was grouped from, and finds each modulation's pivot through one
  table of the chords in the order they finish. `extractMotifs` indexes the
  motifs it has kept by the note each of their statements starts on, so a
  candidate is weighed only against the ones that could hold it. `spellLine` and
  every other reading of a scale no diatonic mode holds — a pentatonic, the
  blues scale, the octatonic sets — works that scale's letters out once instead
  of once per tone asked about. `Score.playability` holds the tempo map for the
  length of its pass instead of handing it back to a conversion per note, and
  the conversions themselves place a beat by binary search over the map rather
  than by walking it. Every answer is unchanged.

- **A score reads its own harmony and its own keys once.** `Score.timeline()`
  and `Score.keys()` asked with no options are the score's own question, and
  both re-ran the analysis every time they were asked — so the documented order,
  timeline then phrases then keys then key, inferred the harmony twice and
  searched for the keys twice over readings the class was already keeping. Both
  now read what the score keeps; asked with options they name a different
  question, which is answered afresh and does not become the kept answer. The
  regions handed out are copies, so what a caller does with them cannot reach
  what the score reads next.

- **Two readings of a scale's tones are one walk of its mask.**
  `diatonicPitchClasses` is the degree-ordered reading sorted, rather than a
  second copy of the same loop: the two agreed, and would have drifted the
  moment either was corrected without anything reporting the difference.

- **The documentation of what the library answers with says what it answers.**
  `VoicingData` and everything that hands out a voicing said the pitches were
  ascending; the class keeps the order the voicing was built in, which is what
  makes a voice crossing survive to be reported, so a caller taking the lowest
  sounding voice takes the minimum rather than the first entry.
  `ProgressionPreset.degrees` documented a degree space starting at zero, where
  the implementation counts from one as a musician does. `LickNote.lengthSteps`
  documented a default of one sixteenth, where a note with no length sounds to
  the next onset. `wrongRhythmicRatio` is described as the rhythm not reading
  against the cantus firmus at all, which is what it reports. And the analysis
  guide no longer says a note-level reading and the harmonizer's name a note the
  same way in every case: the two share their vocabulary and read different
  evidence, so neither answer is a subset of the other.

- **The documentation of two options says what the code does.**
  `ArrangementOptions.harmonicRhythm` was described as a chord-slot length,
  where the arrangement analysis always infers its harmony with dynamic
  segmentation and reads the value as a prior — a chord may still begin wherever
  the notes argue for one, and `timeline` is how boundaries are fixed.
  `VoicingOptions.previousChord` was described as enabling the resolution of a
  chordal seventh; it enables every rule read from the chord being left — that
  resolution, a leading tone's resolution, and the cross relation between the
  two chords — none of which is scored without it, since a voicing does not say
  what it was written on.

- **An instrument is checked by the functions, not by the class over them.** The
  instrument profile every entry point takes is now read whole where it enters:
  the technique list, the polyphony, the fret span, the limbs and the reach
  table are held to the domains they declare, so a profile out of a project file
  missing its `maxStretch` is refused by name instead of reporting a chord no
  hand can hold as playable — a missing span made every comparison against it
  false. `canSound`, `instrumentRange`, `fingeringsFor`, `foldIntoRange` and
  `playability` take an instrument in any form the caller holds it, a kit handed
  to the neck-only pair is refused as a kit rather than as a missing `tuning`,
  and each of them requires a MIDI pitch where it documents one. The class layer
  no longer states a second reading of the same rules, so an `Instrument` and
  the function it delegates to cannot come to disagree about a profile.

- **`playability` reads the instrument once per call.** Both note-by-note stages
  re-validated the whole profile for every note, and a kit walked its reach
  table and allocated a list per stroke — so checking a drum track cost the note
  count times the kit, on the thread a UI is waiting on. The profile is read at
  the entrance and the kit's limbs and overdubs are read out of it once; the
  report is unchanged.

- **`voiceChordStyled` takes a chord in whatever form the caller holds it.** Its
  three siblings in the module — `voiceChord`, `voiceProgression`,
  `nextVoicing` — and the class over it all took a chord symbol, and this one
  took resolved chord data alone, so the obvious `voiceChordStyled('Dm7', {
  style: 'drop2' })` did not compile and, from JavaScript, reached the pitch
  reader as an error naming a pitch rather than the chord argument.

- **`transposeByInterval` takes its note and its interval in any form.** The
  class mirror of the same operation already coerced both, so following the
  interoperability guide with `transposeByInterval('C4', 'A2')` failed at the
  one entry point in that family that read spelled data only. The remaining
  spelling primitives in `core` — `formatNote`, `formatKeyName`,
  `transposeNote`, `spelledInterval` — take the data the coercers produce, and
  the guide now says so rather than promising every form everywhere.

- **A tension sample writes its texture down once.** `sampleTension` rebuilt the
  whole list of sounding voices for each distinct pitch it evaluated, so a
  sixty-voice pad spent thousands of short-lived objects on a single beat to
  state the same texture over and over. The list is built once per sample and
  the candidate's own occurrence lifted out of it; every tension reading is
  identical.

- **An entry point whose answer depends on a key's spelling no longer takes a
  key that has none.** `figuredBassOf`, `romanToChord`, `spellVoicing`,
  `spellLine`, `substituteChord`, `modalInterchangePalette`,
  `negativeHarmonyMirror`, `augmentedSixthChord`,
  `augmentedSixthFromPitchClasses` and `relateMotifs` — with `Motif.relateTo`
  beside them — declare `SpelledKeyLike`, which is `KeyLike` minus the bare
  `KeyScale`. An A flat minor and a G sharp minor are one set of pitch classes
  and two keys, so handing one of these a key reduced to pitch classes cannot be
  answered correctly; it is now refused where it is written rather than answered
  from whichever side of the circle those pitch classes read best as. Reducing a
  key deliberately is still `toKeyScale`, and spelling one back is `resolveKey`.

- **The key builders carry the spelling they are conventionally written in.**
  `majorKey`, `minorKey` and `scaleByName` return the scale with the tonic and
  the scale form written beside it, so `majorKey(6)` is
  `{ rootPc: 6, modeMask12: 2741, tonic: { letter: 4, alter: -1 }, variant: 'major' }`
  rather than the first two fields alone. The spelling is the one the resolver
  already derived for those pitch classes, so no answer moves; what changes is
  that a built key satisfies the entry points above, and only a key that has
  been reduced does not. A reader that wants the pitch classes alone takes the
  result unchanged, or narrows it with `toKeyScale`.

- **The guides open with a primer for a reader who has never studied music.**
  `docs/en/primer/` and its Japanese mirror teach the ideas the rest of the
  guides assume — pitch and intervals, scales and keys, chords, harmony, voices,
  rhythm and meter — and name the API each idea decides, so a page can say
  "spelled note" or "leading tone" and point at where the term is explained
  rather than at nothing. Sixteen diagrams under `docs/images/`, in an English
  and a Japanese cut, carry the parts that are shorter to draw than to describe:
  the layers, the path from note events to parts, the note event itself, pitch
  class against spelling, intervals, scale degrees and modes, chord
  construction, numerals and function, cadences, voice leading, the metric grid,
  timeline segmentation, key detection, key relations, the generation context,
  and reharmonization. The README keeps the overview, the worked-guide index and
  the boundaries of the library, and leaves the layer-by-layer detail to the
  guides.

- **Guide statements that described behaviour the library does not have are
  corrected.** The ones that would have produced a wrong call: `resolveMeters`
  takes the options object an entry point was given, not a signature, and reads
  its `ts` or `meters` field, so passing a signature straight in silently
  analyses in 4/4; a chord timeline's `at` is a function, so an analysis crosses
  a worker boundary as `timeline.segments` rather than whole; `clampToMidi`
  requires a whole number before it clamps; `Instrument.soundingPitch` resolves
  only the two guitar profiles and raises for the basses and the kit; a tritone
  substitute is spelled a semitone above the chord its dominant resolves to,
  which is the key tonic only when the dominant is the key's own; the
  harmonizer's transposition search is off unless `placement` asks for it; a
  cadence is graded `imperfect` from the chords alone when a leading-tone chord
  stands in for the dominant or either chord is inverted, and only the remaining
  case waits on a voicing; and `hiddenPerfect` is judged on the outer voices in
  a chorale and at two-voice strictness in a species exercise. Shipped
  behaviour that no guide mentioned — `Timeline.modulations`, `analyzePolyphony`,
  the public instrument coercers, `DetectKeyOptions.explain`, the composer's
  recorded seed and algorithm version, and the whole-number rule on `pitch` and
  `velocity` — is documented where it belongs.

- **What the algorithm version promises is stated accurately.** The
  documentation said a version already accepted keeps returning what it
  returned. The generators hold one implementation rather than one per version —
  the number is drawn into the seed — so pinning an older number selects a
  different draw of the current implementation and does not restore what that
  number produced before. A correction to musically wrong output therefore moves
  the notes of a version in use, ships as a patch, and is recorded here.

### Fixed

- **An options argument written `null` is refused rather than read as absent.**
  A parameter declared `opts: Options = {}` is filled in by that default only
  when the argument is missing, so an explicit `null` — which is what a host
  passes on when it has no options to give, and what a session restored without
  an options object holds — defeated the default and reached the first field
  read as itself. Across the library that surfaced as a raw `TypeError` naming a
  field the caller had never heard of; where the fields were read through
  optional chaining instead, it silently selected every default. Both are gone:
  the options an entrance takes are read in one place, absent still means the
  defaults, and anything else is refused by name. A meter, a generation context
  and a spelling context written `null` are refused on the same terms, and so
  are a tempo, a difficulty ceiling and a two-voice flag — the last of which
  used to flip a default of `true` to `false` without saying so.

- **An entry point no longer answers from a value it never read.** Refusing
  malformed input is one half of the contract; the other is that an entrance
  which does not throw answered from what it was given. JavaScript coerces on
  the way into arithmetic, so a `null` interval measured as a unison — a perfect
  consonance, which is what the parallel-motion rules act on — a key with no mask
  reported as modal and as supporting functional harmony, a metric weight off the
  stated scale answered as the off-pulse rank, a spelled interval with neither
  number nor quality classified as a dissonance, a difficulty ceiling of 20
  judged as the strictest one there is, and a progression style that is no style
  selecting nothing, all read as ordinary answers. Fourteen such readings are now
  refused, most of them through one shared reading of a mode mask that four
  places had been making separately. The domains are also swept, derived from the
  declared parameter types: what does not belong in a parameter follows from what
  the parameter says it takes, so no table of valid arguments is needed and an
  entrance is swept under its own signature.

- **An entry point taking more than one argument refuses malformed input as this
  library's own error.** The single-argument entrances already did: anything a
  caller passes comes back as one of the library's error classes, and a raw
  `TypeError` means a bug inside the library rather than a constraint the caller
  broke — a distinction a host branches on. Twenty-six entrances taking two or
  more arguments read their material before checking its shape, so a `null`
  figure, a dictionary that was not an array, a motif restored from a session
  without its notes, or a sampler set missing a method surfaced as a `TypeError`
  naming a field instead of the argument. Each of them now goes through the same
  shared checks the rest of the library uses, and the contract is swept over
  every published function rather than only the ones taking a single argument.

- **A slash bass is written on the letter the degree it plays gives.** Writing a
  chord read on one side of the enharmonic fence out on the other carried the
  bass by the same step the root moved, and kept whatever that landed on for any
  bass whose pitch class the chord contains — so a `C#/F` asked for on the flat
  side came out `Db/Gbb`, a G a chart never writes under a chord whose third is
  an F. The carried spelling is kept only where it is the one the chord itself
  gives that tone, which is what makes the D double sharp of a `G#aug` right and
  the G double flat wrong; anything else falls back to the plain name of the
  pitch class.

- **Every published example is compared against the value it prints.** The form
  these examples take is `// value — why`, and only the ones that spent their
  whole comment on the value were checked: sixty-odd printed answers ran without
  anything comparing them, among them the augmented-sixth spellings, the avoid
  notes, the figured-bass numerals and the voicing costs. All of them are
  checked now, which corrected one example that printed an abbreviation of what
  the call returns and two that printed a value in a form no assertion can read.

- **A fill and a section crash are written on the grid the bar is swung on.**
  Under `feel: 'shuffle'` or `'swing'` the strokes of a fill, and the crash that
  lifts into the next section, were placed straight while the kick, the hats and
  the ghosts around them went through the section's swung grid — two voices a
  sixteenth's swing apart inside one bar, which is heard as a flam at the one
  place a phrase ends. Both now go through the same grid as everything else in
  the bar, and the recorded grooves move with them.

- **The ghosts lead into the backbeat the groove actually plays.** They were
  written on the sixteenths of beats 1 and 3 whatever the groove was, so a style
  whose backbeat is on the third beat — which is how trap writes one — had them
  anticipating a beat with no snare on it and landing again on top of the
  backbeat itself, and the amplification that belongs to the beat leading in
  fell with them. The beats are read from the groove's own backbeat now, as the
  tambourine and the hand-claps beside them already were.

- **A borrowed diminished triad costs what an unstable sonority costs.** Chords
  borrowed from the parallel mode were priced at one flat rate, so the ii
  diminished borrowed into a major key came out cheaper than that key's own vii
  diminished — and which of the two a phrase took was settled by the seed's
  tie-break rather than by the melody. Every diminished and augmented triad is
  now charged for what it is, whichever tier of the vocabulary offered it.

- **A key region shorter than the minimum is left only where the span ends.**
  The first slot of the key search begins a whole slot before the music
  wherever the first onset is not on a slot boundary, and the reported start is
  clipped to where the music starts — so an excerpt whose first note is a beat
  into the bar came back with a key band three beats wide in front of it, which
  the documented minimum says is only ever left at the end of the analysed span.
  Such a head is folded into the region after it, which then covers those slots
  and is read from them.

- **A note that weighs nothing is not the bass of the window it sounds in.** A
  velocity of zero is a note event this library accepts — a note-off written as
  one, a muted ghost layer — and it contributes nothing to the histogram. Taken
  as the window's lowest note all the same, it named a pitch class the histogram
  had never counted, so the reading found no bass among the pitches it selected
  and dropped the inversion, the slash bass and the augmented-sixth accounting
  with it.

- **A phrase boundary stands on evidence.** A hypermeter read with no confidence
  registers its downbeats at strength zero, and the phrase search weighs a cut
  by the two lengths it makes as well as by the evidence — so over a pedal point
  or a drone, where nothing argues anywhere, the length term alone put
  boundaries into the reading, reported with a confidence a caller cannot tell
  from an evidenced one. Such a stop is no longer a candidate. Separately, a
  phrase that drops a cadence as having arrived before it began drops it from
  its signals too: the reading used to say `closing on no cadence; boundary from
  cadence`, which states both halves of one fact and contradicts itself.

- **A melody that sounds before the first downbeat is harmonized to where it
  ends.** `harmonizeMelody` measured its grid from beat 0, so a melody written
  entirely in the pickup — an upbeat lifted out of a chart, which the note-event
  contract accepts outright — grew chord segments past its own last note and put
  the cadence at the end of the melody on a segment the melody never reaches.
  The grid is now accumulated from the melody alone.

- **A crossing is reported once per note, not once per measure it sounds in.**
  In the fifth species a note held across the bar line is judged in both
  measures, which is what the species is about; but every field of a
  `voiceCrossing` record comes from the note's own index, so a note on the wrong
  side of the cantus firmus in both measures came back as two records nothing
  could tell apart — one error marked twice, and subtracted twice from a score
  counted by violations. The vertical interval a held note forms in the measure
  it is carried into is still judged there.

- **A leap wider than an octave is named in the rationale that reports it.** The
  rationale is the only channel that distinguishes the melodic-shape rules from
  one another, and past the octave the interval fell back to the bare noun:
  `The leap of a interval is not answered by a step the other way`, which names
  no interval and is not a sentence. Compound numbers are named — a ninth, a
  tenth — and anything past those is written as the number itself, as the
  sibling rule that reports an illegal leap already did.

- **A bass figure declares the techniques its own notes call for.** Three
  entries named a technique they never use — a slide in two figures whose notes
  slide nowhere, a mute in a figure with no muted note. The declaration is what
  a caller's instrument is matched against, so an upright or a synth bass
  profile without that technique lost whole genres to figures that never needed
  it. A test now derives the set from each figure's own notes, so a declaration
  and the material it stands for cannot come apart.

- **A bass figure over a slash chord stays above the bass it names.** The
  chord's other tones were folded into the register band, which is one octave
  wide, so every tone of a `C/E` but the E itself came out under it — a
  root-position C written where the chart says first inversion, and read back by
  this library's own analysis as a different chord. Over a chord that names a
  bass, the tones are now placed above that bass instead, on both the styled
  generator and the genre figures. The walking style's approach into the next
  chord and the pop pickup's deliberate octave below are unchanged, since
  neither is a tone of the chord standing over its own bass.

- **A genre figure leads into a chord change from its own last note.** The
  connecting tone before a chord change was fixed to the head of the beat, so in
  seven of the nine genres the note that actually entered the next chord was the
  figure's real final onset a sixteenth or two later — left on whatever degree
  its template carried, and related to the next chord by nothing. That final
  onset is now the one the connecting tone takes over, read from the figure
  itself so that the position does not travel with the density dial; where the
  figure sounds nothing in that beat, the tone is still written on the beat. The
  recorded output of `placeLicks` moves accordingly.

- **`Timeline.roman()` numbers a chord in the key as the key is written.** The
  fallback that reads each segment in the key in force reduced that key to its
  pitch classes, so a chord whose numeral depends on how the key is spelled came
  back named for the enharmonic twin: under an Ab minor region a German sixth —
  `Fb Ab Cb D`, and named from those letters — was numbered as a dominant
  seventh a fifth away, while `Timeline.at(beat)?.roman()` on the very same
  segment answered `Ger6`. The regions carry the spelled tonic and the scale
  form already; the numerals now read them as they stand, and the reduction and
  the cadence search, which are read from which notes are in the key rather than
  from how it is written, state the drop themselves.

- **`enharmonicKeyOf` answers for a tonic that does not spell the root it is
  given.** A key with a signature of its own re-read the root and answered; a
  scale that only borrows one — a pentatonic, the blues scale, an octatonic set
  — threw about spelling a root the tonic never sounded, so the same call
  succeeded or failed on the scale family alone, and the failure was not among
  the ones the function documents. Both families now read the scale as the tonic
  in hand roots it, which is what the signature side was already doing.

- **A public entrance refuses malformed input as an error of this library.** The
  documented contract is that anything a caller passes in comes back as one of
  the library's own error classes, and that a raw `TypeError` means a bug inside
  the library — a distinction a host branches on. Forty-one published functions
  read a field off whatever they were given instead: a `null` restored from a
  project file, a hole in an array, or a mistyped argument surfaced as this
  library's `TypeError` from wherever the first field access happened to be.
  Every entry point taking a single argument now names what it was given and
  refuses it, and a sweep derived from the package's own exports holds the whole
  surface to that contract rather than a list of the entrances someone
  remembered.

- **A tempo map and a note value name the element that is not one.** A `null`
  where a tempo event or a nested tuplet belongs came back as a raw `TypeError`
  naming neither the element nor its index, while the meter map and the note
  events beside them had always refused the same shape by name.

- **`assertVocabulary` refuses an entry missing a required list.** The
  `articulations` of a dictionary entry were walked before anything checked they
  were there, so an entry from a JavaScript caller or a config file without them
  failed as a raw `TypeError` while every neighbouring field was refused by
  name. The optional lists and the tempo band are read the same way now.

- **A drum figure naming a voice the kit has not got is refused.** A plausible
  but unused name — `'hihat'` — was dropped stroke by stroke, so a caller's
  figure was admitted and then played nothing; an inherited name such as
  `'constructor'` indexed the note table to a function, which reached the
  emitted hit where its pitch belongs. A supplied dictionary is read for its
  voices when the generator takes it, whether or not the draw reaches that
  entry, and the note number is looked up only among the table's own names.

- **`analyzeArrangement` and `tensionCurve` check the timeline and the key
  regions they are handed.** Every other field of the arrangement options was
  read for its shape at the entrance; a timeline missing its `at` and a region
  missing its `key` went through untouched and became a raw `TypeError` several
  layers in. The class API refused both already, so one input had two behaviours
  depending on which surface it arrived at.

- **A melody in a scale of other than seven tones can be harmonized.**
  `harmonizeMelody` and `generateProgression` threw for a pentatonic or a blues
  scale — keys `Key` treats as first class and pops writes tunes in — because
  the chord over a degree was stacked in the scale itself, which has no
  degree-for-degree frame when it does not hold seven tones. Both now read
  degrees in the key's heptatonic frame, the frame the numerals and the
  tonicization targets were already measured in, so a five-tone melody is
  harmonized with the triads of the major it lives in. The secondary dominants
  take each target's root from the target itself rather than by re-indexing a
  differently sized list of tones with a degree number that was never measured
  against it.

- **A budget that passes stands for the table the search fills.** The key search
  was charged for its slots and then built a row of twenty-four candidate keys
  per slot, so `keyTimelineFromNotes`, `detectModulations` and every analysis
  reaching them through a chord timeline accepted a span and then allocated
  twenty-four times what it had been measured at. Both entry points are charged
  for the table now, and the tables themselves are allocated through one helper
  that charges what it hands out — a search that cannot obtain a table without
  being charged for it cannot obtain one uncharged. A span whose candidate rows
  outweigh the budget is refused rather than accepted and then run; the chord
  timeline also asks its own budget before the key search rather than after it,
  so an oversized request is refused before the passes it pays for begin.

- **A tempo map is bounded, and read once.** `beatsToSeconds` and its siblings
  re-validated the whole map on every conversion asked of them and walked it
  from the origin to the beat in question, so timing a piece against a recorded
  accelerando — a tempo event per tick, which is what a MIDI import gives — cost
  the note count times the map. A map may now declare at most a hundred thousand
  changes, the same bound the meter map takes, and a map already validated and
  unchanged since is recognised rather than validated again.

- **`extractMotifs` is bounded by the fragments it compares, not only by the
  windows it enumerates.** The pass that drops a cell already stated inside a
  longer motif was charged for nothing, so a melody repetitive enough to keep
  tens of thousands of motifs ran for seconds after passing every check. Those
  comparisons are charged as they are spent, and a melody that would run far
  past what it was measured at is refused.

- **A key region's confidence is read from the chords the region holds.** Where
  the chord segments given to `detectModulations` overlap each other — a chord
  timeline's do not, but a caller may build a list whose spans do — a chord
  held past the segment after it argued for both regions' keys. Each segment is
  one slot of the search, so it argues for the region its own slot falls in.

- **A bar is as long as the bar is, not as long as its signature says.**
  `beatsPerBarAt` returned the nominal length of the signature in force. A
  change of meter starts a new bar, so a bar interrupted by one is shorter than
  its own signature — and the reading put that bar's end past where the next one
  begins. Every span the form and key analyses measure in bars was counted
  against a bar the music never had, so a phrase over a meter change came back
  short. Separately, the phrase reader measured its hyperbar from bar 0 of the
  meter map, which is always the bar beginning at beat 0: an excerpt starting
  after a change was handed the bar length of a meter it never sounds in, as the
  expected phrase length every phrase in it was then fitted against. Both now
  measure from the bar in question.

- **`placeDrumPattern` swings the bar it is writing.** The swing was applied to
  the absolute position, which takes the offset inside a quarter note — the same
  thing as the offset inside the bar only while a bar is a whole number of them.
  Following the documented path of supplying a vocabulary in another meter, a
  7/8 bar had its downbeat warped and its offbeats left straight, alternating
  bar by bar with nothing to report it. 4/4 and 3/4 are unchanged.

- **One tolerance compares the beat axis.** The adjacency module was written to
  hold both beat-axis tolerances — the exact one a beat boundary is compared
  with, and the wider one a played onset is read with — and fourteen other
  modules still declared their own copy of one or the other. All the values
  agreed, so nothing was wrong today; what was wrong is that a correction to any
  one of them would have left the rest behind with no failure anywhere. The
  number is declared once in the meter layer, which sits below every reader of
  the axis, and a guard now refuses a new declaration of either value outside
  the two modules that own them.

- **A dominant is read from the tones it sounds, at both ends of a cadence.**
  The sonority test asked for the quality name `maj`, and a triad that grows a
  colour tone is named something else — `add9`, `6`, `6/9` — so `Vadd9` and `V6`,
  which is how pop writes the dominant, stopped being a dominant sonority the
  moment the tone was added. The applied reading, the part-writing exemption for
  a cross relation and the printed rationale all went with them. The Neapolitan
  and the leading-tone chord asked the same question by name and now ask it the
  same way. Separately, the arrival side of a cadence asked only for a major
  third: the `V7sus4` of gospel, pop and modal jazz was refused there while the
  cadential six-four reader in the same file accepted it, so a half cadence came
  back reporting that its arrival sounded no third the key rests on — about a
  chord the same file had just called the dominant. Both ends now ask one
  predicate, and the relaxation a mode without its own leading tone needs is
  unchanged.

- **A rejected applied-dominant reading is one the chord could have had.**
  `analyzeChord(..., { alternatives: true })` reported the subdominant and the
  dominant of a major key as applied dominants it had turned down, and gave
  being diatonic as the reason. Neither points at a degree the key can tonicize,
  so neither was ever a rival; the tonic triad, which points at the subdominant,
  still is one. The reading a caller is told was rejected is now gated on the
  same test the accepting side applies, so inverting the reason given is what
  would make the analysis take it.

- **`avoidNotes` names the third a `sus2` suspends away from.** The displaced
  third was computed as a semitone below the suspended tone, which is the major
  third only for a `sus4`; over a `sus2` it named the root's own flat ninth — a
  pitch class no major scale carries — so nothing was avoided and the third came
  back as a free colour, `Chord.parse('Csus2').tensions('ionian')` offering the
  E that ends the suspension. Both thirds a suspension stands in for are now
  named, since a suspension does not say which one it displaced. What stands in
  a chord's third slot is read in one place now, which is where the discrepancy
  came from: three readers had their own, and the loosest of them answered a
  suspension by whichever of the fourth and the second happened to sound.

- **A slash bass the chord's template does not contain is classified.**
  `analyzeVoice` counted the sounding bass as a chord member and then found no
  role for it, and every later branch was closed to a member, so the note came
  back with an empty label list and the rationale `Unclassified note` — a B flat
  under a `C/Bb`, and every note over such a chord in `Score.voices()`,
  `analyzePolyphony` and `analyzeArrangement`. It is read against the chord as
  it sounds, so that B flat is the seventh that sonority has.

- **A figure asks the chord for a degree the chord states.** The bass module
  read "which degree is this interval" from the interval class alone, folding
  six, seven and eight onto the fifth, so a chord's own sharp eleventh and flat
  thirteenth were not degrees it stated. The reading now lives with the chord's
  role query, which is the one that already distinguishes them, and the bass
  module's separate reading of a chord's fifth goes with it.

- **A `pop` bass pickup is a note the line does not already have.** The octave
  pickup dropped the root an octave below its register band, but the band is one
  octave wide, so on an instrument with nothing under it the drop folded
  straight back onto the root and the pickup sounded as a repeated note. On a
  four-string bass that is every line in C, C sharp, D and E flat — most of the
  keys pop is written in — including the `{ style: 'pop', instrument:
  Instrument.bass4() }` the documentation gives as its example. The figure now
  takes the octave above where the octave below cannot be heard, which is what a
  player without the low string does. Two things in the same figure move with
  it: the difficulty ceiling is measured against the leap the pickup actually
  is, rather than a flat twelve semitones that ignored where the previous note
  sat, and a pickup now counts as a note the segment emitted, so a segment
  covering only weak beats no longer writes the fallback root on top of the
  pickup and drops the pickup.

- **`applyGrooveTemplate` checks the fields that decide where a note lands.**
  `slotsPerBar` is what the per-bar grid is read through, and nothing held it to
  the bar it would be read against: a hand-built template declaring eight slots
  at a sixteenth-note subdivision passed every check the function made and then
  quantized a note past the end of its grid, where the wrap moved it a bar and a
  half late. It is now held to the slot count the apply-time meter holds at the
  template's subdivision — the definition the field is documented with — and a
  slot carrying a non-finite timing offset or a velocity outside the MIDI byte
  is refused before either is written onto a returned note, so what the function
  hands back is a note event the rest of the library will read.

- **An analysis kept for undo cannot be rewritten by the next edit.** A span an
  edit does not touch keeps the chord the previous analysis read, so one object
  reaches both the analysis before the edit and the one after it. A host that
  wrote to the current timeline — renaming a root for display — was rewriting
  the state it was holding in order to go back. The chords a window reads are
  frozen where they are made, so neither analysis hands out anything writable;
  the class layer, which rebuilt each segment on read, was already safe and
  reported the same chords the function layer let through.

- **`Motif.totalBeats` answers for a cell of any size the constructor takes.**
  It spread the cell into `Math.min` and `Math.max`, which fails with a native
  `RangeError` far below the generation budget the constructor accepts — a
  phrase lifted out of an imported track with `Motif.fromNotes(score.notes)`
  reached it. It now measures the cell through the same walk the motif
  transforms use, so one function answers for both layers.

- **`placeLicks` and `analyzePolyphony` charge the work they do.** `placeLicks`
  counted segments while laying one figure per bar of each, so a single segment
  running to a beat taken from a loop length or a project file tiled the whole
  span before anything bounded it; it now charges the bars the placement covers,
  the estimate the phrase-shape styles already make before reaching the same
  tiling. `analyzePolyphony` reads every note against the sub-voices sounding
  under it and charged neither dimension; it now charges that product before
  filling the sounding cache, as the two sibling entry points over the same
  machinery do.

- **`@libraz/libcantus/theory` and `/model` bind the errors they declare.**
  Both subpaths re-exported `InvalidInputError`, `NoSolutionError` and
  `BudgetExceededError` — and `theory` also `ConsonanceClass` — as types, so the
  shipped declaration said the name was there and the module never bound it.
  Importing one the way the guides do compiled, then failed at link time in ESM
  with the whole barrel behind it, and read as `undefined` in CommonJS, which
  surfaced as `not a constructor` inside a catch block. They are value exports
  now, and the packed-consumer matrix constructs each one and catches through it
  rather than only naming it.

- **`negativeHarmonyMirror` mirrors a chord that carries a bass.** The mirrored
  bass was placed an octave below the mirrored tones so detection would read it
  as the lowest note, but those tones are pitch classes and there is no octave
  below them: every chord with a bass reached the pitch check as a negative
  number and was refused. `Chord.parse('C/E').negativeHarmony('C major')` threw
  where it now answers `Cm/Eb`, and with it every inversion, every slash chord
  and every descending bass line a reharmonization is asked about.

- **A church mode has the same second spelling from either side.**
  `enharmonicKeyOf` filtered candidate tonics through a window drawn from where
  the major and minor keys put one, so the ends of the other modes fell outside
  it: `Key.named('lydian', 'E').enharmonic()` answered with nothing while
  `Key.named('lydian', 'Fb').enharmonic()` answered with `E lydian`, and the
  relation documented to be its own inverse ran one way only. The window is now
  the reader's own range and the signature decides what is written, which is
  what the doc said all along. Scales that borrow a signature rather than
  holding one keep the previous window, because the reading they are judged by —
  no double accidental — is not symmetric between two spellings of one sound.

- **A key names the same written spelling through the class as through the
  functions.** `Key.transpose`, `Key.keyOnDegree`, `Key.keyHavingTonicAsDegree`
  and `Key.forInstrument` all end on the question of whether a key is written on
  the tonic they arrived at, and the class answered it with a second copy of the
  predicate under a private name. The two disagreed at the ends of the church
  modes: `Key.parse('D# phrygian').forInstrument('clarinetBb')` gave an
  `E# phrygian` where the theory layer writes `F`. The class asks the theory
  layer now, and the constants that decide what "written" means are declared
  once and reserved to the module that owns the question.

- **`Progression.cadences` takes an approach chord in every form.** It declared
  the class shape where the option it mirrors declares `ChordLike`, and read a
  field off it: a chord symbol was a type error, and from plain JavaScript it
  went through as `undefined`, so the pair was graded with no predecessor and
  the cadential six-four before it went unseen — while the same value handed to
  the sibling `analyze` worked.

- **A slash bass is written the way a chart writes one.** Respelling a symbol
  carries the bass by the step its root moved, which is what keeps a bass that
  belongs to the chord inside it — but the step was taken without asking whether
  it landed on a name anybody writes, so `formatChordSymbol` answered `Db7/Ebb`
  for a `C#7/D` asked for on the flat side and `C#7/D##` for a `Db7/E` asked for
  on the sharp side. The step is still taken and the answer is now held to the
  written vocabulary, which is the check transposing the same symbol already
  applied and which both now read from one place. A bass that is one of the
  chord's own tones keeps the chord's spelling whatever it is: the augmented
  fifth of a G sharp is a D double sharp, and writing that inversion over an E
  would name a note the chord does not hold.

- **The model layer resolves a meter argument in one place.** `Score`, `Composer`
  and `Arrangement` each held a private `metersFrom`, all three equivalent to
  the `resolveMeters` they already imported and each a place a later edit could
  make one class wrap, default or copy a meter differently from its siblings.
  The three copies are gone and the classes call the shared function; a meter
  argument resolves identically whichever class takes it, and a check reads the
  model tree so a fourth copy cannot be added quietly.

- **A chord timeline spells its augmented sixths in the key it was given.**
  `chordTimelineFromNotes` identified the augmented sixth of a window from the
  key reduced to pitch classes, so a German sixth analysed under `'Ab minor'`
  came back written `E G# B C##` — the sharps of the G# minor those pitch
  classes read best as — however plainly the caller had named the key. The
  ordinary tertian reading of the same window was spelled correctly, which is
  why the two disagreed only where an augmented sixth was read. The window is
  handed the key whole now; its pitch classes still decide which chord the notes
  are read as, and nothing that spells is answered from them.

- **A reharmonization is spelled in the key it was handed.**
  `modalInterchangePalette`, `substituteChord` and `negativeHarmonyMirror` —
  along with `Chord.modalInterchange`, `Chord.substitutions` and
  `Chord.negativeHarmony`, which passed them a bare scale even while holding a
  resolved key — re-derived a tonic from pitch classes, so
  `modalInterchangePalette('Ab minor')` returned `G# A#m B#m C# E#m A`, a
  substitution proposed for `Eb7` in that key came back as `F##dim`, and the
  mirror of an Eb major triad there was `C#m`. All six read the key through one
  resolver now, and the second derivation of a written tonic is gone.
  `HarmonizeResult.key` is a `ResolvedKey` for the same reason: it was a
  key/scale, so
  `harmonizeMelody({ melody, key: 'Ab minor' }).key` respelled as G# minor in the
  caller's next step, and under `key: 'infer'` — where it is the only account of
  which key was chosen — it could not say how that key is written.

- **A chromatic chord named as a whole symbol is built from the key's own
  tonic.** `romanToChord('Ger6', 'Ab minor')` returned `E G# B C##` while
  `augmentedSixthChord('german', 'Ab minor')` and
  `Key.parse('Ab minor').augmentedSixth('german')` already returned
  `Fb Ab Cb D`, so a harmony exercise built from numerals received a double-sharp
  augmented sixth in a key of seven flats. `Fr6`, `It6` and `N6` were spelled the
  same way, and `chordToRoman` read the correctly spelled German sixth back as
  `VI7`. Both directions now carry the whole key. The local key an applied
  numeral is read in is spelled from the prevailing key too, so `Ger6/V` in
  Ab minor is built on `Eb` rather than on the `D#` its bare pitch class reads as.

- **`resolveKey` refuses a key that contradicts itself.** A tonic naming a pitch
  class its scale is not rooted on passed straight through, so
  `augmentedSixthChord` returned a chord whose tone spellings read `Db F Ab B`
  while `formatChordSymbol` drew it as `G#7` — one chord answering to two names,
  with nothing to tell a caller. A `variant` its own mask does not hold passed
  through as well. `Key.of` had always thrown for both; the resolver now throws
  the same `InvalidInputError` in the same words, and every entry point built on
  it inherits the refusal.

- **An additive grouping is felt on the head of each group.** 6/8 written
  `[2, 2, 2]`, or 12/8 written `[4, 4, 4]`, counts units rather than the meter's
  own pulses, but `metricWeight`, `isStrongBeat` and `Meter.weightAt` accented
  the midpoint of the bar — the pulse the compound reading has, and the head of
  no group in this one — and left every group head unaccented. A grouping of
  equal-length groups still states nothing extra where it restates the division
  the signature already has.

- **Beat 0 is the downbeat whatever beat a meter map opens at.** A map written
  `[{ startBeat: -1, ts: '4/4' }]` — the ordinary way to state the signature a
  pickup is written in — laid its bar lines from -1, so `barStartBeat(0, map)`
  answered -1, `metricWeight(0, map)` answered 1 rather than 3, and
  `formatBarPosition(0, map)` printed `'1.2'`. `barIndexAt`, `beatToBarPosition`
  and `Score.barAt` moved with them. The opening signature now counts its bars
  from beat 0 exactly as the bare signature does, at every offset it may be
  written at; every later change still begins a bar where it takes effect.
  `barPositionToPulse` also checks the bar it is given whichever form the meter
  came in, so `{ bar: NaN }` and `{ bar: 1.5 }` throw `InvalidInputError` under a
  single signature and not only under a map.

- **A meter map is answered from the map as it now reads.** A caller keeps its
  own array, and writing a signature into it left the bar arithmetic derived from
  the old one: after `map[1].ts.numerator = 3`, `meterAt` reported 3/4 while the
  bar lines, the bar numbers and the metric accents still came from 4/4. Writing
  `numerator = 0` short-circuited validation entirely, and `metricWeight` quietly
  returned 0. Every entry is now compared by value, grouping included, before an
  answer is given: the map above places its bars at 8, 11, 14, and the invalid
  one makes `assertMeterMap`, `meterAt` and `metricWeight` throw
  `InvalidInputError` again. A map emptied or holed mid-read no longer falls back
  to 4/4 either. `generateDrums` and `Composer.drums` read the whole map for the
  same reason: one that opens in 4/4 and changes to 3/4 at beat 8 is refused for
  the change rather than accepted for the opening, as a bare `'3/4'` already was.

- **The metric grid steps onto every meter change it crosses.**
  `metricGridUnit` divided the pulses of each region but not the beats the
  regions start at, so two 4/4 spans with the second beginning at 4.25 returned a
  step of one quarter that lands on none of the second span's pulses; it now
  returns 0.25. An onset written a hair off a beat is read as unmeasured instead
  of dividing the grid down to that hair, so a change at 4.000001 keeps the step
  of one. The segments `analyzeTimeline` cuts sit on this grid and can move with
  it.

- **An excerpt is read from where it sounds, in every analysis that reads one.**
  `phrasesFromTimeline`, `sectionsFromNotes` and `hypermeter` each derived the
  first bar of the span themselves, so an export whose first note lands a
  thousandth of a beat early was a pickup to one of them and a downbeat to
  another, and a host drawing all three together got bars that did not line up.
  All three take that beat from one derivation now, and a passage lifted from
  bar 9 is read at the same confidence and in the same phase as the same music
  read from the top. On the arrangement side, `analyzeArrangement` given both a
  chord timeline and a `key` pinned that key's region to beat 0 and ended the key
  search at the chart's last chord, so the excerpt held a key across eight bars
  of silence it never had and every note past the chart was read in the opening
  key; `tensionCurve` took its first sample at the slot boundary before the music
  rather than where the music starts.

- **A cadence belongs to the phrase it arrived in.** The tonic a period's
  antecedent cadences to is normally still sounding when the consequent opens,
  and the arrival was read only where that held chord stops: the seam between the
  two carried no cadence at all, the antecedent was reported with none, and the
  cadence was handed to the phrase that follows it — which is where
  `structuralCadences` then ranked it. A held arrival now closes its phrase at
  the bar line as well, and a reported `cadence.atBeat` always lies inside
  `[startBeat, endBeat)`. `phrasesFromTimeline` over notes that never sound
  returns `[]`, the answer `sectionsFromNotes` gives for the same input, rather
  than one phrase of zero length and a measured-looking confidence. A phrase's bar
  count is taken bar line by bar line, so six beats inside a 3/4 stretch is two
  bars and not one and a half. `opts.hypermeter` is held to what its own type
  states: a confidence outside [0, 1] or a fractional `groupBars` throws
  `InvalidInputError` naming the field.

- **The cadences settle the hypermetric phase.** Cadence fit was measured over
  the cadences given rather than over the hyperbar ends a reading predicts, and
  that cannot tell a two-bar reading from a four-bar one — a cadence every four
  bars sits at a group end under both, while half the two-bar groups end in
  nothing. Harmonic contrast could therefore outvote the cadences, and a group
  head restating the tonic its group closed on scored negative contrast that was
  subtracted from the cadence term, so a plain I-IV-V-I one chord per bar put the
  hypermetric downbeat on the dominant. Fit is now the share of predicted group
  ends a cadence closes; where cadences are given they decide the phase and the
  harmony chooses among the phases they allow; an elided arrival counts only
  where there is a next group to arrive into. A pickup bar heads no group, so it
  no longer counts toward the length a span needs to hold two of them.

- **One tolerance answers whether a note follows another.** The arrangement layer
  compared beats at 1e-9 while `analyzeVoice` allowed the few hundredths of a
  beat a played or humanized part leaves, so on one track the labels saw a
  predecessor the conflicts did not: parallel fifths, voice crossings and leaps
  across a legato boundary went unreported, and a single legato line was split
  into several sub-voices that were then reported as clashing with themselves.
  Both questions — the same instant, and one note after another — are asked in
  one place now, each with the tolerance it takes, so `conflicts` reports more on
  a humanized part and agrees with `analyzeVoice` about the same track. Notes
  struck together are assigned to lanes as a slice rather than paired off by
  position, so a C-E-G thinning to E-G no longer hands the E the C's lane and
  invents the leap that follows from it.

- **An option naming a harmony is honoured, or refused.** `tensionCurveFrom`
  passed `key`, `keys` and `harmonyTracks` through and then overwrote them with
  the analysis it was handed, so naming any of them changed nothing and said
  nothing; the curve is now taken under the harmony the caller named, keeping
  only what that naming leaves standing. `analyzeArrangement` and
  `createArrangementSession` refuse a `minSeverity` outside the severity scale,
  which used to narrow the report to nothing and read exactly like a clean
  arrangement, and which the class API already refused. An index in
  `harmonyTracks` naming a percussion track is refused as well: those pitches
  state no harmony, so the analysis came back blaming the music for clashing with
  a harmony nothing had stated. An unknown `track.role` — `'percussion'`, the
  word a MIDI import writes — was read as `'other'` and pooled into the key and
  chord inference; it now throws `InvalidInputError`, at the analysis entry point
  and at `Arrangement.of` alike. `Arrangement.of(tracks, { ts })` given a `Meter`
  stored `{}` and could not be read back, and `analyzePolyphony`, which the class
  API is a skin over, is now exported from the package root and from `./analyze`.

- **An instrument is read before the passage is.** A percussion profile no limb
  can reach was accepted and answered `Infinity` from `range()`, and a stringed
  profile with no strings was accepted whenever the passage happened to hold no
  note that exposed it; both are refused now, empty passage or not. An
  `articulation` outside `ARTICULATIONS` was carried down to the report and came
  back as `articulationUnavailable` — the musical claim that the instrument
  cannot play a technique that does not exist — and is an `InvalidInputError`
  from `Score.of`, `Score.fromJSON` and `playability` instead; a known technique
  the instrument lacks still reads as a playability issue, which is a fact about
  the instrument. Simultaneity is measured as the distance between two onsets
  rather than by the grid cell each rounds into, so two strokes a ten-thousandth
  of a beat apart are one attack wherever a fixed grid would have cut between
  them and `limbConflict` is reported across what used to be a bucket edge. A
  note of no length strikes nothing, so it counts toward neither the limbs at
  work nor the voices at once.

- **`foldIntoRange` answers with the nearest octave.** The search ran upward
  first and took the first octave it found, so over a gapped range it changed the
  voice rather than the register: `foldIntoRange(58, DRUM_KIT)` returned the
  shaker two octaves up where the open hi-hat sits an octave below, and now
  returns 46. Equal distances take the upper octave. `'guitar (drop D)'` also
  resolves to the guitar's own transposition — retuning a string does not move
  the interval between the part and the pitch it sounds — so
  `Instrument.guitarDropD().soundingPitch('C4')` returns C3 instead of throwing.

- **A tuning argument is checked for its shape before its fields.** Passing
  `null` where a tuning belongs surfaced as the library's own `TypeError` rather
  than as an `InvalidInputError` about the caller's input, in every function and
  method that takes one. `centsToRatio` returned `Infinity` or `0` for an offset
  spanning no ratio a number holds, and throws now; the offsets a pitch bend uses
  are unaffected. `JUST_RATIOS` is typed by the semitone classes it actually
  lists, so indexing it outside 0..12 is a compile error; the runtime table is
  unchanged.

- **Where a meter or a tuning used to be supplied by default, it is asked for.**
  `Rhythm.of(events)` recorded 4/4 when no meter was named, and a pattern in 6/8
  then answered every metric question — which beats are strong, where the bars
  fall, how dense it is — on the wrong pulse, with nothing downstream able to
  tell that reading from an intended one; the meter is now required, as
  `Rhythm.generate` and `generateRhythm` already required it. `Tuning.of`,
  `Tuning.fromData` and `Tuning.fromJSON` completed a table that had lost
  `refFreq` or `refStep` with A=440 and step 69, silently retuning a Baroque
  pitch standard that did not survive storage; a missing field is now an
  `InvalidInputError` naming it. Both are refusals where the library used to
  answer — as are several of the entries above, which is the shape of this patch:
  input that used to produce a plausible wrong answer now throws.

- **A tempo is one the conversions survive, and a score is read at all of its
  tempos.** A bpm small enough to make `beatsToSeconds` overflow to `Infinity`
  passed validation, and the message quoting the lower bound quoted a value that
  could not be read; the bound is 0.1 bpm, one beat every ten minutes.
  `Score.toTicks` returned `-0` for a position rounding onto the downbeat from
  below, which is the same tick as `0` but keys differently under `Object.is`.
  `Score.playability` read a single tempo at beat 0, so a passage under an
  accelerando was judged at the tempo the piece opened in; it now reads the whole
  tempo map, and the beats its issues name are still the score's own.

- **A tied chain never rises in length.** `beatsToTiedDurations` and
  `Duration.tieChain` wrote a dot wherever a value was followed by its own half,
  including where that made the dotted value outlast the value tied before it: 10
  beats came back as a whole note tied to a dotted whole. It is `[whole, whole,
  half]` now, and 11.5 beats `[whole, whole, double-dotted half]`. The tolerance
  `beatsToDuration` matches within is documented as what it is — 1e-6 quarter
  notes whatever `beatUnit` names, so a whole-note beat narrows it in proportion.

- **A note index hands out what it read.** The wrappers in `NoteEventIndex.notes`
  were unfrozen, and `endBeat` is what the active-note search is built from, so a
  host writing to one left the index answering from a span nothing else knew
  about; writing throws now. Two notes of the same pitch name no voice apart, so
  `'highest'` and `'lowest'` settle a unison on the same note — the lower
  `originalIndex` — rather than on whichever end of the array the scan reached
  last.

- **`generateProgression` draws its preset inside the context it was given.**
  The preset was chosen from a context rebuilt out of the bare seed, so a caller
  supplying its own `rng` to reroll got the same loop every time, and a caller
  pinning an `algorithmVersion` got the build default's preset under its own
  substitutions. The choice now comes from the resolved context like every other
  draw of the call, which means output moves for the same seed wherever a source
  was supplied or a version pinned. With the build's default version and no
  supplied source, nothing moved. `pickProgressionPreset` takes that same context
  as its second argument, and still takes a bare seed.

- **A saved composer records the settings its parts were written under.**
  `Composer.data` and `toJSON` carried a seed and an `algorithmVersion` only when
  the caller had named them, so a project file reopened under whatever the build
  it was opened on defaults to — a different piece under the same name, with
  nothing in the file to say so. Both are resolved and written out now.
  `Composer.equals` compared the settings held on one side against the data
  handed out by the other, so it answered "different" for a composer holding a
  source and "same" for two drawing from different ones; both sides are projected
  alike, and a source is compared by identity, being a handle on a stream rather
  than a setting.

- **The documentation states what the code does.** `Meter.format` and
  `formatTimeSignature` throw for a pulse-counted grouping whose groups differ —
  12/8 as `[1, 1, 2]` — which the TSDoc and the guides described as a fall back to
  the plain form; the behaviour is unchanged and now carries a `@throws`.
  `formatBarPosition` and `Meter.formatPosition` print two forms, and only one
  was documented: `'3.2'` on a felt beat, `'3.2+0.5'` between them, which most
  onsets of an ordinary piece fall on. `PhraseOptions.meters` said the default
  phrase length follows the meter in force at each beat, where it is taken once
  from the meter the span opens in. The performance guide states
  `createNoteEventIndex`'s lookups as `O(log n + k)`, k being the size of the
  simultaneous cluster an answer is settled from. `Tuning.of` and `Tuning.edo`
  document the conditions they actually check, including that a negative or
  fractional reference step is accepted — a tuner reading lands on one. And every
  `@example` in the published types imports through the package name and imports
  what it uses: two called `spelledKeyOf` without importing it, and three reached
  into the source tree by relative path. The `phrasesFromTimeline` and
  `structuralCadences` examples run over input that actually cadences, and their
  closing comments name the values they return.

- **A key keeps the tonic it was written with.** Ten public entry points reduced
  a key to its pitch classes on the way in and spelled a tonic back out of them,
  so a flat-side key arrived as its sharp-side twin. `figuredBassRealization`
  threw rather than return the tonic triad of `F# major`, `C# major` or
  `Ab minor`; `spellLine` wrote `Ab minor` in the sharps of `G# minor`;
  `Key.parse('Ab minor').augmentedSixth('german')` returned `E G# B C##` instead
  of `Fb Ab Cb D`; and `Voicing#spell` disagreed with `spellVoicing` on the same
  input. Every such entry now reads the key through one resolver, and deriving a
  tonic from bare pitch classes happens only inside it.

- **A key built on a world scale names itself.** `Key.named('miyakoBushi','D')`
  printed `'D major'` and did not read back; `ryukyu`, `ritsu`, `hijazkar`,
  `bhairav`, `marwa`, `purvi` and `todi` did the same. A key now prints the
  scale it stands on, and `Key.parse` reads it.

- **A derived key stays inside the signatures a player is handed.**
  `Key.keyOnDegree` could return a key at nine flats, and
  `Key.major('F#').forInstrument('clarinetBb')` a key at eight sharps carrying
  `F##`. Both now end on the respelling rule `Key.transpose` already had.

- **A figure's accidental is the sign a score prints.** `figuredBassOf` wrote
  `#3` for the leading tone of `C minor`, which as a figure names `B#`; the
  reader, meanwhile, already treated `n` as an absolute statement. Reading and
  writing are now derived from one table and are exact inverses: the six minor
  keys whose signature flattens the seventh take `n3`, and the crossed figure
  `+` is again the sign that raises whatever the key gives, in any key. A caller
  who wants the old "raise what the key gives" behaviour writes `+`. The
  documentation that said an augmented sixth carries no figures now names the
  French sixth, which returns `#643`.

- **A chord keeps both accidentals written on one degree.**
  `parseChordSymbol('C7(b9,#9)')` dropped one of them, and which one depended on
  the order the chart wrote them in; `formatChordSymbol` then wrote a bare `C7`
  over a chord carrying both. Alterations are now identified by degree and
  accidental together, in the symbol layer and the chord spec alike.

- **A chord with an omission keeps the seventh it plays.** `Chord.parse('G7no5')`
  reported quality `maj` and a `V` numeral in C major, while the same object's
  `symbol()` wrote `G7`. Omitted degrees are now ignored on both sides of the
  quality comparison. `Cno3` reports `maj` rather than `5` as a consequence;
  `5` remains the power chord's own quality.

- **`chordQualities()` enumerates in declaration order.** Quality names that look
  like integers — `5`, `6`, `11`, `13` — were hoisted to the front by JavaScript
  object key order. The enumeration is now an ordered list, and `detectChord`
  takes its tie-break from it, so `detectChordBest([9,0,4,7])` and
  `detectChordBest([2,5,9,0])` no longer name the same set of pitch classes two
  different ways.

- **A chord is validated where it is built.** `Chord.fromData({quality:'Maj7'})`
  was accepted and surfaced later as a `TypeError`; it now throws
  `InvalidInputError` at construction. A slash bass equal to the root is
  dropped, so `Chord.of('C','maj',0).equals(Chord.of('C','maj'))` and `toJSON()`
  no longer carries a redundant `bassPc`. `Chord.parse('C7omit1').roleOf(60)`
  returns `null` rather than calling a tone the chord does not sound the root.
  An eleventh drops the third for a dominant only, settled in one place, so
  `C11#9` and `C11b9` behave as `C11` does.

- **More of the vocabulary a chart writes is read.** `CMaj7`, `FMaj9`, `CMaj13`
  and `CMaj7#11` parse; `Comit3`, `Comit5` and `Comit1` parse as their `no`
  equivalents; and a tension carries over the half-diminished glyphs, so `Cø9`,
  `Ch9`, `Cø11` and `Cø7(b9)` read as the `m7b5` forms they name.

- **A transposed slash chord names a bass it contains.**
  `Chord.parse('Bb7/D').transpose(1).symbol()` was `B7/Eb`; it is now `B7/D#`,
  and the same holds through `Progression.transpose` and timeline
  transposition. `ChordSymbolOptions.flats` now chooses the side the whole
  symbol is written on rather than each note separately, so
  `transposeChordSymbol('Bb/F', 1, { flats: true })` is `Cb/Gb` — a chord and a
  bass that agree — rather than `B/Gb`.

- **A dominant is heard by the tones it sounds.** Four layers each had their own
  test for it, one of them a string comparison against `dom7`. As a result
  `detectModulations` collapsed a piece whose dominants were written `G13` or
  `G7b9` into a single region and named the wrong home key, and
  `reduceProgression` cut `G7sus4` out of the frame. All four now ask one
  predicate, as do the tests for a Neapolitan, for a minor key, and for the
  degrees an applied dominant may target.

- **A mode is not read as a minor key that cadences through a raised seventh.**
  `harmonizeMelody`'s diatonic tier injected the major dominant of a harmonic
  minor into `D dorian` and `B locrian`; the half-cadence relaxation written for
  the modes was applied to natural minor, so `Am → Em` in A minor was reported
  as a half cadence; a diatonic `VII` in `G mixolydian` was described as
  borrowed while reporting `borrowed: false`; and secondary dominants were
  offered for diminished triads. Each now turns on whether the key is a
  common-practice minor rather than on whether it merely lowers its third.

- **An applied dominant is named only where it can point somewhere.** The tonic
  was accepted as a target, so a plain `V7` in a minor key was described as an
  applied dominant and a tonic-degree chord in a reduction was labelled the
  tonic while tonicizing something else. The target is also cased as the key
  writes that degree, so `B7` in A minor is `V7/V` and `D#dim7` is `viio7/V`.
  `ChordToRomanOptions.applied` now documents all three conditions under which
  the reading is declined.

- **A cadential six-four no longer swallows the cadence it leads to.**
  `I64 → V` was classified as no cadence at all, taking the half cadence and the
  phrase boundary with it. The plagal test is measured by the fourth degree the
  mode has rather than by a fixed distance, so `F#→C` in C lydian is plagal and
  `F→C`, which the key does not contain, is not.

- **An excerpt starts where it sounds.** `keyTimelineFromNotes`, the chord
  timeline and `tensionCurve` each pinned their origin to beat 0, so a passage
  lifted from bar nine was read as eight bars of silence followed by the music.
  All three now read the first sounding beat through the derivation that already
  answered that question.

- **An altered tension over a seventh chord is named as a tension.** An `Ab` over
  `G7` was reported as `{kind:'needsResolution'}` rather than as the flat ninth
  it is, depending on whether the symbol wrote the alteration. Over a bare
  triad, where the harmony implies no such extension, the reading is unchanged.

- **A retrograde can be named, and its ratio measured backwards.** A cell whose
  pitches also read as an inversion came back unnamed, and where a name was
  given the `timeRatio` was still measured start-aligned: an uneven-valued
  retrograde reported 1.5 where it should report 1.

- **`melodicContour`, `Score.contour()` and `Score.motifs()` state what they
  read.** Notes struck together were sorted low to high and read as consecutive
  melody notes, so a chord read as an ascending line. Simultaneous notes are now
  one event, taken at the top voice, and every surface that reduces a phrase to
  a line says so.

- **The voicing search and the part-writing checker judge by one rule.** The
  search accepted a diminished-third descent the checker reports as an
  unresolved seventh, never scored a cross relation the checker reports, and
  applied the four-part exception for arriving at a perfect interval to
  two-voice counterpoint. Second species now judges a dissonant neighbour on the
  weak half, fifth species judges a tie against every measure it is carried
  into, and the chromatic-harmony exemption is granted only to a chord the key
  does not already contain — so a mode that lowers its own second no longer
  suppresses a real cross relation. A diminished seventh in a flat-side key is
  also spelled as the seventh it is, since a chord tone's degree is now read
  from the chord rather than from its distance above the root.

- **A drop voicing over a slash bass is a drop.** `C/E` in drop-2 came back with
  a seventeen-semitone gap; the named bass is now the voice the style drops, so
  `Cmaj7/G` in drop-2 is the textbook `G3 C4 E4 B4`. A chord with too few voices
  to drop is voiced in close position, which the documentation now states along
  with the minimum each style needs.

- **A bass line holds the register it was asked for.** `generateBassLine` placed
  each note against the last one it wrote, so a I-V vamp climbed an octave and
  stayed there. A segment's bass is now a function of its pitch class and the
  requested band. `style:'rootFifth'` is tiled by the bar rather than by the
  segment; a degree the chord's quality settles is taken from that chord's own
  scale, so a boogie sixth over `A7` is `F#` and a suspension is not made to
  sound the third it replaced; a walking line steps into a chord change rather
  than leaping into it; and `placeLicks` refuses an overlapping segment and an
  out-of-range dial exactly as `generateBassLine` does.

- **A drum part is written as its style is named.** A doubled rate wrote the same
  voice twice at the same position — fifteen such pairs in funk, twenty-two in
  samba — which hangs a note in a MIDI writer; a duplicate is now refused where
  onsets are written. A groove that moves its backbeat to a side stick no longer
  writes snare-head ghosts underneath it; the ornament dial answers in a verse
  and an intro rather than only in a chorus or a bridge; `style:'breakbeat'`
  differs from `standard` in every section, as do the dance and latin outros;
  and the pickup beats every fill archetype is written with are reachable again.
  A part with a tambourine, hand-clap or shaker over a full groove is no longer
  reported as impossible: `PercussionProfile` gains an optional `overdub`, and
  `DRUM_KIT` names those three voices as dubbed over the kit.

- **A preset turns over on its own period.** A preset whose borrowing doubles a
  degree — `aeolianPop` in a minor key — collapsed the repeat and turned over
  every three bars against parts written in four. Borrowed chords also open in
  the order an arranger reaches for them rather than in scale-degree order, and
  a slide is written into a note reached by a semitone.

- **One voice-leading defect is reported once.** Two voices arriving at an
  octave they were already sitting on, by contrary motion, were counted twice by
  `checkSpecies` and `Voicing.species` — as a parallel octave, and again as a
  battuta — so an exercise scored on how often a rule is broken read one mistake
  as two. `createsBattuta` now leaves a perfect class that was already there to
  `createsParallelPerfect`, the way the sibling `createsHiddenParallelPerfect`
  already did. A battuta into an octave the voices had not been sitting on — a
  fifth closing to an octave with the upper voice leaping down — is still
  flagged.

- **A velocity is a whole MIDI velocity, as the pitch beside it is.**
  `assertNoteEvent` describes `pitch` and `velocity` in the same words, a MIDI
  quantity in [0, 127], and checked only the pitch for being whole: a velocity
  of 63.7, left behind by an average or a scaling with the rounding forgotten,
  passed every entry point that validates a note event. `rhythmToNoteEvents`
  asked for less still — it builds note events without going through that guard
  at all, and took any finite pitch with any velocity in range, so it was the
  one path by which a fractional pitch or velocity could reach a public note.
  Both fields are whole MIDI values at both now.

- **A key keeps its spelling through the class API.** A class method resolved
  the key it was given or carried and then handed on its pitch classes alone, so
  the layer below spelled a tonic back off the circle rather than reading the one
  it was named with: `Key.minor('Ab').roman('iv6').figuredBass()` answered
  `b6b3` where that key needs only `6`; a tritone substitution in Ab minor came
  back `Bbb7` from `Chord.substitutions` and `A7` from `Progression.substitute`;
  and a progression voiced in that key parted from `voiceProgression` at the
  third chord. `Composer` and `Arrangement` reduced the key at construction, so
  `Composer.of({ key: 'Ab minor' }).key()` answered `'G# minor'` and a saved
  project came back written in a key other than the one it was stored in. Every
  class method hands the key on whole now. Composer options and arrangement
  settings therefore hold the resolved key rather than its scale: data written
  before this reads unchanged, and data written now records the spelling.

- **A composer that names no key refuses a pitched part.** `Composer.bass`,
  `Composer.progression` and `Composer.counterMelody` fell back on C major when
  the composer named none — silently, and regardless of the key `harmonize` had
  just read off the melody — so the documented way of working, harmonize first
  and write the other parts after, wrote those parts in a key nobody had asked
  for. All three throw `InvalidInputError` now, as the composer already refused
  a meter that changes under a part laid out in bars, and the message names both
  ways on. `Composer.drums` carries no key and is written either way, and
  `Composer.harmonize` still reads one off the melody it is given.

- **A score, a motif cell and an arrangement track are bounded by the budget the
  analyses are bounded by.** `Score.fromData`, the `Motif` constructor and the
  track rebuild an arrangement does on import checked each note as they copied
  it and never checked how many there were, so an array `analyzeArrangement`
  refuses as over budget was accepted, copied and kept. All three read the array
  through one guard now, which caps the count before the pass over the notes
  begins.

## [1.0.1] - 2026-08-18

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

[1.0.1]: https://github.com/libraz/libcantus/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/libraz/libcantus/compare/v0.9.5...v1.0.0
[0.9.5]: https://github.com/libraz/libcantus/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/libraz/libcantus/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/libraz/libcantus/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/libraz/libcantus/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/libraz/libcantus/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/libraz/libcantus/releases/tag/v0.9.0
