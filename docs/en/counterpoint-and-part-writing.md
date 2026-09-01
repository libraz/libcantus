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

`Voicing.checkTo` grades one motion, from a voicing to the one that follows it. It spells both sides itself in the key it is given, and takes the chords and the key in whatever form the caller holds them, so a symbol and a key name are enough:

```ts
import { Voicing } from '@libraz/libcantus';

const from = Voicing.of([48, 55, 64, 72]);
const to = Voicing.of([50, 57, 65, 69]);

const violations = from.checkTo(to, ['C', 'Dm'], 'C major');

violations[0]?.kind; // 'parallelFifth'
violations[0]?.voices; // [0, 1]
```

That is the interactive case — a voice has just been dragged, and the question is what the move broke. `checkPartWriting` is the whole-exercise case, and grades a chorale of any length in one call.

### The rules that are checked

Inside one chord: `voiceCrossing`, `spacing`, `range`.

Between consecutive chords: `parallelFifth`, `parallelOctave`, `hiddenPerfect`, `overlap`, `crossRelation`, `augmentedMelodicInterval`, `unresolvedLeadingTone`, `unresolvedSeventh`.

Species exercises add `wrongRhythmicRatio`, `unpreparedDissonance`, `unresolvedSuspension`, `illegalLeap`, `battuta`, `missingCadence`, and `melodicShape`.

`unresolvedLeadingTone` asks the leading tone to rise to the tonic, with the exception the style itself makes: in an inner voice it may fall a third onto the fifth of the tonic chord — the frustrated leading tone, written that way to keep the triad complete — and that is not reported. In an outer voice, where the line is exposed, it still is.

### Cross relations

A cross relation is one letter carrying two different accidentals in two different voices across a chord change. What the rule forbids is the semitone left exposed across the texture, so three things take that exposure away, and none of them is reported:

- either of the two notes is led into by step, which is how a chromatic tone is introduced rather than sprung;
- both notes lie in inner voices, where the classical norm is far milder than it is between the outer ones;
- the chord being left or reached is an applied dominant, the Neapolitan, or an augmented sixth, whose own definition contains the contradiction.

An applied dominant is read from its resolution: the same major triad on the third degree of a major key is `V/vi` where `vi` follows it and a chromatic mediant where nothing does, and only the first licenses the tone it brings with it.

```ts
import { checkPartWriting, majorKey, makeChord, spellVoicing } from '@libraz/libcantus';

const key = majorKey(0);
const chords = [makeChord(0, 'maj'), makeChord(4, 'dom7'), makeChord(9, 'min')];
const voicings = [
  [48, 52, 60, 67],
  [52, 56, 59, 62],
  [45, 57, 57, 60],
].map((pitches, index) => spellVoicing(pitches, chords[index] ?? chords[0], key));

// I - V7/vi - vi: the soprano's G is contradicted by the tenor's G#, which is
// what tonicizing vi sounds like.
checkPartWriting(voicings, chords, key); // []
```

Each pair of voices is reported once, whichever way round the clash is met. The augmented sixth is identified by the interval it is named for, read off the written letters: the same pitches spelled as a bVI7 sound no augmented sixth, and the contradiction is then reported.

### Ranges and spacing

```ts
import { checkPartWriting, majorKey, makeChord, spellVoicing } from '@libraz/libcantus';

const key = majorKey(0);
const chords = [makeChord(0, 'maj')];
const voicings = [spellVoicing([48, 60, 76, 79], chords[0] ?? makeChord(0, 'maj'), key)];

checkPartWriting(voicings, chords, key).map((violation) => violation.kind);
// ['spacing', 'range']
```

The `range` rule is judged against `SATB_RANGES` — `Voicing.satbRanges` is the same four ranges, copied — for a four-voice exercise. For any other voice count there is no conventional compass to assume, so the rule is skipped unless `ranges` is given. Supply explicit ranges when the exercise is not SATB. `maxSpacing` defaults to twelve semitones between adjacent upper voices; the bass–tenor pair is exempt, as convention has it.

Both options are checked before any rule runs, by the same validators the voicing search uses. A `maxSpacing` that is not a finite non-negative number, and `ranges` that are empty, malformed, or fewer than the voices being graded, raise `InvalidInputError` instead of quietly switching a rule off. An empty result therefore means that nothing was broken, never that something could not be judged.

## Species counterpoint

`checkSpecies` grades a two-voice exercise in species one through five:

