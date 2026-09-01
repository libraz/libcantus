# Primer

The primer teaches the musical ideas the rest of these guides assume, for a reader who writes TypeScript fluently and has never studied music. Each page explains one concept in plain terms, says what that concept decides in this API, shows a few runnable lines, and hands off to the domain guide that covers the functions in full.

It is not a substitute for a theory course. It covers what the library models and stops there — nothing on performance practice, on orchestration, or on hearing any of it. Where a musical convention is arbitrary, the page says so rather than supplying a reason that does not exist.

## How the six pages fit together

They build in order, and each one uses the terms the previous ones defined.

1. [Pitch and intervals](pitch-and-intervals.md) — a single note, and the distance between two. Everything else is stated in these terms.
2. [Scales and keys](scales-and-keys.md) — the pitch material a passage draws on, and the key that names it.
3. [Chords](chords.md) — notes sounding together, and how one is identified and named.
4. [Harmony](harmony.md) — chords read against a key: Roman numerals, function, and cadences.
5. [Voices](voices.md) — the same chords laid out as simultaneous melodic lines, and the rules that govern how those lines move.
6. [Rhythm and meter](rhythm-and-meter.md) — when notes happen, independent of what they are.

The first two are prerequisites for the next three. Rhythm and meter is independent of the other five and can be read at any point.

Every page has the same shape: the concept in plain terms, the decision it forces on the API, runnable examples, and a link to the guide that takes it further. A term is glossed the first time a page uses it, so a page can be opened on its own without reading the ones before it.

## What each concept decides

The middle column is the reason a programmer needs the concept at all — the place where not knowing it produces a wrong call rather than a gap in vocabulary.

| Concept | What it decides in the API | Page |
|---|---|---|
| Pitch, pitch class, spelling | Whether a value is a MIDI number, a pitch class, or a spelled `Note` — and why so many functions ask for a key they otherwise do not need | [Pitch and intervals](pitch-and-intervals.md) |
| Interval | Why `A4` and `d5` are different values at six semitones each, and how a transposition is spelled | [Pitch and intervals](pitch-and-intervals.md) |
| Scale, mode, key | What `KeyScale`, `ResolvedKey` and `Key` each carry, and which named scales support a Roman-numeral reading at all | [Scales and keys](scales-and-keys.md) |
| Chord, quality, inversion | How `Chord` separates root, quality, intervals and bass, and what chord detection is choosing between | [Chords](chords.md) |
| Roman numeral, function, cadence | Why chord analysis needs a key attached, and what a cadence report is asserting | [Harmony](harmony.md) |
| Voicing, voice leading | How a chord becomes four pitches, and what `checkPartWriting` is checking | [Voices](voices.md) |
| Beat, bar, meter, tempo | That every time value is a quarter-note beat, and that only a tempo turns beats into seconds | [Rhythm and meter](rhythm-and-meter.md) |

## Where to go next

For a first working example, start with [Getting started](../getting-started.md) and come back to the primer for whatever term it uses that is unfamiliar. For complete flows built out of these pieces — importing a chart, analyzing a piece, preparing parts, checking a harmony exercise — see [Use cases](../use-cases/index.md).

A domain guide assumes the primer page it links to and does not repeat it. Reading a guide and finding a term used without explanation means the primer page for that term is the one to open.

Each primer page ends with a link to its domain guide. The full set: [Pitch and notation](../pitch-and-notation.md), [Tuning and frequency](../tuning-and-frequency.md), [Scales and modes](../scales-and-modes.md), [Key relations and modulation](../key-relations-and-modulation.md), [Harmony](../harmony.md), [Voicing](../voicing.md), [Counterpoint and part writing](../counterpoint-and-part-writing.md), [Time and arrangement](../time-and-arrangement.md), [Rhythm and groove](../rhythm-and-groove.md), [Analysis](../analysis.md), and [Generation](../generation.md). [Glossary](../glossary.md) defines the terms on their own, and [API reference](../api-reference.md) lists every export.
