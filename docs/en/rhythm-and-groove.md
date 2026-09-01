# Rhythm and groove

Rhythm is handled as three separable steps: choose where the onsets go, turn those onsets into note events, and then deviate from the grid. Keeping them apart is what lets a host regenerate the feel without regenerating the part.

The beat, the bar and the time signature are the units this page counts in; [the rhythm and meter primer](primer/rhythm-and-meter.md) covers them for a reader with no musical training.

## Generating onsets

A `Rhythm` is a pattern of onsets together with the meter they are counted in. It places them on a grid, weighting each slot by its metric strength, and reshapes a pattern without the meter having to travel beside it — thinning, syncopating and deforming all rank the onsets by the pattern's own meter, so a pattern in 3/4 keeps its three-beat downbeats and one in 6/8 its dotted-quarter pulses:

```ts
import { parseTimeSignature, Rhythm } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const sparse = Rhythm.generate(ts, { bars: 2, ctx: { seed: 42, complexity: { rhythmic: 0.2 } } });
const dense = Rhythm.generate(ts, { bars: 2, ctx: { seed: 42, complexity: { rhythmic: 0.9 } } });

sparse.events.length <= dense.events.length; // true
dense.density() >= sparse.density(); // true
sparse.syncopate(0.6, { seed: 42 }).events.length >= sparse.events.length; // true
sparse.thin(0.5).events.length <= sparse.events.length; // true
```

`thin`, `syncopate`, `doubleTime`, `halfTime`, `ornamentBy`, and `deform` each hand back a new pattern, so a chain of them leaves the one in hand untouched; `withinCeiling` says whether a player at the context's difficulty sustains it at the context's tempo.

`Rhythm.of` wraps onsets a host already holds, and the meter is a required argument rather than an assumed 4/4:

```ts
import { Rhythm } from '@libraz/libcantus';

const pattern = Rhythm.of(
  [
    { position: 0, duration: 1.5 },
    { position: 1.5, duration: 1.5 },
  ],
  '6/8',
);

pattern.ts.numerator; // 6
pattern.events.length; // 2
```

A 6/8 pattern read as 4/4 answers every metric question — which positions are strong, where the bars fall, how dense it is — on the wrong pulse, and nothing downstream can tell that reading from the one the caller meant. `Rhythm.generate` and `generateRhythm` ask for the meter for the same reason.

`generateRhythm` produces the same onsets as a bare array, and `rhythmDensity` measures one:

```ts
import { generateRhythm, parseTimeSignature, rhythmDensity } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const sparse = generateRhythm(ts, { ctx: { seed: 42, complexity: { rhythmic: 0.2 } }, bars: 2 });
const dense = generateRhythm(ts, { ctx: { seed: 42, complexity: { rhythmic: 0.9 } }, bars: 2 });

sparse.length <= dense.length; // true
rhythmDensity(dense, ts) >= rhythmDensity(sparse, ts); // true
```

`subdivision` is the grid resolution in steps per quarter-note beat: 2 is an eighth-note grid, 4 a sixteenth, 3 an eighth-note triplet. `ctx.complexity.rhythmic` scales the per-slot probability; it defaults to 0.5, and a value outside [0, 1] is rejected rather than clamped. Every bar's downbeat — its first beat — is forced to be an onset whatever the seed and however low the dial goes, so the pulse of a generated pattern never rests on a draw.

`onsetWeightCurve` exposes the weighting itself — the base probability for a metric weight from 0 (off-pulse) to 3 (downbeat) — for a host building its own placement:

```ts
import { onsetWeightCurve } from '@libraz/libcantus';

onsetWeightCurve(3) > onsetWeightCurve(0); // true
```

## From onsets to notes

A rhythm carries position and length but no pitch. Giving it one turns it into a `Score`, which is where it reaches the rest of the library:

```ts
import { parseTimeSignature, Rhythm } from '@libraz/libcantus';

const snare = Rhythm.generate(parseTimeSignature('4/4'), { bars: 1, ctx: { seed: 3 } }).toScore(38);

snare.notes.every((note) => note.pitch === 38); // true
```

`RhythmEvent` values are that same pattern as plain data, and `rhythmToNoteEvents` attaches the pitch:

```ts
import { generateRhythm, parseTimeSignature, rhythmToNoteEvents } from '@libraz/libcantus';

const rhythm = generateRhythm(parseTimeSignature('4/4'), { ctx: { seed: 3 }, bars: 1 });
const notes = rhythmToNoteEvents(rhythm, 38);

rhythm[0]; // { position: 0, duration: 1 }
notes.every((note) => note.pitch === 38); // true
```

