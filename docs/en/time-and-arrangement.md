# Time and arrangement

## Meter and position

A `Meter` is one time signature and the positions it accents:

```ts
import { Meter } from '@libraz/libcantus';

const fourFour = Meter.parse('4/4');

fourFour.weightAt(0); // 3
fourFour.weightAt(2); // 2
fourFour.isStrongBeat(1); // false
fourFour.formatPosition(-1); // '0.4'
```

A piece that changes meter is described by a `MeterMap`, an array of `{ startBeat, ts }` changes, which is what every time-dependent analysis accepts. Passing one `TimeSignature` is shorthand for a map with one entry. Beat 0 is the downbeat; a pickup can begin at a negative beat. A `Score` carries its own map and reads positions through it:

```ts
import { Meter, Score } from '@libraz/libcantus';

const score = Score.empty({
  meters: [
    { startBeat: 0, ts: Meter.parse('4/4').data },
    { startBeat: 8, ts: Meter.parse('3/4').data },
  ],
});

score.meterAt(11).numerator; // 3
score.barAt(11).bar; // 3
```

The functions read the same map directly:

```ts
import { formatBarPosition, metricWeight, parseTimeSignature } from '@libraz/libcantus';

const meters = [
  { startBeat: 0, ts: parseTimeSignature('4/4') },
  { startBeat: 8, ts: parseTimeSignature('3/4') },
];

metricWeight(11, meters); // 3
metricWeight(12, meters); // 1
formatBarPosition(-1, parseTimeSignature('4/4')); // '0.4'
```

Metric weight runs from 0 (off-pulse) to 3 (downbeat) and is what onset placement, accent shaping, and phrase detection are built on. A meter change is respected from the beat it takes effect, so a piece is never read in the signature it opened in.

`resolveMeters` accepts either a single signature or a map, which is how every entry point that takes both is written. `meterAt`, `barIndexAt`, `barStartBeat`, `beatsPerBarAt`, `beatToBarPosition`, and `barPositionToBeat` cover the conversions between absolute beats and bar positions; `Meter` exposes the single-signature ones as `weightAt`, `isStrongBeat`, `barPositionAt`, and `formatPosition`, and `Score` the map-aware ones as `meterAt` and `barAt`.

Bar numbers come in two origins, and which one you get depends on whether you asked for a number or for a string. The numeric conversions are 0-based: `barIndexAt`, `beatToBarPosition`, `Meter.barPositionAt`, and `Score.barAt` all call the first full bar 0, which is what makes a pickup bar -1 and lets bar arithmetic run through it. The formatters are 1-based, the way a printed score is numbered: `formatBarPosition` and `Meter.formatPosition` render that same first bar as `1.1`, and the pickup as bar 0. So a UI that shows a number straight from `barAt` reads one lower than the position the library prints — add 1 to it, or format the beat with `formatBarPosition` instead of numbering it yourself.

## Compound, additive, and tuplet meters

A `Meter` answers what the bar is made of:

```ts
import { Meter } from '@libraz/libcantus';

const sixEight = Meter.parse('6/8');

sixEight.isCompound; // true
sixEight.beatsPerBar; // 3
sixEight.pulsesPerBar; // 2

Meter.of(9, 8, [3, 3, 3]).pulsesPerBar; // 3
Meter.of(9, 8, [2, 2, 2, 3]).pulsesPerBar; // 9

Meter.of(7, 8, [2, 2, 3]).format({ grouping: true }); // '2+2+3/8'
sixEight.tuplet(1, 3); // [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]
```

The same readings as functions over a plain signature:

```ts
import { beatsPerBar, isCompound, parseTimeSignature, pulsesPerBar, tuplet } from '@libraz/libcantus';

const sixEight = parseTimeSignature('6/8');

isCompound(sixEight); // true
beatsPerBar(sixEight); // 3
pulsesPerBar(sixEight); // 2

const compoundNine = { numerator: 9, denominator: 8, grouping: [3, 3, 3] };
const aksakNine = { numerator: 9, denominator: 8, grouping: [2, 2, 2, 3] };

pulsesPerBar(compoundNine); // 3
pulsesPerBar(aksakNine); // 9

tuplet(1, 3); // [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]
```

