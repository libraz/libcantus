# Glossary

Terms as this library uses them. Where a musical term has more than one common meaning, the entry says which one the API implements.

## Data model

**NoteEvent** — A sounding note: `pitch` (MIDI number), `startBeat`, `durationBeat`, and optional `velocity` and `articulation`. The unit of time is the quarter-note beat throughout.

**Pitch class** — A pitch reduced modulo 12, so C4 and C5 are both pitch class 0. Analysis above the pitch layer works in pitch classes.

**Spelled note** — A letter, an alteration, and an optional octave. `parseNote('Bb3')` is a spelled note; MIDI 58 is not. A spelled note without an octave has a pitch class but no MIDI number.

**KeyScale** — A root pitch class plus a twelve-bit `modeMask12`. Bit `n` is set when the scale contains the pitch `n` semitones above the root. This is the representation for keys, modes, and any other scale.

**SpelledKey** — A `KeyScale` paired with the spelled tonic that anchors its letter names. Db major and C# major are the same `KeyScale` and different `SpelledKey` values.

**ChordSpec** — A chord as structure: a base quality plus sevenths, alterations, additions, omissions, and an optional bass. Not a name from a fixed list.

**ChordSegment** — A chord with a start and end beat, plus the confidence of the reading. The unit a chord timeline is made of.

**MotifCell** — Motivic material as pitches and rhythm, before placement. `motifToNoteEvents` turns a cell into note events.

**GenerationContext** — The seed, dials, tempo, instruments, and vocabulary shared by every generator in one piece. A bare number is shorthand for `{ seed }`.

## Pitch and interval

**Spelled interval** — An interval with both a diatonic number and a chromatic span, so an augmented fourth and a diminished fifth stay distinct despite spanning the same six semitones.

**Enharmonic** — Two spellings of the same sounding pitch or key: F-sharp and G-flat, C-sharp minor and D-flat minor.

**Cents** — One hundredth of an equal-tempered semitone, on a log scale. The unit tuning deviations are measured in.

**EDO** — Equal divisions of the octave. 12-EDO is standard tuning; `edo(19)` builds a nineteen-division temperament. Outside 12-EDO a step index is not a MIDI number.

## Harmony

**Diatonic** — Belonging to the current key without alteration. `isDiatonic` tests a whole chord.

**Roman numeral** — A chord named by its scale degree relative to a key, with case and suffix carrying the quality. `chordToRoman` renders one; `romanToChord` reads one back.

**Applied (secondary) dominant** — A dominant chord that tonicizes a degree other than the tonic, written `V7/V`. The key does not change. `chordToRoman` writes the applied form only when `applied: true`.

**Borrowed chord** — A chord taken from the parallel mode without changing the tonic — F minor in C major. `borrowedSource` names where it came from.

**Modal interchange** — Borrowing as a general practice; `modalInterchangePalette` returns the whole available set for a key.

**Tonicization** — Treating a degree as a temporary tonic without leaving the key. A modulation, by contrast, moves the tonal centre for a sustained span.

**Pivot chord** — A chord diatonic in both the old key and the new one, used to explain a modulation.

**Cadence** — A harmonic closing formula. `detectCadence` names the type and, when a voicing identifies the soprano, grades an authentic cadence as perfect or imperfect.

**Harmonic function** — Whether a chord acts as tonic, subdominant, or dominant. `functionOf` reports it; it is meaningful only where `supportsFunctionalHarmony` is true.

**Augmented sixth** — Italian, French, and German chords built on the lowered submediant. No Roman numeral names them, so they render as `It6`, `Fr6`, and `Ger6`.

**Neapolitan** — The major triad on the lowered second degree, written `bII6` in first inversion, or `N6` when `neapolitan: true`. It is an altered chord, so a mode that has a lowered second of its own — phrygian, locrian — sounds the same triad as its native `II` rather than as the Neapolitan.

**Negative harmony** — Reflection of a chord across the axis of its key. A transformation with exactly one result, not a proposal.

## Scales

