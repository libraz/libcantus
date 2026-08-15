# @libraz/libcantus

Pure-TypeScript music theory engine. It takes MIDI note numbers and chord
symbols and gives back harmonic meaning — Roman numerals, function, cadence,
key — then generates new parts against that meaning. No runtime dependencies.

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/libcantus/ci.yml?branch=main&label=CI)](https://github.com/libraz/libcantus/actions)
[![npm](https://img.shields.io/npm/v/@libraz/libcantus)](https://www.npmjs.com/package/@libraz/libcantus)
[![codecov](https://codecov.io/gh/libraz/libcantus/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/libcantus)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/libcantus/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![docs](https://img.shields.io/badge/docs-API%20reference-b5892e)](https://libraz.github.io/libcantus/)

## What it's for

Three things it was built to do. Each block below runs as written.

### Sit next to a DAW

Multi-track note events in, harmony out, then parts written against it:

```ts
import {
  chordTimelineFromNotes, chordToRoman, detectCadence, generateBassLine,
} from '@libraz/libcantus';

// Four bars of block chords, as a DAW would hand them over:
const harmony = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

const { timeline, prevailingKey } = chordTimelineFromNotes(harmony);
timeline.segments.map((s) => chordToRoman(s.chord, prevailingKey)); // ['I', 'IV', 'V7', 'I']

const [, , penultimate, final] = timeline.segments;
detectCadence(penultimate.chord, final.chord, prevailingKey).type; // 'authentic'

// A walking bass over the harmony that was just recovered:
generateBassLine({ segments: timeline.segments, key: prevailingKey, style: 'walking', seed: 1 });
// [{ pitch: 36, startBeat: 0, durationBeat: 1, velocity: 100 }, ...16 notes]
```

Chord boundaries are searched for rather than assumed, and so is the key, so a
piece that modulates is not read against the key it started in.

### Mark a harmony exercise

Exercises arrive written the way they are written — German or Japanese note
names, a figured bass, four parts on two staves — and what comes back is what
the answer breaks, with the voice and the reason. Here the seventh of the
dominant rises instead of falling, which is the first thing a chorale exercise
is marked for:

```ts
import { Chord, Key, checkPartWriting, parseNote } from '@libraz/libcantus';

Key.parse('gis moll').toString(); // 'G# minor'
Key.parse('嬰ト短調').toString({ system: 'german' }); // 'gis moll'

const line = (names: string) => names.split(' ').map((name) => parseNote(name));

// V7 to I, with F in the soprano taken up to G instead of down to E:
checkPartWriting(
  [line('G2 B3 D4 F4'), line('C3 C4 E4 G4')],
  [Chord.of('G', 'dom7').data, Chord.of('C', 'maj').data],
  Key.major('C').scale,
);
// [{ kind: 'unresolvedSeventh', voices: [3], fromIndex: 0, toIndex: 1,
//    rationale: 'The chordal seventh does not fall by step' }]
```

Resolve that F down to E and the same call returns `[]`. `checkSpecies` grades
the five species of two-voice counterpoint against the same violation
vocabulary, so a parallel fifth in a species exercise and one in a chorale
report identically.

### Read a piece

`reduceProgression` marks each chord `structural`, `passing` or `auxiliary`, so
an embellishment is not the equal of the chord it decorates:

```ts
import { chordTimelineFromChords, majorKey, reduceProgression } from '@libraz/libcantus';

// Cmaj7 -> C#dim7 -> Dm7, a bar each:
const changes = chordTimelineFromChords(
  [
    { rootPc: 0, quality: 'maj7', startBeat: 0 },
    { rootPc: 1, quality: 'dim7', startBeat: 4 },
    { rootPc: 2, quality: 'min7', startBeat: 8 },
  ],
  12,
);

reduceProgression(changes, majorKey(0)).map((entry) => entry.level);
// ['structural', 'passing', 'structural']  — each with a rationale
```

`phrasesFromTimeline` splits a piece into phrases from cadences, rests,
repetition and hypermetric position; `hypermeter`, `sectionsFromNotes` and
`extractMotifs` cover the rest of the form.

## How it answers

Four decisions run through the whole library, and they are what separates it
from a bag of theory helpers.

**It does not guess.** A perfect authentic cadence needs the tonic in the
soprano, and only a voicing can say where the soprano is. Without one the grade
comes back `null` rather than a plausible answer:

```ts
import { Chord, Key, detectCadence } from '@libraz/libcantus';

const [G, C] = [Chord.of('G', 'maj').data, Chord.of('C', 'maj').data];
const key = Key.major('C').scale;

detectCadence(G, C, key).strength; // null — nothing here names the soprano
detectCadence(G, C, key, { voicing: [[55, 62, 71], [48, 64, 67, 72]] }).strength; // 'perfect'
```

**It says why.** `analyzeChord`, `detectCadence`, `detectKey` and `explainRoman`
each carry a `rationale`, and report the readings they turned down when asked
for `alternatives`. The reasoning is derived from the pass that produced the
answer, so the two cannot drift apart:

```ts
import { Chord, Key, explainRoman } from '@libraz/libcantus';

explainRoman(Chord.of('G', 'dom7').data, Key.major('C').scale).rationale;
// 'V7: the root is the fifth degree of the key, the case and suffix come from
//  the dom7 quality, and the chord stands on its own root'
```

**It keeps the spelling.** A cross relation is one letter carrying two
accidentals and an augmented second is a minor third by ear, so neither can be
decided from a pitch. The part-writing and counterpoint checkers take spelled
notes for that reason, and `spellLine` solves a whole voice as one path instead
of note by note.

**It declines rather than forces.** Roman numerals and functional harmony
presuppose the common practice. `WORLD_SCALES` carries material from outside it
— the Japanese *in* and *yo* scales, four maqāmāt, the Hindustani *thāṭ* sets —
and `supportsFunctionalHarmony` says whether that reading applies at all:

```ts
import { Key, supportsFunctionalHarmony } from '@libraz/libcantus';

Key.named('miyakoBushi', 'E').noteNames(); // ['E', 'F', 'A', 'B', 'C']
supportsFunctionalHarmony('miyakoBushi'); // false
supportsFunctionalHarmony('dorian'); // true
```

The maqāmāt built on half-flat degrees are left out rather than approximated by
a twelve-tone neighbour.

## What it isn't

- **Not an I/O or audio layer.** No MIDI file reader or writer, no notation, no
  audio analysis, no playback. Bring your own parser and hand it note events. If
  you need that layer too, [libsonare](https://github.com/libraz/libsonare)
  covers audio analysis, mastering, synthesis and SMF I/O, and its npm binding
  sits alongside this one; the two share no code and neither requires the other.
- **Not microtonal above the pitch layer.** Frequencies, cents, EDO and just
  intonation are there, but analysis runs on twelve pitch classes. Music
  organised in smaller steps than a semitone is out of reach.
- **Not a corpus.** Nothing is bundled to run statistics over.
- **Not complete on the harmony side.** Known gaps: a cadential six-four is read
  as an inverted tonic rather than as dominant function; a half cadence requires
  a major dominant, so an arrival on a modal minor `v` is not one; a deceptive
  cadence covers the submediant only.

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

## Two APIs

The theory lives in **tree-shakeable pure functions**. On top of them sits a
**fluent, immutable class API** (`Note`, `Interval`, `Chord`, `Key`,
`Progression`) that reads like music theory. Which one you get follows a single
rule: the musical **values** — notes, chords, keys, progressions — have both
forms and interoperate freely, while operations over **collections and
timelines** (part generation, whole-arrangement analysis, key ranking) take
arrays of note events and are exposed as functions only.

```ts
import { Chord, Key, Note } from '@libraz/libcantus';

const c = Key.major('C');

c.chord(5, 'dom7').pitchClasses(); // [2, 5, 7, 11]  (G7)
c.roman('V7/V').voice(); // [ ...SATB MIDI ]  (secondary dominant, voiced)
Note.of('C4').transpose(7).name; // 'G4'

// A ii–V–I, built and analyzed in one line:
c.chord(2, 'min').progressionTo(c.chord(5, 'dom7'), c.chord(1, 'maj')).analyze();
// { chords: [...functional analysis...], cadence: { type: 'authentic', ... } }
```

Every class wraps a plain object (`Chord.data`, `Note.data`) and delegates to
the pure functions, so the two styles mix freely.

## Notes, intervals, and keys

Parse and format notes, convert to MIDI, and spell intervals so enharmonics the
pitch-class layer can't tell apart come out right. Every parser has a
non-throwing sibling — `tryParseNote`, `tryParseInterval`, `tryParseChordSymbol`,
`Chord.tryParse` — so a text field needs no try/catch per keystroke:

```ts
import { Interval, Note, tryParseNote } from '@libraz/libcantus';

Note.of('C4').transposeBy('A4').name; // 'F#4'  (a named interval, not six semitones)
Interval.between(Note.of('C4'), Note.of('F#4')).name; // 'A4'  (augmented fourth)
Interval.between(Note.of('C4'), Note.of('Gb4')).name; // 'd5'  (diminished fifth)
tryParseNote('C#b'); // { ok: false, error: InvalidInputError }
```

A `KeyScale` is a root pitch class plus a 12-bit `modeMask12` (bit `n` set means
pitch class `(rootPc + n) % 12` is in the scale). `majorKey`, `minorKey` and
`scaleByName` cover the modes, pentatonics, blues, whole-tone and octatonic
scales; `MAJOR_MASK` / `NATURAL_MINOR_MASK` let you define custom keys, and
`nearestScaleTone` snaps a pitch to the closest in-scale one.

A key knows its signature, the keys around it, and how to reach them. Every
relation is computed on the circle of fifths, so the answer comes back spelled
the way the key is written — the relative of Db major is Bb minor, not A# minor.
Degrees are counted from 1 the way musicians count them, and a degree can carry
a whole key, which is what questions about modulation are usually built from:

```ts
import { Key } from '@libraz/libcantus';

Key.major('C').relative().toString(); // 'A minor'
Key.major('C').relationTo(Key.minor('A')); // 'relative'
Key.minor('D').transposeBy('A4').toString(); // 'G# minor'
Key.minor('D').transposeBy('d5').toString(); // 'Ab minor'
Key.minor('A').keyOnDegree(4).toString(); // 'D minor'  (mode read off the diatonic triad)

// "A key modulates to the key on the fourth degree of its relative, is then
//  transposed up an augmented fourth, and ends up G# minor. What was it?"
Key.minor('G#').transposeBy('-A4').keyHavingTonicAsDegree(4).relative().toString(); // 'C major'
```

## Chords and progressions

Build from scale degrees, Roman numerals or lead-sheet symbols, and read back
the other way. A chord is modelled as a base plus a seventh and sets of
alterations, additions and omissions — a `ChordSpec` — rather than a fixed list
of names, so a symbol a lead sheet writes but no name covers still parses:

```ts
import { Chord, Key, chordSpecOf } from '@libraz/libcantus';

Key.major('C').roman('V7/V').symbol(); // 'D7'  (a secondary dominant)
Chord.parse('F#m7b5').pitchClasses(); // [0, 4, 6, 9]
Chord.parse('C7(b9,#11)').pitchClasses(); // [0, 1, 4, 6, 7, 10]
chordSpecOf(Chord.parse('C7(b9,#11)').data).alterations;
// [{ degree: 9, alter: -1 }, { degree: 11, alter: 1 }]
```

The named qualities are all still there — `dim7`, `m7b5`, `minMaj7`, `aug7`,
sixths, altered dominants, everything through the thirteenths — and
`Chord.quality` reports the nearest of them. Pitch content, inversion and symbol
formatting run through the spec, so the name is a label on the chord rather than
the limit of what can be spelled.

Whole progressions come from style presets:

```ts
import { generateProgression, majorKey } from '@libraz/libcantus';

// One chord per bar, secondary dominants inserted where they fit:
generateProgression({ key: majorKey(0), style: 'idol', bars: 8, reharmonize: true, seed: 1 });
```

## Harmonic analysis

Roman numerals with function, cadence and modal interchange, in major and minor,
respecting inversions:

```ts
import { Chord, Key } from '@libraz/libcantus';

// A minor iv in a major key reads as a borrowed subdominant:
Chord.of('F', 'min').analyze(Key.major('C'));
// { function: 'subdominant', borrowed: true, source: 'parallelMinor', roman: 'iv',
//   rationale: 'Subdominant: iv takes the subdominant function of its degree in
//   the key, borrowed from the parallel minor', alternatives: [] }
```

`detectCadence` names the type — authentic, plagal, half, deceptive, phrygian,
modal — and grades the authentic one perfect or imperfect. A static V-to-V
repeat with no root motion is not a cadence and returns a null type.

## Harmony and counterpoint exercises

A figured bass takes its unfigured intervals from the key, so the same figure
names a different chord on each degree. A German sixth is spelled as an
augmented sixth rather than the dominant seventh it sounds like, and a
transposing instrument reads its own key:

```ts
import { Key, formatNote, parseNote, realizeFiguredBass, romanToChord, spellChord } from '@libraz/libcantus';

const sixth = realizeFiguredBass(parseNote('D'), '6', Key.major('C').scale);
spellChord(sixth, parseNote('B'), Key.major('C').scale).map((note) => formatNote(note));
// ['B', 'D', 'F'] — the leading-tone triad, sounding over its third

romanToChord('Ger6', Key.major('C').scale).bassPc; // 8 — the lowered submediant
Key.major('C').forInstrument('clarinetA').toString(); // 'Eb major'
```

`checkSpecies` grades the five species. `imitate` writes a canonic entry, real
or tonal — a tonal answer takes the degrees the key offers, which is why a
rising fifth comes back as a fourth:

```ts
import { checkSpecies, imitate, majorKey, parseNote, scaleByName } from '@libraz/libcantus';

const line = (names: string) => names.split(' ').map((name) => parseNote(name));

// A textbook first-species exercise in D dorian, counterpoint above:
checkSpecies(
  line('D4 F4 E4 D4 G4 F4 A4 G4 F4 E4 D4'),
  line('A4 A4 G4 A4 B4 C5 C5 B4 D5 C#5 D5'),
  1,
  scaleByName('dorian', 2),
); // []  — this one breaks nothing

const subject = [60, 62, 64, 67].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
imitate(subject, { atBeat: 4, interval: 'P5', key: majorKey(0), answer: 'tonal' })
  .map((note) => note.pitch); // [67, 69, 71, 74]
```

`voiceIndependence` measures motion, rhythmic complementarity, registral
separation and runs of perfect consonances between two lines, and returns the
numbers rather than a verdict. Species rules read a pop texture's parallel
thirds and pedal points as errors, and the numbers let you decide what that
means for the music you are writing.

## Recognition and spelling

Notes in, chord or key out — the inverse of the builders. Keys are ranked by the
correlation between the weighted pitch-class distribution and the candidate's
profile, so `score` is that correlation in [-1, 1]; the `profile` option chooses
which profile ranks them, and the church modes join the 24 major and minor keys
when asked for:

```ts
import { Chord, detectKey } from '@libraz/libcantus';

Chord.detectBest([60, 63, 67, 70])?.symbol(); // 'Cm7'

// A D dorian riff: a D-F-A outline with B natural and no B flat anywhere.
detectKey([2, 2, 2, 2, 5, 5, 9, 9, 11, 11, 7, 4, 0, 2], { modes: true })[0].scaleName; // 'dorian'

detectKey([0, 2, 4, 5, 7, 9, 11], { explain: true })[0].rationale;
// 'C major: profile correlation 0.76, with 7 of 7 input pitch classes in the scale'
```

A `Key` carries a spelled tonic, so the pitch-class core produces letter names.
`spellLine` solves a whole voice as one path, so a line stops alternating
between sharp and flat readings of the same idea — a rising chromatic line takes
sharps, a falling one flats, and a tone the chord names follows the chord:

```ts
import { Key, majorKey, noteNames, spellLine } from '@libraz/libcantus';

Key.named('harmonicMinor', 'A').noteNames(); // ['A', 'B', 'C', 'D', 'E', 'F', 'G#']

const rising = [60, 61, 62, 63, 64].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
noteNames(spellLine(rising, null, majorKey(0))); // ['C4', 'C#4', 'D4', 'D#4', 'E4']
```

The second argument is a chord timeline, or `null` to spell from the key alone.

## Reharmonization, scales, and voicings

Substitution candidates — tritone, relative, borrowed and chromatic-mediant subs,
plus modal-interchange palettes — the scales a chord can take with their avoid
notes and tensions, and voicings from four-part SATB to comping styles:

```ts
import { Chord, Key, majorKey, parseChordSymbol, substituteChord } from '@libraz/libcantus';

substituteChord(parseChordSymbol('G7'), majorKey(0)); // [{ chord: Db7, type: 'tritone', ... }, ...]
Key.major('C').chord(5, 'dom7').negativeHarmony().symbol(); // 'Dm7b5'

Chord.of('C', 'dom7').scales()[0]; // { name: 'mixolydian', rootPc: 0 }
Chord.of('C', 'maj7').tensions('ionian'); // [2, 9]  (9 and 13; the 11 is an avoid note)

const c = Key.major('C');
c.chord(1, 'maj').progressionTo(c.chord(6, 'min'), c.chord(5, 'dom7'), c.chord(1, 'maj')).voice();
// [[48, 60, 64, 67], [45, 60, 64, 69], [43, 62, 65, 71], [48, 60, 64, 72]]

Chord.of('C', 'maj7').styledVoicing({ style: 'shell' }); // root, third, seventh
```

`scalesForChanges` optimizes the scale choice across a whole set of changes;
`voiceLeadingCost` and `nextVoicing` steer the leading, and the `counterpoint`
predicates validate it.

## Time

The metre may change during a piece. A `MeterMap` — `{ startBeat, ts }[]` — is
what the analysis entry points take, with `ts` accepted as sugar for a
one-element map. Everything positional derives its place from the bar in force
rather than from one global modulo. A pickup sounds before the downbeat: the
downbeat is beat 0, the anacrusis is bar -1, and `pickupBeats` declares how far
back a note may legitimately start:

```ts
import { formatBarPosition, metricWeight, parseTimeSignature } from '@libraz/libcantus';

// Two bars of 4/4, then 3/4 from beat 8 on:
const meters = [
  { startBeat: 0, ts: parseTimeSignature('4/4') },
  { startBeat: 8, ts: parseTimeSignature('3/4') },
];

metricWeight(11, meters); // 3 — a downbeat of the 3/4
metricWeight(12, meters); // 1 — a downbeat only to a reading stuck in 4/4

formatBarPosition(-1, parseTimeSignature('4/4')); // '0.4'  (a score numbers the pickup bar 0)
```

Tempo is a piecewise-constant `TempoMap`, integrated exactly across its changes,
and a length is spelled the way it is notated:

```ts
import { beatsToDuration, beatsToSeconds, beatsToTiedDurations } from '@libraz/libcantus';

// 4 beats at 120 plus 4 at 60; reading the whole span at 60 would give 8.
beatsToSeconds(8, [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }]); // 6

beatsToDuration(1 / 3); // { base: 'eighth', dots: 0, tuplet: { actual: 3, normal: 2 } }
beatsToTiedDurations(5); // [{ base: 'whole', dots: 0 }, { base: 'quarter', dots: 0 }]
```

`beatsToTicks` / `ticksToBeats` put the same beats on a PPQ grid, and the rest
of the meter helpers cover simple, compound and additive metres.

## Generation

Bass lines, countermelodies, drums, rhythms, motifs and ornaments, deterministic
for a given seed. One `GenerationContext` carries the project seed, the tempo,
the instruments and how elaborate the result should be. `complexity` runs
`rhythmic`, `harmonic` and `ornament` on 0..1, where raising a dial only adds
events and never moves the ones already sounding; `difficulty` is a ceiling from
1 to 5 that takes candidates away rather than a strength, so "involved but easy"
and "plain but hard" are both askable:

```ts
import { generateDrums, generateMotif, majorKey } from '@libraz/libcantus';

generateMotif({ key: majorKey(0), bars: 2, contour: 'arch', seed: 1 });

generateDrums({
  bars: 4,
  style: 'funk',
  section: 'chorus',
  ctx: { seed: 1, bpm: 96, complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 } },
});
```

A bare number is sugar for `{ seed }`. Randomness is drawn by position — bar,
beat, voice — from a seed derived per part, so changing a parameter halfway
through a piece leaves everything else where it was, and `algorithmVersion` is
the contract a caller pins output to.

Ornamentation is a separate pass over material that already exists, so making a
fill easier does not mean generating it again:

```ts
import { ornament } from '@libraz/libcantus';

// A bar of straight eighths; ghosting takes the weak positions.
const eighths = [60, 62, 64, 65, 67, 65, 64, 62];
const notes = eighths.map((pitch, i) => ({ pitch, startBeat: i * 0.5, durationBeat: 0.5 }));

ornament(notes, { style: 'ghost', amount: 0.6, seed: 4 }).map((note) => note.articulation);
// [undefined, 'ghost', 'ghost', undefined, undefined, 'ghost', 'ghost', undefined]
```

The drum fill archetypes, kick figures and bass licks are dictionaries rather
than branches. A `Vocabulary<T>` entry states where it applies — genre, section,
tempo range, metre, difficulty — so selection is a lookup, and
`GenerationContext.vocabulary` takes a caller's own entries.

An `InstrumentProfile` describes what an instrument physically is, so its range
is derived rather than stored, and `playability` reports what stands in the way
without rewriting or rejecting anything:

```ts
import { BASS_4_STRING, GUITAR_DROP_D, GUITAR_STANDARD, canSound, playability } from '@libraz/libcantus';

canSound(GUITAR_DROP_D, 38); // true   (D2)
canSound(GUITAR_STANDARD, 38); // false  (standard tuning stops at E2)

playability([{ pitch: 27, startBeat: 0, durationBeat: 1 }], BASS_4_STRING).issues;
// [{ type: 'noteOutOfRange', layer: 1, notes: [0], startBeat: 0, impossible: true,
//    message: '4-string bass cannot sound MIDI 27' }]
```

Naming an instrument in the context is itself the request that the part be
playable on it: a bass line whose register leaves the instrument is folded by
the octave, as a player would.

## Arrangements

`analyzeArrangement` takes raw multi-track `NoteEvent`s and returns the inferred
chords, the keys the piece passes through, per-note theory labels, and the notes
that clash with the sounding harmony:

```ts
import { analyzeArrangement, generateCounterMelody } from '@libraz/libcantus';

const report = analyzeArrangement([
  { role: 'melody', notes: melodyNotes },
  { role: 'harmony', notes: chordNotes },
]);
report.conflicts; // [{ beat, trackName, pitch, safety, reasons, rationale }, ...]

report.keys.map((region) => region.modulation); // [undefined, 'dominant', ...]
report.keys[1]?.pivot; // { chord, romanFrom: 'I', romanTo: 'IV' }

generateCounterMelody({ melody: melodyNotes, timeline: report.timeline, key: report.prevailingKey });
```

`keyTimelineFromNotes` and `detectModulations` expose the key search on its own,
and `pivotChords(from, to)` lists the triads any two keys share with their Roman
numeral in each.

`harmonizeMelody` goes the other way. Ornamental tones are classified from the
melody and its metre before any chord is chosen, so the harmony follows the
melody's structural tones rather than its accented passing notes:

```ts
import { harmonizeMelody, majorKey } from '@libraz/libcantus';

// Twinkle, Twinkle: C C G G A A G / F F E E D D C, each half closing on a
// note held twice as long.
let beat = 0;
const twinkle = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60].map((pitch, i) => {
  const durationBeat = i === 6 || i === 13 ? 2 : 1;
  const note = { pitch, startBeat: beat, durationBeat };
  beat += durationBeat;
  return note;
});

harmonizeMelody({ melody: twinkle, key: majorKey(0), harmonicRhythm: 2 })
  .chords.map((chord) => chord.rootPc); // [0, 5, 0, 5, 0, 7, 0]  (C F C F C G C)
```

A host re-analysing on every keystroke can hold a session instead. It recomputes
only the beats an edit affects and splices them into the previous analysis;
where it cannot make the result equal to a full pass, it falls back to one
rather than returning something close:

```ts
import { chordTimelineFromNotes, createArrangementSession } from '@libraz/libcantus';

// Four bars of block chords — C F G7 C — under a melody:
const harmony = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);
const melody = [72, 69, 71, 72].map((pitch, bar) => ({ pitch, startBeat: bar * 4, durationBeat: 4 }));
const { prevailingKey } = chordTimelineFromNotes(harmony);

const session = createArrangementSession(
  [{ role: 'melody', notes: melody }, { role: 'harmony', notes: harmony }],
  { key: prevailingKey },
);

// One note of the last bar moves, so only that end of the piece is re-derived:
const editedNotes = melody.map((note, i) => (i === 3 ? { ...note, pitch: 76 } : note));
const next = session.update([{ trackIndex: 0, notes: editedNotes }]);
next.analysis.timeline.segments.map((s) => s.chord.rootPc); // [0, 5, 7, 0]  (what a full pass reads)
session.analysis.timeline.segments; // the analysis before the edit still stands, for undo
```

Note events use one type throughout: `NoteEvent`
(`{ pitch, startBeat, durationBeat, velocity?, articulation? }`, MIDI pitch in
quarter-note beats, negative onsets for a pickup).

## Form

Above the chord sit the units a listener hears. `phrasesFromTimeline` splits a
piece into phrases from cadences, rests, repetition and hypermetric position,
each carrying its closing cadence, the evidence behind the split, and a
confidence. `structuralCadences` ranks them, so "the cadence of this piece" is
answerable rather than a flat list:

```ts
import {
  chordTimelineFromChords, majorKey, phrasesFromTimeline, structuralCadences,
} from '@libraz/libcantus';

// An eight-bar period: the antecedent turns to the dominant and stops there,
// the consequent restarts on the subdominant and closes on the tonic.
const period = [
  [0, 'maj'], [5, 'maj'], [2, 'min'], [7, 'maj'],
  [5, 'maj'], [2, 'min'], [7, 'maj'], [0, 'maj'],
] as const;
const timeline = chordTimelineFromChords(
  period.map(([rootPc, quality], bar) => ({ rootPc, quality, startBeat: bar * 4 })),
  32,
);

const quarters = (pitches: number[], at: number) =>
  pitches.map((pitch, i) => ({ pitch, startBeat: at + i, durationBeat: 1 }));
const tune = [
  ...quarters([60, 62, 64, 65], 0), ...quarters([67, 65, 64, 62], 4),
  ...quarters([64, 65, 67, 69], 8), { pitch: 71, startBeat: 12, durationBeat: 4 },
  ...quarters([69, 67, 65, 64], 16), ...quarters([62, 64, 65, 67], 20),
  ...quarters([65, 64, 62, 59], 24), { pitch: 60, startBeat: 28, durationBeat: 4 },
];

const phrases = phrasesFromTimeline(timeline, tune, { key: majorKey(0) });
phrases.map((phrase) => phrase.cadence?.cadence.type); // ['half', 'authentic']
phrases[0]?.signals; // ['cadence', 'longNote', 'hypermeter']

structuralCadences(phrases)[0]; // { cadence: {...}, weight: 1, phraseIndex: 1 }
```

`hypermeter` infers how bars group into hyperbars, and `sectionsFromNotes`
recovers a form from repetition. Sections are lettered rather than named:
repetition alone cannot tell a chorus from a second verse.

```ts
import { hypermeter, sectionsFromNotes } from '@libraz/libcantus';

const held = (pitches: number[], at: number) =>
  pitches.map((pitch) => ({ pitch, startBeat: at, durationBeat: 16 }));
const perBar = (pitches: number[], at: number) =>
  pitches.map((pitch, i) => ({ pitch, startBeat: at + i * 4, durationBeat: 4 }));
const strain = (at: number, chord: number[], line: number[]) => [
  ...held(chord, at),
  ...perBar(line, at),
];

// Twelve bars: a four-bar strain over C, a contrasting one over F, then the
// first strain again.
const notes = [
  ...strain(0, [48, 55, 64], [72, 69, 71, 67]),
  ...strain(16, [53, 60, 69], [65, 72, 74, 69]),
  ...strain(32, [48, 55, 64], [72, 69, 71, 67]),
];

hypermeter(notes).groupBars; // 4  — with the downbeats and a confidence alongside
sectionsFromNotes(notes, { unitBars: 4 }).map((section) => section.label); // ['A', 'B', 'A']
```

`reduceProgression`, shown above, separates the chords that carry a progression
from the ones that decorate it; `basis: 'duration'` reads the same progression
by salience instead.

`extractMotifs` finds recurring cells by interval contour and rhythmic profile,
so a restatement at another pitch level or in wider note values is recognised as
the same figure. `relateMotifs` names how two statements relate — repetition,
transposition, inversion, retrograde, retrograde inversion, augmentation,
diminution — and separates a real sequence from a tonal one, which is the
difference the key makes:

```ts
import { majorKey, motifFromNotes, relateMotifs } from '@libraz/libcantus';

const cell = (pitches: number[]) =>
  pitches.map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));

// C D E, answered a step higher. The literal answer keeps the major second and
// needs an F#; the diatonic one stays in C major and turns the second minor.
const subject = motifFromNotes(cell([60, 62, 64]));
relateMotifs(subject, motifFromNotes(cell([62, 64, 66])), majorKey(0))?.kind; // 'transposition'
relateMotifs(subject, motifFromNotes(cell([62, 64, 65])), majorKey(0))?.kind; // 'tonalTransposition'
```

`melodicSimilarity` and `melodicContour` cover the cases no exact transformation
explains.

## Pitch as sound

```ts
import { edo, frequencyOf, justDeviationCents } from '@libraz/libcantus';
```

Frequencies, cents, EDO and just intonation, for tuning and analysis.

## Documentation

Full API reference — every export with signatures, categorized by domain and
with runnable examples — is generated from the source and published at
**[libraz.github.io/libcantus](https://libraz.github.io/libcantus/)**.

## License

Apache-2.0
