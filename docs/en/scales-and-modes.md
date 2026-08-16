# Scales and modes

A scale in this library is a twelve-bit mask plus a root pitch class, wrapped up as `KeyScale`. Bit `n` is set when the scale contains the pitch `n` semitones above its root, so a scale is a set rather than a list of names, and any subset of the twelve pitch classes is expressible.

```ts
import { majorKey, MAJOR_MASK, minorKey } from '@libraz/libcantus';

majorKey(0); // { rootPc: 0, modeMask12: MAJOR_MASK }
MAJOR_MASK; // 0b101010110101
minorKey(9).rootPc; // 9
```

That representation is why membership and degree questions are arithmetic rather than table lookups, and why a scale the library has never heard of still works everywhere a built-in one does.

## Built-in scales

`NAMED_SCALES` holds the Western vocabulary — the church modes, the minor forms, the symmetric scales, the pentatonics. `WORLD_SCALES` holds scales named in other traditions, and `SCALE_ALIASES` maps common alternative spellings onto them.

```ts
import { NAMED_SCALES, scaleByName, WORLD_SCALES } from '@libraz/libcantus';

Object.hasOwn(NAMED_SCALES, 'lydianDominant'); // true
Object.hasOwn(WORLD_SCALES, 'miyakoBushi'); // true

scaleByName('dorian', 2).rootPc; // 2
scaleByName('okinawan', 4).modeMask12 === scaleByName('ryukyu', 4).modeMask12; // true
```

The two tables are kept apart because they answer different questions. Chord-scale theory ranks candidates from `NAMED_SCALES`; a scale from `WORLD_SCALES` is a request for a specific sound, not a candidate to be scored. `resolveScaleName` and `requireScaleMask` resolve a name through the aliases when the mask itself is needed, and reject an unknown name rather than returning an empty scale — an empty result already means "no answer", so a typo must not be indistinguishable from one.

A scale that is in neither table is built from its offsets:

```ts
import { maskFromOffsets, scaleTonesInDegreeOrder } from '@libraz/libcantus';

const hexatonic = { rootPc: 0, modeMask12: maskFromOffsets([0, 3, 4, 7, 8, 11]) };
scaleTonesInDegreeOrder(hexatonic); // [0, 3, 4, 7, 8, 11]
```

## What the entries cover

An entry in either table is a set of pitch classes. `WORLD_SCALES` takes its names from traditions whose theory holds far more than a set, and the mask holds none of the rest.

A thāt is not a rāga. It has no ārohaṇa and avarohaṇa, no vādī and samvādī, no pakaḍ, so `todi` gives the pitch material rāga Todi draws on and nothing that would let you play the rāga:

```ts
import { scaleByName, scaleTonesInDegreeOrder } from '@libraz/libcantus';

scaleTonesInDegreeOrder(scaleByName('todi', 0)); // [0, 1, 3, 6, 7, 8, 11]
```

The other names work the same way. A maqām is assembled from ajnās that are transposed and exchanged as a phrase moves, and the five entries here name the pitch material of a maqām rather than that system. Japanese scales are described in Koizumi's tetrachord theory by the nuclear tones framing each tetrachord, so `miyakoBushi` and `minyo` differ by tetrachord type, a difference their pitch classes record without explaining.

Reach for these entries when a pitch set is what is wanted. Working with the modal system itself needs a model of that system, which this library does not have.

## Degrees and membership

```ts
import { diatonicPitchClasses, isScaleTone, majorKey, nearestScaleTone, pitchToScaleDegree } from '@libraz/libcantus';

const c = majorKey(0);

isScaleTone(64, c); // true
isScaleTone(61, c); // false
nearestScaleTone(61, c); // 60
pitchToScaleDegree(67, c); // 5
diatonicPitchClasses(c); // [0, 2, 4, 5, 7, 9, 11]
```

