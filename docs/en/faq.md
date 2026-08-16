# Questions and limitations

## Scope

**Does it read or write MIDI files?**
No. It works on note events a host has already parsed. See [Interoperability](interoperability.md) for the tick and tempo conversions at that boundary.

**Does it render notation?**
No. It supplies the information a notation renderer needs — spelled notes, note values with dots and tuplets, bar positions, key signatures — but draws nothing.

**Does it analyze audio or play sound?**
No. Pitch detection from audio and playback both belong to the host. `nearestStep` converts a detected frequency into a MIDI pitch the rest of the library can read.

**Does it have runtime dependencies?**
No. The package is pure TypeScript with no dependencies, and every entry point is synchronous.

**Can it run in a browser or a worker?**
Yes. There is no Node-specific API in the library, and every input and output is plain JSON-compatible data, so it crosses a worker boundary with a structured clone.

## Analysis

**Why does chord detection return a low confidence?**
Because the evidence is weak. Sparse, noisy, or deliberately ambiguous material has no single correct reading, and the library reports what it found rather than picking one and hiding the doubt. Show the confidence and let the user correct it.

**Why is a passage labelled in a key I did not expect?**
Key regions are inferred from pitch-class distribution over a window. A short tonicization can read as a modulation if `minKeyBeats` is small, and a modulation can be missed if `expectedKeyBeats` is long. Both are options on `keyTimelineFromNotes` and `detectModulations`; see [Key relations and modulation](key-relations-and-modulation.md).

**Why is my chromatic dominant written `II7` instead of `V7/V`?**
Naming the root against the home key is always a correct spelling, and whether the chord is genuinely applied is a reading. Pass `{ applied: true }` to `chordToRoman` to get the applied form.

**Why do I get Roman numerals for a whole-tone passage?**
Because a numeral was asked for. Check `supportsFunctionalHarmony` first — see [Scales and modes](scales-and-modes.md).

**Do section labels mean verse and chorus?**
No. `sectionsFromNotes` identifies repeated units and labels them A, B, and so on. Which one is a verse is a decision about the song, not something the notes determine.

**Is analysis deterministic?**
In practice yes: the same notes give the same reading. It is not versioned, though, so an improvement to detection may change a label between releases. Only generation carries a reproducibility guarantee — see [Determinism and seeding](determinism-and-seeding.md).

## Generation

**Why did the same seed give different notes after upgrading?**
It should not, for a pinned `algorithmVersion`. If it did without one, the default version was raised; pin the version recorded with the project. If it did with one, that is a defect worth reporting.

**Why did raising `complexity.rhythmic` move notes I wanted to keep?**
It should not. Draws are addressed by position, so raising a dial only adds events. If notes moved, something else changed too — the seed, the tempo, the bar count, or an option that shifts the grid.

**Why does `difficulty: 1` still produce a part I cannot play?**
`difficulty` is a ceiling on the timing layer alone. Whether the note exists on the instrument comes from `GenerationContext.instruments`; name a profile there and check the result with `playability`.

**Why did `voiceProgression` throw instead of returning a compromise?**
Because no voicing satisfied the constraints. A `NoSolutionError` says the constraints have to change, not the input; widen the ranges or raise `maxSpacing`. See [Errors and validation](errors-and-validation.md).

**Can I supply my own style vocabulary?**
Yes. `GenerationContext.vocabulary` carries caller-supplied figures for every part in one list, and an entry carrying the id of a built-in replaces it.

## Spelling and notation

**Why is pitch class 6 spelled Gb rather than F#?**
Both are six accidentals from C, and the tie is broken towards the flat side. Pass an explicit tonic when the piece is written the other way.

**Why is the relative of D-flat major B-flat minor and not A-sharp minor?**
Because key relations are computed in fifths space and the tonic is read back off the circle, which keeps the spelling conventional.

**Why does a checker need spelled notes rather than MIDI numbers?**
Because a cross relation and an augmented second are invisible in semitone counts. `isForbiddenMelodicLeap(parseNote('Ab4'), parseNote('B4'))` is true and `isForbiddenMelodicLeap(68, 71)` is false, for the same two pitches.

**Why is `B` read as English rather than as the German B-flat?**
A lone `B` from an unknown source is far more often English. Pass `system` explicitly when the source is known.

## Design decisions

**Why are there both a class API and a functional API?**
The functions are the library. Every class is a thin skin over them that holds a value and its context together, so that a chain of calls does not have to re-state the same facts. A class exposes its plain value through `.data` and takes plain data back, so the two interoperate freely and neither is a walled garden.

**Which should I use?**
Whichever reads better where you are. They give the same answers, and a test in this repo compares them member by member to keep it that way.

Reach for a class when several calls share a subject: a `Score` carries its notes, meter, tempo, and key, so reading the harmony, the phrases, and the sections is three method calls instead of three functions wired together by hand. A `Composer` carries the key, tempo, and seed for a whole piece, so each part is one call rather than one call plus a repeated context.

Reach for a function when you have one question and already hold the data — or when you are writing something that should not depend on the class layer at all, such as a plugin boundary that only passes JSON.

**Why is analysis separate from generation?**
So that inspecting a passage never rewrites it. `playability` answers "can this be played" for a chart a player was handed, and never edits the chart.

**Why does a scale carry a bit mask rather than a name?**
So that any subset of the twelve pitch classes works everywhere a built-in scale does, and so that membership and degree questions are arithmetic rather than table lookups.

**Why do generated parts come back as note events instead of being written into my project?**
The host owns the project. Every generator returns material; where it goes, whether it replaces anything, and how a user edits it afterwards are decisions the library does not make.
