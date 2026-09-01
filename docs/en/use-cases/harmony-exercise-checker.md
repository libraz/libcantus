# Use case: a harmony exercise checker

Each moment of a four-part exercise is a `Voicing`: the sounding pitches, lowest voice first. Grading is the motion from one to the next, read against the chord each realizes and the key the exercise is written in.

The flow assumes the student's answer as pitches or as spelled note names, plus the chords the exercise was set on and its key. For the vocabulary — voice, voicing, part-writing rule, species counterpoint — see the [primer](../primer/index.md).

```ts
import { Voicing } from '@libraz/libcantus';

const dominant = Voicing.of([43, 59, 62, 65]);
const tonic = Voicing.of([48, 60, 64, 67]);

const violations = dominant.checkTo(tonic, ['G7', 'C'], 'C major');

violations.map((violation) => violation.kind); // ['unresolvedSeventh']
violations[0]?.voices; // [3]
violations[0]?.rationale; // 'The chordal seventh does not fall by step'

dominant.spell('C major', 'G7').map((note) => note.name); // ['G2', 'B3', 'D4', 'F4']
```

`checkTo` spells both voicings itself — each pitch against the chord it belongs to and the key around it — because half of what the rules forbid is invisible in a pitch: an augmented second, a diminished fourth, a cross relation. `spell` shows the reading the check ran against, which is what to print when a student disputes a verdict.

Each violation names a `kind`, the voices involved, the two positions, and a rationale. Render that alongside the student's notation; do not silently repair the line.

## Grading a whole exercise

`checkTo` grades one motion, which is the unit a UI checks while the student writes the next chord. A finished exercise is graded in one call by the function underneath, which takes every voicing and every chord at once and reports each violation with the pair it spans.

That is also the way in for an application that holds the student's own spelling. `checkTo` starts from pitches and recovers a spelling; a notation editor already knows whether the student wrote A-flat or G-sharp, and only that answer can be graded:

```ts
import { Chord, Key, checkPartWriting, parseNote } from '@libraz/libcantus';

const line = (names: string) => names.split(' ').map((name) => parseNote(name));
const key = Key.major('C').scale;
const chords = [Chord.parse('C').data, Chord.parse('Ab').data];

// The same pitches, written two ways:
const asFlats = [line('C3 E3 G3 C4'), line('Ab2 Eb3 Ab3 C4')];
const asSharps = [line('C3 E3 G3 C4'), line('G#2 D#3 G#3 C4')];

checkPartWriting(asFlats, chords, key).map((violation) => violation.kind); // []
checkPartWriting(asSharps, chords, key).map((violation) => violation.kind); // ['crossRelation']
```

The classes build what that call takes — `Chord.parse('C').data` for the chords — and the key goes in whole. `checkPartWriting` takes a `KeyLike` in its third parameter, so a key name, a `Key`, or the key/scale used above all go straight in, and nothing has to be assembled by hand around it.

## Species counterpoint

A `Voicing` is the counterpoint line here, one pitch per slot rather than one per voice, and the cantus firmus is given as note names:

```ts
import { Voicing } from '@libraz/libcantus';

const counterpoint = Voicing.of([72, 69, 67, 71, 72]);

counterpoint.species(['C4', 'D4', 'E4', 'D4', 'C4'], 1, 'C major'); // []
```

Species one through four align the counterpoint by note count. The fifth mixes note values and needs `opts.durations`, given in cantus-firmus notes.

## Checking a note as it is placed

An editor that grades while a voice is being dragged asks about one candidate pitch against the voices already sounding. The verdict comes with replacements, and the whole placeable range can be enumerated to draw as a hint:

```ts
import { NoteSafety, Voicing } from '@libraz/libcantus';

const sounding = Voicing.of([48, 55, 64]);
const query = { profile: 'strict', chord: 'C', key: 'C major', strongBeat: true } as const;

sounding.safetyOf(72, query).safety === NoteSafety.Safe; // true
sounding.safetyOf(65, query).suggestions; // [64, 67, 60]
sounding.safePitches(query, 60, 72); // [72, 67, 64, 60]
```

## Grading choices the checker leaves open

- **Ranges.** Four voices are judged against `Voicing.satbRanges`. Supply explicit `ranges` when the exercise is not SATB; for any other voice count the rule is skipped rather than invented.
- **Spacing.** `maxSpacing` defaults to twelve semitones between adjacent upper voices. Raise or lower it to match the curriculum.
- **Which rules to show.** Every violation carries a `kind`. Filter the list rather than asking for a different check, so a student sees a consistent vocabulary as the course adds rules.

## What it does not do

The checker evaluates conventional voice-leading rules, not musical quality. An empty result means no rule was broken; a violation does not by itself mean the passage is wrong.

It also does not decide what the exercise meant. Given an ambiguous answer it grades against the chords it was passed, and choosing those chords is itself an analysis. Notation input, chord selection, and the decision about what counts as a mistake all remain the application's.

Building a teaching UI on top of this benefits from [Counterpoint and part-writing](../counterpoint-and-part-writing.md), which lists every rule and the single-motion predicates for checking one pair of voices at one moment.
