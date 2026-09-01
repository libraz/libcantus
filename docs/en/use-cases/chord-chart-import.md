# Use case: importing a chord chart

A chord chart is text: symbols with a bar each, or several to a bar. Parsing them into chords, placing them in time, and realizing them as sound are three separate steps, and each one can fail differently.

The flow assumes chord symbols as strings and nothing else — no key, no durations, no notes. For the vocabulary — chord symbol, key, voicing, Roman numeral — see the [primer](../primer/index.md).

```ts
import { Chord, Key, Progression } from '@libraz/libcantus';

const chart = ['Dm7', 'G7', 'Cmaj7', 'A7(b9)'];

const parsed = chart.map((symbol) => Chord.tryParse(symbol));
const failures = chart.filter((_, index) => !parsed[index]?.ok);

failures; // []

const chords = parsed.flatMap((result) => (result.ok ? [result.value] : []));

// A chart says nothing about how long a chord sounds; a bar each is the importer's choice.
const timeline = new Progression(chords).timeline(4);

timeline.segments.length; // 4
timeline.totalBeats; // 16

// The cheapest key guess is the pitch classes of the chords, pooled:
Key.detectBest(chords.flatMap((chord) => chord.pitchClasses()))?.rootPc; // 7

const key = Key.major('C');
timeline.roman(key).map((entry) => entry.roman);
// ['ii7', 'V7', 'Imaj7', 'VI7b9']
```

## Parsing

`Chord.tryParse` reports a failure as a value, which is what a chart importer needs: one unrecognized symbol should not abort the file. Collect the failures, show them next to the line they came from, and import the rest.

The parser accepts alterations, additions, omissions, and slash basses, so a chord does not have to appear in a fixed list of names. What comes back is a `Chord` that carries its own questions — `symbol()`, `pitchClasses()`, `roman(key)` — and hands the plain object over as `chord.data` when the host stores chords as JSON.

## Inferring the key

A chart usually does not state its key, and `Key.detectBest` over the pooled pitch classes is the cheapest way to guess one. The example above shows the limit of that: an unweighted pool over `Dm7 G7 Cmaj7 A7(b9)` reports G rather than C. The pool is a seventeen-note histogram with every note counted once, and in it G is simply the most frequent pitch class — it sounds in three of the four chords, and nothing else sounds in more than two.

Two things improve the guess. Weight the histogram by how long each chord sounds, so a two-beat passing chord counts less than a chord held for a bar. And weight the tonic candidates by where they fall — a chord chart's last bar says more about the key than its third.

Show the result as a suggestion either way. A chart in A minor and one in C major share a pitch-class set, and only the music decides between them.

## Placement

Chord symbols carry no duration. The importer decides: one chord per bar, two per bar, or a split marked in the chart's own syntax. `Progression.timeline(beats)` covers the regular case by giving every chord the same length. Where the chart splits a bar, place each chord yourself with `Chord.span(startBeat)` and build the timeline from the spans:

```ts
import { Chord, Key, Timeline } from '@libraz/libcantus';

const key = Key.major('C');
const spans = [Chord.parse('Dm7').span(0), Chord.parse('G7').span(2), Chord.parse('Cmaj7').span(4)];

const timeline = Timeline.fromChords(spans, 8, key);

timeline.segments.map((segment) => [segment.startBeat, segment.endBeat]);
// [[0, 2], [2, 4], [4, 8]]
timeline.at(3)?.symbol(); // 'G7'
```

A timeline carries its key, so the questions asked of the timeline itself — `roman`, `cadences`, `reduce` — do not have to be told it a second time. A generator is the exception: it writes in the key its own `Composer` holds, and takes only the chords off the timeline.

## Realizing the chart

`Voicing.forChord` builds a comping voicing directly — no range search, and the style names the sound. `Progression.voice` is the other realization: one four-voice chord per symbol, with the leading smoothed from each to the next, for a chart that has to be sung or played in parts. A `Composer` writes a bass under the same timeline, in the key the composer itself was given:

```ts
import { Chord, Composer, Key, Progression, Voicing } from '@libraz/libcantus';

const key = Key.major('C');
const progression = new Progression(
  ['Dm7', 'G7', 'Cmaj7', 'A7(b9)'].map((symbol) => Chord.parse(symbol)),
  key,
);

const comping = progression.chords.map((chord) => Voicing.forChord(chord, { style: 'drop2' }));
comping[0]?.pitches; // [57, 62, 65, 72]

const voiced = progression.voice();
voiced[0]; // [50, 60, 65, 69]

const bass = Composer.of({ key, bpm: 96, seed: 3 }).bass(progression.timeline(4), {
  style: 'walking',
});
bass.notes.length; // 16
```

For voicings held to explicit ranges, see [Voicing](../voicing.md). For substitutions a user can choose from, `progression.substitute` realizes one in place; see [Reharmonization](../reharmonization.md).