**Mode** — A rotation of a scale that takes a different degree as tonic. Dorian and Ionian share a pitch-class set and differ in tonic.

**Avoid note** — A non-chord scale tone a semitone directly above a chord tone, or the third a suspension displaced. It clashes when sounded against the chord, though a line may pass through most of them; `avoidNotes` takes a `use` of `'harmonic'` or `'melodic'` for the two readings.

**Available tension** — A non-chord scale tone that can be added to a chord as colour.

**Chord scale** — A scale chosen to fit a chord. `chordScales` ranks candidates; `scalesForChanges` chooses a whole path with continuity.

**Scale system** — Which analytical tradition a scale belongs to: `common-practice`, `modal`, or `non-functional`. Functional-harmony labels apply only to the first two.

## Voicing and counterpoint

**Voicing** — A chord realized as one pitch per voice, ascending, index 0 being the lowest.

**Voice leading** — How individual voices move between chords. `voiceLeadingCost` is the total semitone movement.

**Drop voicing** — A close-position stack with one upper voice dropped an octave: drop 2 for the second voice from the top, drop 3 for the third.

**Shell voicing** — Root, third, and seventh: the tones that identify the chord.

**Rootless voicing** — Third, fifth, seventh, and tensions, with the root left to the bass.

**Parallel perfect** — Two voices moving in the same direction while holding a perfect fifth, octave, or unison. `createsParallelPerfect` tests one motion.

**Hidden (direct) perfect** — Similar motion into a perfect interval, with the outer voices leaping. Less severe than a parallel and reported separately.

**Cross relation** — The natural and altered forms of a note sounding in different voices across a chord change. Detectable only from spelled notes.

**Species counterpoint** — The graded exercise system, species one through five, each licensing different dissonances. `checkSpecies` grades one.

**Cantus firmus** — The given voice in a species exercise, one note per measure.

**Figured bass** — A bass line with intervals figured above it. `realizeFiguredBass` takes the intervals from the key, so the same figure spells differently at different degrees.

## Rhythm and form

**Meter map** — An array of `{ startBeat, ts }` changes. A single `TimeSignature` is shorthand for a one-entry map.

**Metric weight** — How strong a beat position is, 0 (off-pulse) to 3 (downbeat). The basis of onset placement and accent shaping.

**Hypermeter** — Metrical grouping above the bar: the sense in which bars come in twos and fours.

**Phrase** — A span proposed from cadences, rests, repetition, and hypermetric position. A proposal from observable signals, not a claim about intent.

**Harmonic rhythm** — How often the harmony changes, in beats. Sets the grid a chord timeline and a harmonization are quantized to.

**Groove template** — A per-bar grid of timing and velocity deviations captured from a performance, applicable to other material.

**Humanize** — Deviating quantized events from the grid and shaping their velocities by metric position.

## Generation

**Seed** — The number that fixes a generator's output. One project seed derives every part's own randomness.

**Positional draw** — A random value addressed by position rather than call order, so editing one parameter does not redraw everything after it.

**Complexity** — The `rhythmic`, `harmonic`, and `ornament` dials in 0..1. Raising one adds material without disturbing what is already sounding.

**Difficulty** — A ceiling from 1 to 5 on how hard the result may be to play. It removes candidates rather than increasing intensity, and governs the timing layer alone.

**Algorithm version** — The number that carries the reproducibility promise, separate from the package version. For a fixed version, the same inputs give the same output from any build that accepts it.

**Vocabulary** — Caller-supplied figures a generator may draw on, over and above the built-in ones.

## Instruments

**Instrument profile** — An instrument described by what it is: a tuning and fret count for a stringed instrument, limbs and reach for a kit.

**Playability layer** — Which kind of obstacle an issue is: 1 the note does not exist, 2 the arrangement does not hold together, 3 there is not enough time.

**Transposing instrument** — An instrument whose written pitch differs from its sounding pitch. `toSoundingPitch` and `toWrittenPitch` convert, preserving spelling.

**Concert pitch** — Sounding pitch, the pitch analysis works in.