A compound signature groups its eighths into dotted pulses, so 6/8 has two pulses and three quarter-note beats. A `grouping` divides the bar into felt beats — 7/8 as `[2, 2, 3]`, 5/8 as `[3, 2]` — and its entries count main pulses, or denominator units where a compound numerator makes the two differ.

On a compound numerator the shape of the grouping picks the reading. Groups of nothing but threes spell the compound division itself, so 9/8 as `[3, 3, 3]` is the ordinary three dotted-quarter pulses, exactly as `[1, 1, 1]` or no grouping at all. Any other grouping summing to the numerator counts units and reads additively, so 9/8 as `[2, 2, 2, 3]` is nine quaver pulses grouped the way aksak meters are written.

`metricWeight` — `Meter.weightAt` on the class side — accents the head of each group, so 7/8 as `[2, 2, 3]` is felt as three beats rather than seven equal ones. A grouping whose groups are all the same length states the division the meter already has, so it accents nothing extra. `formatTimeSignature(ts, { grouping: true })` writes the additive form — `'2+2+3/8'` — which `parseTimeSignature` reads back; a grouping counted in pulses has no additive spelling and falls back to the plain `'9/8'`, which is the same bar.

`tuplet` divides a span into equal parts, which is the placement side of a tuplet; the notation side — the `{ actual, normal }` ratio a renderer prints — comes from `beatsToDuration`.

## Tempo and duration

A `Tempo` is one marking and the conversions it settles; a `Duration` is one written note value and the beats it lasts:

```ts
import { Duration, Tempo } from '@libraz/libcantus';

const tempo = Tempo.of(120);

tempo.secondsAt(8); // 4
tempo.ticksAt(2, 480); // 960

Duration.ofBeats(1 / 3).toString(); // 'eighth 3:2'
Duration.tieChain(5).map((value) => value.toString()); // ['whole', 'quarter']
Duration.of('quarter', 1).beats(); // 1.5
```

One marking holds until the next one, so a `Tempo` is a single constant. A piece that changes tempo is described by a `TempoMap`: piecewise constant, integrated across changes, and read by the functions directly — or by a `Score`, through `secondsAt`, against the map it carries. The duration helpers return notation-oriented values as well as seconds or ticks:

```ts
import { beatsToDuration, beatsToSeconds, beatsToTiedDurations } from '@libraz/libcantus';

beatsToSeconds(8, [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }]); // 6
beatsToDuration(1 / 3); // { base: 'eighth', dots: 0, tuplet: { actual: 3, normal: 2 } }
beatsToTiedDurations(5); // [{ base: 'whole', dots: 0 }, { base: 'quarter', dots: 0 }]
```

`beatsToDuration` answers with a single note value when one exists; `beatsToTiedDurations` splits a length that needs a tie — `Duration.ofBeats` and `Duration.tieChain` are the same pair. `durationToBeats` is the inverse, and `NOTE_VALUES` lists the base values. `beatsToTicks` and `ticksToBeats` place the same beat values on a PPQ grid; no global modulo is assumed when the meter changes.

## Arrangement analysis

An arrangement is a set of tracks with roles and note events. An `Arrangement` holds them together with the reading of how they fit, and answers with a class where it has one — `timeline()` hands back a `Timeline`, `track(name)` a `Score`:

```ts
import { Arrangement } from '@libraz/libcantus';

const arrangement = Arrangement.of([
  {
    name: 'keys',
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
  {
    name: 'bass',
    role: 'bass',
    notes: [{ pitch: 36, startBeat: 0, durationBeat: 4 }],
  },
]);

arrangement.tracks.length; // 2
arrangement.timeline().at(0)?.symbol(); // 'C'
arrangement.track('bass')?.totalBeats; // 4
```

