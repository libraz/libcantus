# Counterpoint and part-writing

These checkers report what a texture does wrong. They never rewrite it. A student's answer is the thing being graded, and silently repairing it destroys the information the exercise exists to produce.

Everything here works on **spelled notes with octaves**. A MIDI pitch cannot tell an augmented fourth from a diminished fifth, and cannot identify a cross relation at all, so the rules that depend on spelling would be quietly skipped if the input were numbers.

## Checking a chorale

Give one voicing per chord, ascending, one spelled note per voice, alongside the chords those voicings realize:

```ts
import { checkPartWriting, majorKey, makeChord, spellVoicing } from '@libraz/libcantus';

const key = majorKey(0);
const chords = [makeChord(0, 'maj'), makeChord(2, 'min')];
const voicings = [
  [48, 55, 64, 72],
  [50, 57, 65, 69],
].map((pitches, index) => spellVoicing(pitches, chords[index] ?? chords[0], key));

const violations = checkPartWriting(voicings, chords, key);

violations[0]?.kind; // 'parallelFifth'
violations[0]?.voices; // [0, 1]
violations[0]?.fromIndex; // 0
violations[0]?.toIndex; // 1
```

Every violation names the rule, the voices involved, where the motion starts and ends, and a one-sentence rationale. Results come back in musical order: the rules inside a chord first, then the rules taking it to the next one.

Voice indices count from the bottom, matching `voiceChord` and `SATB_RANGES`. A rule about a pair names both ascending; a rule about a single line names one. A cross relation is the exception — it names the voice holding the earlier note first, whichever is higher.

### The rules that are checked

Inside one chord: `voiceCrossing`, `spacing`, `range`.

Between consecutive chords: `parallelFifth`, `parallelOctave`, `hiddenPerfect`, `overlap`, `crossRelation`, `augmentedMelodicInterval`, `unresolvedLeadingTone`, `unresolvedSeventh`.

Species exercises add `wrongRhythmicRatio`, `unpreparedDissonance`, `unresolvedSuspension`, `illegalLeap`, `battuta`, and `missingCadence`.

### Ranges and spacing

```ts
import { checkPartWriting, majorKey, makeChord, spellVoicing } from '@libraz/libcantus';

const key = majorKey(0);
const chords = [makeChord(0, 'maj')];
const voicings = [spellVoicing([48, 60, 76, 79], chords[0] ?? makeChord(0, 'maj'), key)];

checkPartWriting(voicings, chords, key).map((violation) => violation.kind);
// ['spacing', 'range']
```

The `range` rule is judged against `SATB_RANGES` for a four-voice exercise. For any other voice count there is no conventional compass to assume, so the rule is skipped unless `ranges` is given. Supply explicit ranges when the exercise is not SATB. `maxSpacing` defaults to twelve semitones between adjacent upper voices; the bass–tenor pair is exempt, as convention has it.

## Species counterpoint

`checkSpecies` grades a two-voice exercise in species one through five:

```ts
import { checkSpecies, majorKey, parseNote } from '@libraz/libcantus';

const cantus = ['C4', 'D4', 'E4', 'D4', 'C4'].map((name) => parseNote(name));
const counterpoint = ['C5', 'A4', 'G4', 'B4', 'C5'].map((name) => parseNote(name));

checkSpecies(cantus, counterpoint, 1, majorKey(0)); // []
```

The cantus firmus is one note per measure. The counterpoint is aligned by position rather than by written rhythm: the first four species have a fixed number of notes per measure, so the note count alone says where each note falls. A closing measure written as a single whole note is accepted as the convention it is.

The fifth species mixes note values, so it needs `opts.durations`, given in cantus-firmus notes. `opts.counterpointAbove` says which side the written voice is on; by default it is inferred from the mean pitch of each line.

Each species licenses different dissonances, and the checker applies the right one: none in the first, a passing dissonance on the weak half in the second and third, a prepared suspension on the downbeat in the fourth, both in the fifth.

Violations name the cantus firmus as voice 0 and the counterpoint as voice 1, and index into the counterpoint.

## The individual rules

The rules the checkers apply are also exported one by one, for a host that wants to test a single motion — while a note is being dragged, say — instead of grading a finished exercise:

```ts
import { createsParallelPerfect, createsVoiceCrossing, isForbiddenMelodicLeap, parseNote } from '@libraz/libcantus';

const n = (name: string) => parseNote(name);

createsParallelPerfect(n('C4'), n('D4'), n('G4'), n('A4')); // true
createsVoiceCrossing(n('C4'), n('E4')); // true
isForbiddenMelodicLeap(n('Ab4'), n('B4')); // true
isForbiddenMelodicLeap(68, 71); // false
```

The last two lines are the same two pitches. As spelled notes they form an augmented second and are forbidden; as MIDI numbers they form a minor third and are permitted. This is why the checkers take spelled input.

Each predicate accepts either spelled notes or MIDI numbers, and the numeric form skips exactly the rules that need spelling. The full set: `createsParallelPerfect`, `createsParallelOctave`, `createsParallelUnison`, `createsHiddenParallelPerfect`, `createsVoiceCrossing`, `createsVoiceOverlap`, `createsVerticalDissonance`, `createsBattuta`, `exceedsSpacing`, `isForbiddenMelodicLeap`, `isAugmentedMelodicInterval`, and `isLeadingToneResolution`.

## Voice independence

`voiceIndependence` measures how far two written lines behave as separate voices rather than as one line doubled:

```ts
import { parseNote, voiceIndependence } from '@libraz/libcantus';

const lead = ['C5', 'D5', 'E5'].map((name) => parseNote(name));
const counter = ['E4', 'F4', 'G4'].map((name) => parseNote(name));

voiceIndependence(lead, counter).motion.parallel; // 1
```

`motion` holds the share of moves in each category — contrary, oblique, similar, parallel — summing to 1. A harmony line in tenths comes out entirely parallel, which is not a violation of anything; it is a description of what was written. A slot where neither voice moves is not a move at all and is left out, so an accompaniment that mostly sits still can still report mostly contrary motion.

The report also carries `rhythmicComplementarity` (how often the counter attacks where the lead holds), `separation` (mean and closest distance), `crossings`, and `longestPerfectRun`. Together they are what distinguishes a second voice from a thickened first one. Use them to judge a generated counter-melody, or to show a student what their line is actually doing.

## What these checkers are not

They evaluate conventional voice-leading rules, not musical quality. An empty result means no rule was broken, and a violation does not by itself mean the passage is wrong: repertoire breaks these rules deliberately and often.

They also do not decide what the exercise meant. Given an ambiguous answer, `checkPartWriting` grades it against the chords it was passed. Choosing those chords is itself an analysis, and it belongs to the caller.