A `RhythmEvent` names its fields `position` and `duration`, not the `startBeat` and `durationBeat` a `NoteEvent` carries: a rhythm is not yet a note, and the two shapes are told apart by the names. Both are counted in quarter-note beats, and a duration runs to the next onset. `rhythmToNoteEvents` gives every note a velocity of 96 unless the call names one.

That separation is deliberate: a rhythm can be reused across pitches, and a melodic generator can borrow a rhythm without borrowing its notes.

## Humanizing

Humanizing moves events off the grid and shapes their velocities by metric position. It returns a new score, so the quantized source stays intact:

```ts
import { Score } from '@libraz/libcantus';

const quantized = Score.of([
  { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 80 },
  { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 80 },
]);

const played = quantized.humanize({ ctx: { seed: 1 }, timing: 0.03 });

played.notes.length; // 2
quantized.notes[0]?.startBeat; // 0
```

`humanize` is the same pass over an array of note events, and takes the same options:

```ts
import { humanize } from '@libraz/libcantus';

const quantized = [
  { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 80 },
  { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 80 },
];

const played = humanize(quantized, { ctx: { seed: 1 }, timing: 0.03 });
const doubled = humanize(quantized, { ctx: { seed: 1 }, timing: 0.03, part: 'double' });

played.length; // 2
played[0]?.startBeat === doubled[0]?.startBeat; // false
quantized[0]?.startBeat; // 0
```

| Option | Meaning |
| --- | --- |
| `timing` | Maximum jitter in quarter-note beats, applied as ±. Defaults to 0.02. |
| `velocity` | Maximum velocity jitter in MIDI units, applied as ±. Defaults to 8. |
| `accent` | How much louder strong beats get, in MIDI units. Defaults to 12. |
| `baseVelocity` | Velocity assumed for events that carry none. Defaults to 80. |
| `ts` | The signature the metric accents are derived from. Defaults to 4/4. |
| `part` | The name this call draws under. Defaults to `humanize`. |

A score humanizes against its own meter, so `ts` is the option a bare array needs and a score does not. Events with a zero or negative duration never sound and are dropped, so the result can be shorter than the input.

`part` is what keeps two lines apart. The jitter is drawn by position, so two parts humanized from one context under the same name get the identical nudge wherever they share a position and a pitch — which is exactly what a doubled line does not want, since the two copies then move together and stay as rigid against each other as they were. Name each part and they drift independently.

## Groove templates

A groove template is a per-bar grid of timing and velocity deviations, captured from a performance. Extract it from playing that carries the intended feel, then impose it on material that does not. `Score.grooveTemplate` reads the feel of a score against the meter the score already carries, and `Score.groove` lays it over another:

```ts
import { parseTimeSignature, Score } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const performed = Score.of(
  [
    { pitch: 36, startBeat: 0.02, durationBeat: 1, velocity: 100 },
    { pitch: 38, startBeat: 1.06, durationBeat: 1, velocity: 70 },
  ],
  { meters: ts },
);
const template = performed.grooveTemplate(4);

template.subdivision; // 4
template.slotsPerBar; // 16

const stiff = Score.of(
  [
    { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 90 },
    { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 90 },
  ],
  { meters: ts },
);

stiff.groove(template).notes.length; // 2
```

`extractGrooveTemplate` and `applyGrooveTemplate` are the same two steps over note events, with the meter named at each call:

```ts
import { applyGrooveTemplate, extractGrooveTemplate, parseTimeSignature } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');
const template = extractGrooveTemplate(
  [
    { pitch: 36, startBeat: 0.02, durationBeat: 1, velocity: 100 },
    { pitch: 38, startBeat: 1.06, durationBeat: 1, velocity: 70 },
  ],
  ts,
  4,
);

const stiff = [
  { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 90 },
  { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 90 },
];
const grooved = applyGrooveTemplate(stiff, template, ts);

grooved.length; // 2
```

The subdivision is the last argument of both `extractGrooveTemplate` and `Score.grooveTemplate`, in grid steps per quarter-note beat, and it defaults to 4 — a sixteenth-note grid, which is where the deviations a template records are audible.

Each slot holds the average offset from the grid and the average velocity of the events that landed on it. A velocity of `null` means no event with a velocity landed there, which is not the same as a velocity of zero — that distinction is why the field is nullable.

