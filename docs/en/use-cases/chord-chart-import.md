# Use case: importing a chord chart

A chord chart is text: symbols with a bar each, or several to a bar. Parsing them into chords, placing them in time, and realizing them as sound are three separate steps, and each one can fail differently.

```ts
import {
  chordFromSpan,
  chordTimelineFromChords,
  chordPitchClasses,
  chordToRoman,
  detectKey,
  majorKey,
  tryParseChordSymbol,
  voiceChordStyled,
} from '@libraz/libcantus';

const chart = ['Dm7', 'G7', 'Cmaj7', 'A7(b9)'];

const parsed = chart.map((symbol) => tryParseChordSymbol(symbol));
const failures = chart.filter((_, index) => !parsed[index]?.ok);

failures; // []

const chords = parsed.flatMap((result) => (result.ok ? [result.value] : []));
const spans = chords.map((chord, bar) => ({
  rootPc: chord.rootPc,
  quality: chord.quality,
  startBeat: bar * 4,
}));

const timeline = chordTimelineFromChords(spans, chart.length * 4);
const guessed = detectKey(chords.flatMap((chord) => chordPitchClasses(chord)))[0]?.key;

timeline.segments.length; // 4
guessed?.rootPc; // 7

const key = majorKey(0);
timeline.segments.map((segment) => chordToRoman(segment.chord, key));
// ['ii7', 'V7', 'Imaj7', 'VI7b9']

const voicings = spans.map((span) => voiceChordStyled(chordFromSpan(span), { style: 'drop2' }));
voicings.length; // 4
```

## Parsing

`tryParseChordSymbol` reports a failure as a value, which is what a chart importer needs: one unrecognized symbol should not abort the file. Collect the failures, show them next to the line they came from, and import the rest.

The parser accepts alterations, additions, omissions, and slash basses, so a chord does not have to appear in a fixed list of names. `Chord.tryParse` is the class-API equivalent.

## Inferring the key

A chart usually does not state its key, and pooling the chords' pitch classes is the cheapest way to guess one. The example above shows the limit of that: an unweighted pool over `Dm7 G7 Cmaj7 A7(b9)` reports G rather than C, because the raised C-sharp of the A7 outweighs four bars of evidence in a fourteen-note histogram.

Two things improve the guess. Weight the histogram by how long each chord sounds, so a two-beat passing chord counts less than a chord held for a bar. And weight the tonic candidates by where they fall — a chord chart's last bar says more about the key than its third.

Show the result as a suggestion either way. A chart in A minor and one in C major share a pitch-class set, and only the music decides between them.

## Placement

Chord symbols carry no duration. The importer decides: one chord per bar, two per bar, or a split marked in the chart's own syntax. `chordTimelineFromChords` takes the placed spans and the total length, and produces the timeline every downstream function expects.

## Realizing the chart

`voiceChordStyled` builds a comping voicing directly — no range search, and the style names the sound. For a chart that has to be sung or played in four parts, use `voiceProgression` with ranges instead; see [Voicing](../voicing.md).

`generateBassLine` writes a bass over `timeline.segments`, and `chordToRoman` labels each chord against the inferred key. For substitutions a user can choose from, see [Reharmonization](../reharmonization.md).
