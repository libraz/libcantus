# Voicing

The musical vocabulary this page assumes — voice, register, spacing, doubling — is taught in [the primer's page on voices](primer/voices.md).

Voicing turns a chord — a root and a set of intervals — into actual pitches for actual voices. Two different questions hide inside that, and each has an answer of its own.

- `voiceChord` and `voiceProgression` **search**: given per-voice ranges, they find the arrangement that satisfies the constraints and moves least from the previous chord. This is the SATB case — four voices named soprano, alto, tenor and bass, each with a compass of its own.
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
| `maxSpacing` | Largest gap in semitones between adjacent voices. Defaults to 12, with the bass–tenor pair allowed an octave more. |
| `key` | Enables the rules that need a tonic: the leading tone is neither doubled nor left unresolved. |
| `maxCandidates` | How many candidate voicings are evaluated for one chord. Defaults to 4000. |
| `budget` | How many chords `voiceProgression` will voice at all. |

`maxSpacing` binds every adjacent pair, the lowest two included: the bass–tenor pair is allowed `maxSpacing + 12` rather than left unconstrained, which is what keeps the bass from being voiced arbitrarily far under a stack that is itself in range. The part-writing checker draws that line elsewhere and exempts the bass–tenor pair outright, so the two are not the same rule; see [Counterpoint and part-writing](counterpoint-and-part-writing.md).

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

`voiceLeadingCost` is the total semitone movement between two voicings, and nothing else. It is exposed so a host can rank its own candidates, show why one voicing was preferred, or refuse a suggestion that moves too far. The penalties for a direct fifth or octave belong to the voicing search, which weighs them while choosing, so a low cost says the voices moved little rather than that the motion is clean — `checkPartWriting` is what answers that.

`Voicing.next` and `Voicing.costTo` are the same two calls on a voicing the host is holding:

```ts
import { Voicing } from '@libraz/libcantus';

const sounding = Voicing.of([48, 60, 64, 67]);
const moved = sounding.next('F', { key: 'C major' });

moved.pitches; // [53, 60, 65, 69]
sounding.costTo(moved); // 8
```

Pass `previousChord` whenever you have the chord being left, not only when it carried a seventh. Three rules are read from that chord — a chordal seventh's resolution, a leading tone's resolution, and the cross relation between the two chords — and none of them is scored without it, because a voicing does not say what it was written on. All three are then scored exactly as `voiceProgression` scores them, which is what keeps the generator and `checkPartWriting` agreeing about the same pair.

## Styled voicings

`voiceChordStyled` builds a stack rather than searching for one. The style names the transformation applied to a close-position stack:

| Style | What it does |
| --- | --- |
| `close` | Chord tones stacked from the bass, no gaps. |
| `drop2` | The second voice from the top dropped an octave, which puts that voice in the bass. Takes at least three voices. |
| `drop3` | The third voice from the top dropped an octave. Takes at least four voices. |
| `shell` | The root plus the guide tones — the third and the seventh, the two that fix the chord's quality. A sixth chord keeps its sixth in place of the seventh, and a triad, having neither, keeps its fifth. |
| `rootless` | Root omitted, keeping third, fifth, seventh, and tensions. |

```ts
import { voiceChordStyled } from '@libraz/libcantus';

voiceChordStyled('Dm7'); // [62, 65, 69, 72]
voiceChordStyled('Dm7', { style: 'drop2' }); // [57, 62, 65, 72]
voiceChordStyled('Dm7', { style: 'shell' }); // [62, 65, 72]
voiceChordStyled('Dm7', { style: 'rootless' }); // [65, 69, 72]
```

`Voicing.forChord` is the same builder, taking the symbol directly:

```ts
import { Voicing } from '@libraz/libcantus';

Voicing.forChord('Dm7', { style: 'drop2' }).pitches; // [57, 62, 65, 72]
Voicing.forChord('D', { style: 'shell' }).pitches; // [62, 66, 69]
Voicing.forChord('C6', { style: 'shell' }).pitches; // [60, 64, 69]
Voicing.forChord('Dm7', { style: 'drop2', rootless: true }).pitches; // [57, 65, 72]
Voicing.forChord('Dm7', { topNote: 5 }).pitches; // [69, 72, 74, 77]
Voicing.forChord('Dm7', { topNote: 6 }).pitches; // [69, 72, 74, 77]
Voicing.forChord('C/E', { style: 'drop2' }).pitches; // [52, 60, 67]
```

A drop lowers one voice under the rest, so that voice is the voicing's bass — which is what tells the drop-2 voicings of one chord apart. A slash bass therefore names the voice to drop: `C/E` as a drop-2 is the drop-2 whose bass is E, not a first-inversion stack with E pushed below the fifth already dropped there, which would leave a hole wider than an octave in the middle of it. A bass the chord does not contain is no voice of the stack, so it keeps the bottom and the drop happens above it.

A chord with fewer voices than its drop asks for is voiced in close position. The third voice from the top of a triad is its bottom one, and lowering that opens nothing: it leaves the two voices above it more than an octave up. A slash bass the chord does not contain is not counted among the voices either, since it sounds under the stack rather than in it.

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