`analyzeArrangement` is the reading on its own, returning the inferred `timeline`, the `keys` it was read against and the `prevailingKey`, the `cadences`, the per-track analysis, and the `conflicts` between notes and the current harmony:

```ts
import { analyzeArrangement } from '@libraz/libcantus';

const report = analyzeArrangement([
  {
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
  {
    role: 'bass',
    notes: [{ pitch: 36, startBeat: 0, durationBeat: 4 }],
  },
]);

report.tracks.length; // 2
report.timeline.segments.length >= 1; // true
```

A track's `role` is a label carried through to the report, not a switch over the analysis. Only `drums` changes what is inferred: its pitches select instruments rather than naming harmony, so a percussion track is left out of chord and key inference and out of every voice-leading comparison. `melody`, `harmony`, `bass` and `other` all take part in exactly the same way — the harmony is inferred from every pitched track pooled together, which is robust when roles are absent or a track doubles the harmony — and a track left unlabelled reports `other` rather than a guess.

Naming the tracks the chords come from is what `harmonyTracks` does. Pass the indices of the tracks that carry the harmony, and the remaining pitched tracks are analyzed against it without contributing to it — the setting is spelled the same way on both sides:

```ts
import { type ArrangementTrack, Arrangement, analyzeArrangement } from '@libraz/libcantus';

const tracks: ArrangementTrack[] = [
  { role: 'melody', notes: [{ pitch: 70, startBeat: 0, durationBeat: 4 }] },
  {
    role: 'harmony',
    notes: [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 0, durationBeat: 4 },
    ],
  },
];

// Pooled, the melody's Bb reads as the seventh of the chord under it.
Arrangement.of(tracks).timeline().at(0)?.symbol(); // 'C7'
Arrangement.of(tracks, { harmonyTracks: [1] }).timeline().at(0)?.symbol(); // 'C'

analyzeArrangement(tracks).timeline.segments[0]?.chord.quality; // 'dom7'
analyzeArrangement(tracks, { harmonyTracks: [1] }).timeline.segments[0]?.chord.quality; // 'maj'
```

`conflicts` reports notes that disagree with the harmony sounding under them, which is what an arrangement warning panel shows; it is a property on an `Arrangement` and a field of the report. `tensionCurve` and `tensionCurveFrom` reduce the report to a curve over time, as `Arrangement.tension` does.

## Editing sessions

`Arrangement.update` replaces the notes of one or more tracks and hands back a new arrangement. The analysis is not made again from nothing: only what the edit can reach is recomputed, falling back to a full pass when an incremental result cannot be trusted. The arrangement it was called on is unchanged, which is what an undo stack needs:

```ts
import { Arrangement } from '@libraz/libcantus';

const arrangement = Arrangement.of([
  { name: 'lead', notes: [{ pitch: 60, startBeat: 0, durationBeat: 4 }] },
]);

const edited = arrangement.update([
  { trackIndex: 0, notes: [{ pitch: 62, startBeat: 0, durationBeat: 4 }] },
]);

edited.tracks[0]?.notes[0]?.pitch; // 62
arrangement.tracks[0]?.notes[0]?.pitch; // 60
```

`createArrangementSession` exposes the same machinery as a handle the host holds itself: each `update` returns a new session, and the previous one stays valid. See [Performance](performance.md).

## Form and melody around time

`phrasesFromTimeline`, `hypermeter`, and `sectionsFromNotes` use the same beat model to find phrases and sections; a `Score` asks for them as `phrases()`, `hypermeter()`, and `sections()`, against the meter map it already carries. `harmonizeMelody` classifies passing and neighbor tones before selecting chords, so a non-chord tone does not force the whole harmony by itself.

Provide the correct meter map wherever one is known. Bar positions, hypermeter, and metric weight all follow from it, and an analysis run in the wrong signature will be wrong in a way that looks plausible.
