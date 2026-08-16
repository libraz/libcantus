# Use case: a harmony exercise checker

Represent each moment as a low-to-high array of spelled notes and pair it with the chord expected at that moment. Spelling matters: a MIDI-only input cannot identify a cross relation, and cannot tell an augmented fourth from a diminished fifth.

```ts
import { Chord, Key, checkPartWriting, parseNote } from '@libraz/libcantus';

const line = (names: string) => names.split(' ').map((name) => parseNote(name));
const key = Key.major('C').scale;

const violations = checkPartWriting(
  [line('G2 B3 D4 F4'), line('C3 C4 E4 G4')],
  [Chord.of('G', 'dom7').data, Chord.of('C', 'maj').data],
  key,
);

violations.every((violation) => typeof violation.rationale === 'string'); // true
violations.every((violation) => violation.fromIndex === 0); // true
```

Each result names a `kind`, the voices involved, the two positions, and a rationale. Render that alongside the student's notation; do not silently repair the line.

## Species counterpoint

To grade two-voice species counterpoint, call `checkSpecies` with the species number:

```ts
import { checkSpecies, majorKey, parseNote } from '@libraz/libcantus';

const cantus = ['C4', 'D4', 'E4', 'D4', 'C4'].map((name) => parseNote(name));
const counterpoint = ['C5', 'A4', 'G4', 'B4', 'C5'].map((name) => parseNote(name));

checkSpecies(cantus, counterpoint, 1, majorKey(0)); // []
```

Species one through four align the counterpoint by note count. The fifth mixes note values and needs `opts.durations`, given in cantus-firmus notes.

## Grading choices the checker leaves open

- **Ranges.** The `range` rule uses `SATB_RANGES` for four voices. Supply explicit `ranges` when the exercise is not SATB; for any other voice count the rule is skipped rather than invented.
- **Spacing.** `maxSpacing` defaults to twelve semitones between adjacent upper voices. Raise or lower it to match the curriculum.
- **Which rules to show.** Every violation carries a `kind`. Filter the list rather than asking for a different check, so a student sees a consistent vocabulary as the course adds rules.

## What it does not do

The checker evaluates conventional voice-leading rules, not musical quality. An empty result means no rule was broken; a violation does not by itself mean the passage is wrong.

It also does not decide what the exercise meant. Given an ambiguous answer it grades against the chords it was passed, and choosing those chords is itself an analysis. Notation input, chord selection, and the decision about what counts as a mistake all remain the application's.

Building a teaching UI on top of this benefits from [Counterpoint and part-writing](../counterpoint-and-part-writing.md), which lists every rule and the single-motion predicates for checking a note while it is being dragged.
