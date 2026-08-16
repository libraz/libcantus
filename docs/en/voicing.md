# Voicing

Voicing turns a chord — a root and a set of intervals — into actual pitches for actual voices. Two different questions hide inside that, and each has an answer of its own.

- `voiceChord` and `voiceProgression` **search**: given per-voice ranges, they find the arrangement that satisfies the constraints and moves least from the previous chord. This is the SATB case.
- `voiceChordStyled` **builds**: it stacks the chord tones in a named style at a named octave. This is the lead-sheet and comping case.

Both answers are also on the `Voicing` class, which holds one set of sounding pitches: `Voicing.satb` searches, `Voicing.forChord` builds, and every other question on this page — the next voicing, the cost of getting there, the spelling — is a method on the pitches it already holds. The class takes a chord as a symbol and a key as a name, so nothing has to be built up first.

## Searching for a voicing

```ts
import { makeChord, SATB_RANGES, voiceChord } from '@libraz/libcantus';

SATB_RANGES.length; // 4
SATB_RANGES[0]; // { min: 40, max: 60 }

voiceChord(makeChord(0, 'maj')); // [48, 60, 64, 67]
voiceChord(makeChord(0, 'maj'), { voices: 3 }).length; // 3
```

The class runs the same search from a chord symbol, and carries the ranges as `Voicing.satbRanges`:

```ts
import { Voicing } from '@libraz/libcantus';

Voicing.satbRanges.length; // 4
Voicing.satbRanges[0]; // { min: 40, max: 60 }

Voicing.satb('C').pitches; // [48, 60, 64, 67]
Voicing.satb('C', { voices: 3 }).pitches.length; // 3
Voicing.satb('G7', { key: 'C major' }).pitches; // [55, 62, 65, 71]
```

Four voices use `SATB_RANGES` — bass E2–C4, tenor C3–G4, alto G3–D5, soprano C4–G5. Any other count gets evenly spaced ranges across roughly the same compass, because there is no conventional four-part answer to "voice this for five".

The options that shape the search:

| Option | Effect |
| --- | --- |
| `voices` | How many voices, when no explicit ranges are given. |
| `ranges` | Explicit per-voice ranges, ascending. Takes precedence over `voices`. |
| `maxSpacing` | Largest gap in semitones between adjacent upper voices. Defaults to 12. |
| `key` | Enables the rules that need a tonic: the leading tone is neither doubled nor left unresolved. |
| `maxCandidates` | How many candidate voicings are evaluated for one chord. Defaults to 4000. |
| `budget` | How many chords `voiceProgression` will voice at all. |

Supplying `key` changes the answer, not just the checking. Without it the search works from chord structure and voice-leading distance alone:

```ts
import { majorKey, makeChord, voiceProgression } from '@libraz/libcantus';

const key = majorKey(0);
const progression = [makeChord(7, 'dom7'), makeChord(0, 'maj')];

voiceProgression(progression, { key }); // [[55, 62, 65, 71], [48, 60, 64, 72]]
```

`voiceProgression` voices the sequence as a whole: each chord is chosen for how well it continues the previous one, so a progression is not the same as voicing each chord independently. The cost is linear in the length of the progression, because the search per chord is bounded internally.

When there is genuinely no answer — a range that contains no chord tone, ranges too narrow to hold the voices — the result is a `NoSolutionError` rather than a compromise. See [Errors and validation](errors-and-validation.md) for how to tell that apart from bad input.

## Continuing from an existing voicing

`nextVoicing` takes the chord a host is currently sounding and finds the next one, which is what an interactive editor needs:

```ts
import { majorKey, makeChord, nextVoicing, voiceLeadingCost } from '@libraz/libcantus';

const current = [48, 60, 64, 67];
const next = nextVoicing(current, makeChord(5, 'maj'), { key: majorKey(0) });

next; // [53, 60, 65, 69]
voiceLeadingCost(current, next); // 8
```

`voiceLeadingCost` is the total semitone movement between two voicings. It is exposed so a host can rank its own candidates, show why one voicing was preferred, or refuse a suggestion that moves too far.

`Voicing.next` and `Voicing.costTo` are the same two calls on a voicing the host is holding:

