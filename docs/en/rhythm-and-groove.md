# Rhythm and groove

Rhythm is handled as three separable steps: choose where the onsets go, turn those onsets into note events, and then deviate from the grid. Keeping them apart is what lets a host regenerate the feel without regenerating the part.

## Generating onsets

`generateRhythm` places onsets on a grid, weighting each slot by its metric strength:

```ts
import { generateRhythm, parseTimeSignature, rhythmDensity } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const sparse = generateRhythm(ts, { ctx: { seed: 42, complexity: { rhythmic: 0.2 } }, bars: 2 });
const dense = generateRhythm(ts, { ctx: { seed: 42, complexity: { rhythmic: 0.9 } }, bars: 2 });

sparse.length <= dense.length; // true
rhythmDensity(dense, ts) >= rhythmDensity(sparse, ts); // true
```

`subdivision` is the grid resolution in steps per quarter-note beat: 2 is an eighth-note grid, 4 a sixteenth, 3 an eighth-note triplet. `ctx.complexity.rhythmic` scales the per-slot probability; it defaults to 0.5, and a value outside [0, 1] is rejected rather than clamped.

`onsetWeightCurve` exposes the weighting itself — the base probability for a metric weight from 0 (off-pulse) to 3 (downbeat) — for a host building its own placement:

```ts
import { onsetWeightCurve } from '@libraz/libcantus';

onsetWeightCurve(3) > onsetWeightCurve(0); // true
```

## From onsets to notes

`RhythmEvent` values carry position and length but no pitch. `rhythmToNoteEvents` attaches one:

```ts
import { generateRhythm, parseTimeSignature, rhythmToNoteEvents } from '@libraz/libcantus';

const rhythm = generateRhythm(parseTimeSignature('4/4'), { ctx: { seed: 3 }, bars: 1 });
const notes = rhythmToNoteEvents(rhythm, 38);

notes.every((note) => note.pitch === 38); // true
```

That separation is deliberate: a rhythm can be reused across pitches, and a melodic generator can borrow a rhythm without borrowing its notes.

## Humanizing

`humanize` moves events off the grid and shapes their velocities by metric position. It returns copies, so the quantized source stays intact:

```ts
import { humanize } from '@libraz/libcantus';

const quantized = [
  { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 80 },
  { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 80 },
];

const played = humanize(quantized, { ctx: { seed: 1 }, timing: 0.03 });

played.length; // 2
quantized[0]?.startBeat; // 0
```

| Option | Meaning |
| --- | --- |
| `timing` | Maximum jitter in quarter-note beats, applied as ±. Defaults to 0.02. |
| `velocity` | Maximum velocity jitter in MIDI units, applied as ±. Defaults to 8. |
| `accent` | How much louder strong beats get, in MIDI units. Defaults to 12. |
| `baseVelocity` | Velocity assumed for events that carry none. Defaults to 80. |
| `ts` | The signature the metric accents are derived from. Defaults to 4/4. |

Events with a zero or negative duration never sound and are dropped, so the result can be shorter than the input.

## Groove templates

A groove template is a per-bar grid of timing and velocity deviations, captured from a performance. Extract it from playing that carries the intended feel, then impose it on material that does not:

```ts
import { applyGrooveTemplate, extractGrooveTemplate, parseTimeSignature } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const performed = [
  { pitch: 36, startBeat: 0.02, durationBeat: 1, velocity: 100 },
  { pitch: 38, startBeat: 1.06, durationBeat: 1, velocity: 70 },
];
const template = extractGrooveTemplate(performed, ts, 4);

template.subdivision; // 4
template.slotsPerBar; // 16

const stiff = [
  { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 90 },
  { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 90 },
];
const grooved = applyGrooveTemplate(stiff, template, ts);

grooved.length; // 2
```

Each slot holds the average offset from the grid and the average velocity of the events that landed on it. A velocity of `null` means no event with a velocity landed there, which is not the same as a velocity of zero — that distinction is why the field is nullable.

The template records the time signature it was extracted under, and `applyGrooveTemplate` requires the apply-time meter to match. A 4/4 groove laid over 3/4 would align its per-bar grid against the wrong bar length and drift without reporting anything, so the mismatch is rejected.

## Drums

`generateDrums` produces a full kit part rather than a single line. Style, section, and role together decide the vocabulary:

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

The groove is written against a four-beat bar throughout — the backbeat, the hi-hat subdivisions, the open-hat and crash beats, the beat a fill starts on — so `ts` accepts 4/4 alone and another meter is refused rather than returned with 4/4 accents inside a bar of a different length. `generateRhythm` and `placeDrumPattern` write in the meter they are given.

`fills: true` replaces the final bar with a fill. A pre-chorus leading into a chorus builds instead — the two-bar lift already marks the phrase end, so it takes precedence.

The `role` option gates which voices appear at all, from `full` through `ambient` and `minimal` to `fxOnly`. `drumVoiceOf` maps a generated hit back to its named voice, and `DRUM_NOTES` gives the General MIDI note numbers, which is what an exporter needs.

## Genre vocabulary

`generateDrums` writes a kit part from the style tables built into the generator. `placeDrumPattern` is the other route into the same `DrumHit[]`: it draws from the genre dictionary, where every figure is a data entry rather than code.

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

The three dials never fight, because each owns a different step. The genre chooses which figures are candidates, the complexity dials deform the chosen figure, and the difficulty ceiling rejects a figure whose closest pair of strokes is faster than a player at that ceiling sustains. A rejected figure is dropped from the candidates rather than simplified, since a simplified figure is a different figure.

`GENRES` lists the genres the built-in entries carry, from `pop` and `motown` through `bossa` and `dnb`. `DRUM_PATTERNS` is the dictionary itself, frozen: each entry names its genre, its difficulty from 1 to 5, the sections and tempo band it suits, the time signature it is written in, the articulations it needs from the kit, and the provenance under which it may be published — the common currency of a genre, never a phrase from a particular recording.

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

One dictionary serves the whole piece, so `ctx.vocabulary` carries entries for every generator at once and each generator recognises its own material: a bass figure is invisible to the drum generator rather than misread. Entries are validated when the context is resolved, so a figure with a tempo band or a time signature it could never match is rejected at the entrance instead of silently matching nothing.

## Swing and feel

`feel` selects the underlying subdivision treatment for both drum surfaces. `swing` leans two thirds of the way toward the triplet and `shuffle` is the triplet itself; naming one is taken at its word by every style, including the ones — trap, house — whose own character is straight. Left out, the style's own feel applies.

Some dictionary entries are written on the straight grid and are only themselves once that feel is applied at render: the half-time shuffle is the plain case. `placeDrumPattern` takes `feel` for that, and `rate` — `straight`, `half`, `double` — for the separate question of what the figure's note values are.

```ts
import { placeDrumPattern } from '@libraz/libcantus';

const shuffled = placeDrumPattern({ bars: 1, genre: 'blues', feel: 'shuffle', ctx: { seed: 2, bpm: 88 } });
const halved = placeDrumPattern({ bars: 1, genre: 'blues', rate: 'half', ctx: { seed: 2, bpm: 88 } });

shuffled.some((hit) => hit.startBeat % 1 > 0.6); // true
halved.length > 0; // true
```

For material generated elsewhere, a groove template extracted from swung playing carries the same information and applies to any part, which is usually the more flexible route.

## Where this connects

Metric weight, bar positions, and tuplets are in [Time and arrangement](time-and-arrangement.md); the dials and their reproducibility guarantees are in [Determinism and seeding](determinism-and-seeding.md).