`pitchToScaleDegree` counts degrees within the scale, so it answers 5 for the fifth degree of a heptatonic scale and also for the fifth tone of a pentatonic one. `nearestScaleTone` is what a snap-to-scale editor wants; it moves the pitch, not the spelling.

`Key` asks the same four questions of the scale it holds:

```ts
import { Key } from '@libraz/libcantus';

const c = Key.major('C');

c.contains(64); // true
c.contains(61); // false
c.nearestTone(61); // 60
c.degreeOf(67); // 5
c.pitchClasses(); // [0, 2, 4, 5, 7, 9, 11]
```

`Key.degreeOf` answers `null` for a pitch outside the scale rather than the `-1` the function returns, so a degree read straight into a UI cannot be mistaken for the tonic.

## Which scales support functional harmony

Roman numerals, cadences, and harmonic function are conventions of common-practice tonality. Applied to a scale with no leading tone or no tertian triads, they produce labels that carry no meaning.

```ts
import { scaleSystemOf, supportsFunctionalHarmony } from '@libraz/libcantus';

scaleSystemOf('major'); // 'common-practice'
scaleSystemOf('dorian'); // 'modal'
scaleSystemOf('wholeTone'); // 'non-functional'

supportsFunctionalHarmony('major'); // true
supportsFunctionalHarmony('miyakoBushi'); // false
```

A `Key` answers for the scale it already holds, so nothing has to be named twice:

```ts
import { Key } from '@libraz/libcantus';

Key.major('C').system(); // 'common-practice'
Key.named('dorian', 'D').system(); // 'modal'
Key.named('wholeTone', 'C').system(); // 'non-functional'

Key.major('C').supportsFunctionalHarmony(); // true
Key.named('miyakoBushi', 'C').supportsFunctionalHarmony(); // false
```

`SCALE_SYSTEMS` sorts every built-in scale into one of three systems. Check `supportsFunctionalHarmony` before offering a Roman-numeral reading in a UI. For a whole-tone passage the correct response is that the analysis does not apply, rather than a numeral chosen by approximation.

## Chord–scale relationships

Given a chord, `chordScales` ranks the scales that contain it, best fit first. "Best" means fewest extra tones, with the idiomatic and heptatonic choices preferred among equals:

```ts
import { chordScales, makeChord } from '@libraz/libcantus';

chordScales(makeChord(0, 'maj7'))[0]; // { name: 'ionian', rootPc: 0 }
chordScales(makeChord(0, 'dom7'))[0]; // { name: 'mixolydian', rootPc: 0 }
```

Two questions follow from a chosen scale. An **available tension** is a non-chord scale tone that can be added as colour; an **avoid note** is a non-chord scale tone a semitone directly above a chord tone — or the third a suspension displaced — which clashes when sounded against it.

That rule says which tones may not be *sounded* against the chord, which is not the same question as which tones a line may not touch. `{ use: 'melodic' }` asks the second one: only the semitone above the root survives it, so the melodic answer is always a subset of the harmonic one.

```ts
import { availableTensions, avoidNotes, chordScaleReport, makeChord } from '@libraz/libcantus';

availableTensions(makeChord(0, 'maj7'), 'ionian'); // [2, 9]
avoidNotes(makeChord(0, 'maj7'), 'ionian'); // [5]
avoidNotes(makeChord(0, 'maj7'), 'ionian', { use: 'melodic' }); // []

const report = chordScaleReport(makeChord(0, 'dom7'), 1);
report[0]?.name; // 'mixolydian'
report[0]?.avoid; // []
report[0]?.passing; // [5]
report[0]?.tensions; // [2, 9]
```

`Chord` carries the same four questions, which is the form a chord already parsed from a chart is in:

