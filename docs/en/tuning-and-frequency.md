# Tuning and frequency

Everything above the pitch layer reasons in twelve pitch classes, which is a deliberate scope choice for tonal theory. This module is the escape hatch for the questions that scope leaves out: actual frequencies, cents, equal temperaments other than twelve, and the acoustic ratios behind the tempered intervals.

Nothing here feeds back into harmonic analysis. A 19-EDO step index is not a pitch class, and `detectKey` will not read one.

## Frequencies

`TuningTable` is a reference pitch plus a number of equal divisions of the octave. Under twelve divisions a step index is an ordinary MIDI number, which is why `TWELVE_TET` is the default everywhere:

```ts
import { frequencyOf, nearestStep, stepOf, TWELVE_TET } from '@libraz/libcantus';

TWELVE_TET; // { refStep: 69, refFreq: 440, divisions: 12 }

frequencyOf(69); // 440
Math.round(frequencyOf(60) * 100) / 100; // 261.63
nearestStep(440); // 69
Math.round(stepOf(442) * 100) / 100; // 69.08
```

`nearestStep` rounds; `stepOf` does not. The rounding is what a note-name display wants and what a tuner display must not do — the fractional part is the whole point of an intonation reading.

A different concert pitch is a different reference frequency, not a transposition:

```ts
import { edo, frequencyOf } from '@libraz/libcantus';

const a442 = edo(12, 442);
frequencyOf(69, a442); // 442
```

## Cents

Cents are the log-scale unit that makes tuning differences comparable across registers. The four conversions cover the directions a host actually needs:

```ts
import { centsBetweenFreq, centsFromNearestStep, centsOfSteps, centsToRatio } from '@libraz/libcantus';

centsOfSteps(1); // 100
Math.round(centsBetweenFreq(440, 880)); // 1200
Math.round(centsFromNearestStep(442)); // 8
Math.round(440 * centsToRatio(1200)); // 880
```

`centsToRatio` is what applies a cents offset to a frequency, which is how a pitch-bend spec or a tuning-table entry gets turned into a sounding pitch. `stepsOfCents` goes the other way, from an interval in cents to a fractional step count.

## Equal temperaments other than twelve

`edo(n)` builds an `n`-division temperament. The step index stops being a MIDI number as soon as `n` is not 12, so a caller's own data model has to keep the two apart:

```ts
import { centsOfSteps, edo, frequencyOf } from '@libraz/libcantus';

const et19 = edo(19);
et19.divisions; // 19
Math.round(centsOfSteps(1, et19) * 100) / 100; // 63.16
Math.round(frequencyOf(69 + 19, et19)); // 880
```

Nineteen steps of a 19-EDO octave still span an octave — the reference step and the octave are fixed, and only the ladder between them changes.

## Just intonation

`JUST_RATIOS` gives five-limit ratios for the twelve interval classes above a unison, indexed by semitone class. `justDeviationCents` reports how far each tempered interval sits from its just counterpart:

```ts
import { JUST_RATIOS, justDeviationCents, ratioToCents } from '@libraz/libcantus';

JUST_RATIOS[7]; // [3, 2]
Math.round(ratioToCents(3, 2) * 1000) / 1000; // 701.955
Math.round(justDeviationCents(7) * 100) / 100; // 1.96
Math.round(justDeviationCents(4) * 100) / 100; // -13.69
```

A positive deviation means the just interval is wider than the tempered one. The tempered fifth is about two cents narrower than the just fifth; the tempered major third is about fourteen cents wider than the just third, which is the difference audible as beating in a sustained chord.

## Where this fits in an application

- **Tuner and intonation display**: `stepOf` for the exact position, `centsFromNearestStep` for the needle, `midiToNote` for the label.
- **Microtonal playback**: `frequencyOf` under a caller-built `TuningTable`, or `centsToRatio` to bend a twelve-tone pitch.
- **Synthesis and analysis bridges**: `nearestStep` to quantize a detected frequency into a pitch the rest of the library can read.
- **Documentation and teaching**: `justDeviationCents` to show why a tempered interval beats.

Converting a frequency into a MIDI pitch with `nearestStep` and then analyzing it is fine and normal. Going the other way — feeding a non-12 step index into chord or key analysis — will produce an answer, but not a meaningful one.