An extracted template records the time signature it was extracted under, and the apply-time meter then has to match it. A 4/4 groove laid over 3/4 would align its per-bar grid against the wrong bar length and drift without reporting anything, so that mismatch is rejected. The `ts` field is optional, though: a template built by hand without one carries nothing to check against and is applied under whatever meter the call names.

## Drums

A drum part is a full kit rather than a single line. Style, section, and role together decide the vocabulary, and a composer supplies the meter, the tempo and the dials:

```ts
import { Composer } from '@libraz/libcantus';

const composer = Composer.of({
  bpm: 96,
  seed: 11,
  complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 },
});
const pattern = composer.drums({ bars: 4, style: 'funk', section: 'chorus', fills: true });

pattern.notes.length > 0; // true
pattern.notes.every((hit) => hit.durationBeat > 0); // true
```

`generateDrums` writes the same kit part and hands back `DrumHit[]` rather than a score:

```ts
import { generateDrums } from '@libraz/libcantus';

const pattern = generateDrums({
  bars: 4,
  style: 'funk',
  section: 'chorus',
  fills: true,
  ctx: { seed: 11, bpm: 96, complexity: { rhythmic: 0.7, ornament: 0.4, difficulty: 3 } },
});

pattern.length > 0; // true
pattern.every((hit) => hit.durationBeat > 0); // true
```

Styles are `standard`, `funk`, `shuffle`, `bossa`, `trap`, `halftime`, `breakbeat`, `house`, and `synthpop`. Sections are `intro`, `verse`, `prechorus`, `chorus`, `bridge`, and `outro`, and they shape density and fills rather than naming a form.

The groove is written against a four-beat bar throughout — the backbeat, which is the snare on beats 2 and 4, the hi-hat subdivisions, the open-hat and crash beats, the beat a fill starts on — so 4/4 is the only meter accepted and another is refused rather than returned with 4/4 accents inside a bar of a different length. A composer whose meter is something else is refused for the same reason. `generateRhythm` writes in the meter it is given. `placeDrumPattern` writes in the meter the figures it draws from are written in, and every figure in the built-in dictionary is written in 4/4: another meter is refused rather than answered with an empty track, unless the context supplies vocabulary written in it — in which case the figure is placed on that meter's bars and thinned against its accents.

`fills: true` ends the last bar with a fill, and the section decides how much of that bar it takes: the whole bar in a `chorus`, the last three beats in a `prechorus`, the last two in a `verse` or a `bridge`, and the last beat alone in an `intro` or an `outro`.

`nextSection` names the section that fill leads into, which is what chooses between the archetypes — a fill into a chorus is not the fill out of an intro. Set `nextSection: 'chorus'` and a pre-chorus of three bars or more builds instead: the two-bar lift already marks the phrase end, so it takes precedence over the fill. Left out, `nextSection` is the section itself and the phrase end is written as a within-section fill.

`euclideanKick` replaces the style's kick with a Euclidean rhythm — `pulses` onsets spread as evenly as `steps` allows, `rotation` moving them later — for a kick figure asked for outright rather than drawn:

```ts
import { DRUM_NOTES, generateDrums } from '@libraz/libcantus';

const hits = generateDrums({
  bars: 1,
  style: 'house',
  section: 'verse',
  euclideanKick: { pulses: 3, steps: 8 },
  ctx: { seed: 5 },
});

hits.filter((hit) => hit.pitch === DRUM_NOTES.kick).map((hit) => hit.startBeat); // [0, 1.5, 3]
```

`budget` caps how many onsets a call may write. Generation is linear in the bar count and searches nothing, so the cap guards against an unbounded caller rather than a runaway search, and a request past it raises a `BudgetExceededError` instead of running.

The `role` option gates which voices appear at all, from `full` through `ambient` and `minimal` to `fxOnly`. `drumVoiceOf` names the voice a General MIDI note number stands for — the number, not the hit that carries it — and `DRUM_NOTES` gives those note numbers, which is what an exporter needs:

```ts
import { DRUM_NOTES, drumVoiceOf } from '@libraz/libcantus';

DRUM_NOTES.kick; // 36
drumVoiceOf(DRUM_NOTES.kick); // 'kick'
```

## Genre vocabulary

`generateDrums`, and `composer.drums` above it, write a kit part from the style tables built into the generator. `placeDrumPattern` is the other route into the same `DrumHit[]`: it draws from the genre dictionary, where every figure is a data entry rather than code. It is a function with no composer method of its own, since the dictionary and the built-in tables are two different sources rather than two ways of asking for one part.