```ts
import { Chord } from '@libraz/libcantus';

Chord.of('C', 'maj7').scales()[0]; // { name: 'ionian', rootPc: 0 }
Chord.of('C', 'maj7').tensions('ionian'); // [2, 9]
Chord.of('C', 'maj7').avoidNotes('ionian'); // [5]
Chord.of('C', 'maj7').avoidNotes('ionian', { use: 'melodic' }); // []

const entry = Chord.of('C', 'dom7').scaleReport(1)[0];
entry?.name; // 'mixolydian'
entry?.passing; // [5]
entry?.tensions; // [2, 9]
```

`chordScaleReport` is the three calls combined, ordered best fit first, with an optional limit. Each entry splits the scale tones the chord does not state three ways: `avoid` may not be played at all, `passing` may be passed through melodically but not sounded against the chord, and `tensions` may be added freely as colour. It is the shape a UI panel usually wants.

Availability also depends on what the chord is doing. Read on its own, a dominant seventh over the scale of its minor key offers nothing: its ♭9, 11 and ♭13 each sit a semitone above a chord tone. Heard as the dominant of that key, the ♭9 and ♭13 are the key's own tones and standard practice, so name the chord it resolves to:

```ts
import { availableTensions, makeChord } from '@libraz/libcantus';

availableTensions(makeChord(7, 'dom7'), 'phrygianDominant'); // []
availableTensions(makeChord(7, 'dom7'), 'phrygianDominant', { resolvesTo: makeChord(0, 'min') });
// [3, 8]
```

The natural eleventh stays an avoid note: the resolution makes the altered ninths and the flat thirteenth available, not every clash.

## Choosing scales across a progression

Picking each chord's best scale independently produces a line that jumps between scales for no audible reason. `scalesForChanges` chooses the whole path at once, trading a slightly looser fit on one chord for continuity across the sequence:

```ts
import { makeChord, scalesForChanges } from '@libraz/libcantus';

const changes = [makeChord(2, 'min7'), makeChord(7, 'dom7'), makeChord(0, 'maj7')];
scalesForChanges(changes).map((choice) => choice.scale.name);
// ['dorian', 'mixolydian', 'ionian']
```

The transition cost between adjacent choices is the number of pitch classes that differ, plus a small penalty for straying from a chord's own best fit. The minimum-cost path is returned, one choice per input chord in the original order.

## Spelling a scale

A mask has no letter names. `spellScale` assigns them from a spelled tonic, so the same mask reads correctly however its tonic is written:

```ts
import { majorKey, noteNames, scaleByName, spelledKeyOf, spellScale } from '@libraz/libcantus';

noteNames(spellScale(spelledKeyOf(majorKey(6)).tonic, majorKey(6)));
// ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F']

const miyako = scaleByName('miyakoBushi', 0);
noteNames(spellScale(spelledKeyOf(miyako).tonic, miyako)); // ['C', 'Db', 'F', 'G', 'Ab']
```

A `Key` already knows its spelled tonic, so the whole chain is one call — `Key.noteNames` for the names, `Key.spell` for the notes themselves:

```ts
import { Key } from '@libraz/libcantus';

Key.major('Gb').noteNames();
// ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F']

Key.named('miyakoBushi', 'C').noteNames(); // ['C', 'Db', 'F', 'G', 'Ab']
Key.major('Gb').spell()[0].name; // 'Gb'
```

`spelledKeyOf` picks the tonic spelling with the fewest accidentals: pitch class 1 in major comes out as Db rather than C#. Where the two spellings are equally far out — pitch class 6 is F# at six sharps and Gb at six flats — the flat side is taken. Pass an explicit tonic when the piece is written the other way.

A heptatonic scale gives every degree the next letter. A gapped scale gets one letter per tone wherever its pitch set allows it, and is spelled tone by tone on the side it leans towards where it does not — the blues scale has to name one letter twice however it is read.

See [Pitch and notation](pitch-and-notation.md) for the spelling rules this follows, and [Key relations and modulation](key-relations-and-modulation.md) for how a tonic spelling is chosen in the first place.