```ts
import { checkSpecies, majorKey, parseNote } from '@libraz/libcantus';

const cantus = ['C4', 'D4', 'E4', 'D4', 'C4'].map((name) => parseNote(name));
const counterpoint = ['C5', 'A4', 'G4', 'B4', 'C5'].map((name) => parseNote(name));

checkSpecies(cantus, counterpoint, 1, majorKey(0)); // []
```

`Voicing.species` reads a voicing as the written counterpoint line and marks it against the given voice:

```ts
import { Voicing } from '@libraz/libcantus';

const counterpoint = Voicing.of([72, 69, 67, 71, 72]);

counterpoint.species(['C4', 'D4', 'E4', 'D4', 'C4'], 1, 'C major'); // []
```

The pitches are slots in time rather than voices in register — this and `Voicing.independence` are the only places a voicing is read as a line. Both lines are spelled by the mode before anything is judged, the cantus firmus included, so a cantus firmus given as MIDI pitches is written the way the counterpoint is. That matters: the rules that read letters — the augmented second, the diminished fourth — cannot be applied to two lines spelled by different rules, and a line the caller spelled by hand can be spelled by another.

The cantus firmus is one note per measure. The counterpoint is aligned by position rather than by written rhythm: the first four species have a fixed number of notes per measure, so the note count alone says where each note falls. A closing measure written as a single whole note is accepted as the convention it is.

The fifth species mixes note values, so it needs `opts.durations`, given in cantus-firmus notes. `opts.counterpointAbove` says which side the written voice is on; by default it is inferred from the mean pitch of each line.

Each species licenses different dissonances, and the checker applies the right one: none in the first, a passing dissonance on the weak half in the second and third, a prepared suspension on the downbeat in the fourth, both in the fifth.

Violations come back in the exercise's own time order rather than grouped by rule, so the first one reported is the first one heard and a student can be walked through them from the top of the page.

The third and fifth species also write two figures that quit a dissonance by leap, and both are accepted where they belong: the *nota cambiata* — a consonance, a dissonance stepped down onto, a leap of a third down onto a consonance, and a step back up — and the double neighbour, which steps to one side of a note, leaps a third across to the other, and steps back. Neither is licensed in the second species, whose half notes are not where the style writes them.

### The shape of the line

Beyond the intervals, `checkSpecies` judges the counterpoint as a melody and reports a `melodicShape` violation naming what went wrong in its rationale:

```ts
import { checkSpecies, majorKey, parseNote } from '@libraz/libcantus';

const cantus = ['C4', 'D4', 'E4', 'D4', 'C4'].map((name) => parseNote(name));
const counterpoint = ['C5', 'A4', 'C5', 'B4', 'C5'].map((name) => parseNote(name));

checkSpecies(cantus, counterpoint, 1, majorKey(0)).map((violation) => violation.kind); // ['melodicShape']
```

The counterpoint above touches C5 twice, so the line has no one high point to arch toward. The rules are: the highest note is reached once, counting a repetition in place as one arrival and leaving the closing note out; at most two leaps in a row go the same way, spanning at most an octave together; a leap of a sixth or wider is answered by a step in the other direction; a run of notes between two turning points does not outline a tritone; and the second and third species do not repeat a note, the closing measure excepted, where a repetition is the final being held.

These belong to the species exercise. `checkPartWriting` grades a chorale chord by chord, where a voice may leap as the harmony asks, and does not apply them.

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

`Voicing.independence` is the same measurement between two held lines, with `key` spelling both of them:

```ts
import { Voicing } from '@libraz/libcantus';

const lead = Voicing.of([72, 74, 76]);
const counter = Voicing.of([64, 65, 67]);

lead.independence(counter, { key: 'C major' }).motion.parallel; // 1
```

`motion` holds the share of moves in each category — contrary, oblique, similar, parallel — summing to 1. The harmony line above runs a sixth below the lead throughout and so comes out entirely parallel, which is not a violation of anything; it is a description of what was written. A slot where neither voice moves is not a move at all and is left out, so an accompaniment that mostly sits still can still report mostly contrary motion.

The report also carries `rhythmicComplementarity` (how often the counter attacks where the lead holds), `separation` (mean and closest distance), `crossings`, and `longestPerfectRun`. Together they are what distinguishes a second voice from a thickened first one. Use them to judge a generated counter-melody, or to show a student what their line is actually doing.

## What these checkers are not

They evaluate conventional voice-leading rules, not musical quality. An empty result means no rule was broken, and a violation does not by itself mean the passage is wrong: repertoire breaks these rules deliberately and often.

They also do not decide what the exercise meant. Given an ambiguous answer, `checkPartWriting` grades it against the chords it was passed. Choosing those chords is itself an analysis, and it belongs to the caller.