```ts
import { DRUM_PATTERNS, GENRES, placeDrumPattern } from '@libraz/libcantus';

const hits = placeDrumPattern({
  bars: 2,
  genre: 'bossa',
  section: 'verse',
  ctx: { seed: 7, bpm: 130, complexity: { rhythmic: 0.6, ornament: 0.3, difficulty: 3 } },
});

hits.every((hit) => hit.durationBeat > 0); // true
DRUM_PATTERNS.every((entry) => GENRES.includes(entry.genre)); // true
```

A figure's strokes carry velocity as a factor rather than as a MIDI number, read against a base of 100; `velocity` on the call sets a different base, and the section and the dials scale it from there.

The three dials never fight, because each owns a different step. The genre chooses which figures are candidates, the complexity dials deform the chosen figure, and the difficulty ceiling rejects twice: first every figure whose own stated difficulty stands above it, then any figure the dials left with a pair of strokes closer together than a player at that ceiling sustains. A rejected figure is dropped from the candidates rather than simplified, since a simplified figure is a different figure.

`GENRES` is the closed list of names a figure may carry, not a promise of material for each. The built-in drum dictionary covers seven of them — `motown`, `funk`, `gospel`, `blues`, `bossa`, `samba`, and `dnb` — and the bass dictionary covers its own set. A genre with no built-in figures, `pop` and `house` among them, is a name waiting for entries supplied through `ctx.vocabulary`: asking for one without them returns nothing rather than failing. `DRUM_PATTERNS` is the dictionary itself, frozen: each entry names its genre, its difficulty from 1 to 5, the tempo band it suits, the time signature it is written in, the articulations it needs from the kit, and the provenance under which it may be published — the common currency of a genre, never a phrase from a particular recording. An entry may also name the sections it suits; none of the built-in drum figures does, so each of them is offered in every section.

### Figures of your own

The genre list is closed as a type and open in spirit. A caller with material the library does not carry passes entries through the generation context, and an entry reusing a built-in `id` replaces that built-in rather than competing with it:

```ts
import { type DrumVocabulary, placeDrumPattern } from '@libraz/libcantus';

const ownFigure: DrumVocabulary = {
  id: 'houseFourOnFloor',
  genre: 'house',
  difficulty: 2,
  articulations: [],
  material: {
    steps: 16,
    strokes: [0, 4, 8, 12].map((step) => ({ voice: 'kick', step, velocity: 1 })),
  },
  provenance: { basis: 'idiom', note: 'the four-on-the-floor pulse of the genre' },
};

const own = placeDrumPattern({ bars: 1, genre: 'house', ctx: { seed: 3, vocabulary: [ownFigure] } });

own.length > 0; // true
```

One dictionary serves the whole piece, so `ctx.vocabulary` — `Composer.of({ vocabulary })` on the class side — carries entries for every generator at once and each generator recognises its own material: a bass figure is invisible to the drum generator rather than misread. Entries are validated when the context is resolved, so a figure with a tempo band or a time signature it could never match is rejected at the entrance instead of silently matching nothing.

## Swing and feel

`feel` selects the underlying subdivision treatment for both drum surfaces. `swing` leans two thirds of the way toward the triplet — the offbeat played late, as a swung eighth is — and `shuffle` is the triplet itself; naming one is taken at its word by every style, including the eight of the nine, every one but `shuffle`, whose own character is already straight. Left out, the style's own feel applies.

Some dictionary entries are written on the straight grid and are only themselves once that feel is applied at render: the half-time shuffle is the plain case. `placeDrumPattern` takes `feel` for that, and `rate` — `straight`, `half`, `double` — for the separate question of what the figure's note values are.

```ts
import { placeDrumPattern } from '@libraz/libcantus';

const shuffled = placeDrumPattern({ bars: 1, genre: 'blues', feel: 'shuffle', ctx: { seed: 2, bpm: 88 } });
const halved = placeDrumPattern({ bars: 1, genre: 'blues', rate: 'half', ctx: { seed: 2, bpm: 88 } });

shuffled.some((hit) => hit.startBeat % 1 > 0.6); // true
halved.length > 0; // true
```

Over a pattern a host already holds, `Rhythm.deform({ rate })` asks the note-value half of that question; the feel belongs to the drum surfaces, which apply it as they place the figure. For material generated elsewhere, a groove template extracted from swung playing carries the same information and applies to any part, which is usually the more flexible route.

## Where this connects

Metric weight, bar positions, and tuplets are in [Time and arrangement](time-and-arrangement.md); the dials and their reproducibility guarantees are in [Determinism and seeding](determinism-and-seeding.md).