```ts
import { Voicing } from '@libraz/libcantus';

const sounding = Voicing.of([48, 60, 64, 67]);
const moved = sounding.next('F', { key: 'C major' });

moved.pitches; // [53, 60, 65, 69]
sounding.costTo(moved); // 8
```

Pass `previousChord` alongside `key` when the chord being left had a seventh: chordal-seventh resolution is then scored exactly as `voiceProgression` scores it.

## Styled voicings

`voiceChordStyled` builds a stack rather than searching for one. The style names the transformation applied to a close-position stack:

| Style | What it does |
| --- | --- |
| `close` | Chord tones stacked from the bass, no gaps. |
| `drop2` | The second voice from the top dropped an octave. |
| `drop3` | The third voice from the top dropped an octave. |
| `shell` | Root, third, and seventh — the guide tones. A sixth chord keeps its sixth in place of the seventh, and a triad, having neither, keeps its fifth. |
| `rootless` | Root omitted, keeping third, fifth, seventh, and tensions. |

```ts
import { parseChordSymbol, voiceChordStyled } from '@libraz/libcantus';

const dm7 = parseChordSymbol('Dm7');

voiceChordStyled(dm7); // [62, 65, 69, 72]
voiceChordStyled(dm7, { style: 'drop2' }); // [57, 62, 65, 72]
voiceChordStyled(dm7, { style: 'shell' }); // [62, 65, 72]
voiceChordStyled(dm7, { style: 'rootless' }); // [65, 69, 72]
```

`Voicing.forChord` is the same builder, taking the symbol directly:

```ts
import { Voicing } from '@libraz/libcantus';

Voicing.forChord('Dm7', { style: 'drop2' }).pitches; // [57, 62, 65, 72]
Voicing.forChord('D', { style: 'shell' }).pitches; // [62, 66, 69]
Voicing.forChord('Dm7', { style: 'drop2', rootless: true }).pitches; // [57, 65, 72]
Voicing.forChord('Dm7', { topNote: 5 }).pitches; // [69, 72, 74, 77]
Voicing.forChord('Dm7', { topNote: 6 }).pitches; // [69, 72, 74, 77]
```

`octave` sets where the stack starts, in scientific pitch notation — octave 4 puts the bass near middle C.

`topNote` rotates the stack so the highest voice lands on a given pitch class, which is how a comping part is kept under a melody. A pitch class the chord does not contain is not refused: the stack is rotated to the nearest chord tone instead, so asking for F-sharp over `Dm7` gives the same voicing as asking for F, as the last two lines above show. Ask for a chord tone, or read the top of the result back before trusting it.

`rootless` is both a style and an option. As an option it drops the root under any style — `{ style: 'drop2', rootless: true }` is a drop-2 for a left hand over a bass player — and the `rootless` style is that option over a close stack. An explicit slash bass is kept either way, since a slash bass is a structural requirement rather than a doubling of the root.

Every returned pitch is a valid MIDI number: a stack that would run off either end of 0..127 is rejected rather than voiced out of range.

## Spelling a voicing

Voicings come back as MIDI pitches. To show them as notation, spell them against the chord and key:

```ts
import { majorKey, makeChord, noteNames, spellVoicing } from '@libraz/libcantus';

noteNames(spellVoicing([50, 57, 66, 69], makeChord(2, 'maj'), majorKey(0)));
// ['D3', 'A3', 'F#4', 'A4']
```

`Voicing.spell` is the same call on a held voicing, and returns `Note` values rather than plain data:

```ts
import { Voicing } from '@libraz/libcantus';

Voicing.of([50, 57, 66, 69]).spell('C major', 'D').map((note) => note.name);
// ['D3', 'A3', 'F#4', 'A4']
```

The third of D spells F-sharp in C major, not G-flat. The chord is what supplies that evidence, so passing the key alone spells by the key alone. Spelling is also the input format for the part-writing checker — see [Counterpoint and part-writing](counterpoint-and-part-writing.md).

## Choosing between the two

Use the search when the constraint is a set of voices with ranges: choral writing, string quartets, exercises, anything where "who plays what" is fixed and the answer has to fit.

Use the styled builder when the constraint is a texture: a piano comp, a guitar chart, a pad. There is no range search to run, the result is instant, and the style names the sound directly.

A host that does both usually voices the harmony with `voiceProgression` and then re-voices a keyboard part with `voiceChordStyled` over the same chords.
