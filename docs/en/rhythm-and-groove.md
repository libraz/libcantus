# Rhythm and groove

Rhythm is handled as three separable steps: choose where the onsets go, turn those onsets into note events, and then deviate from the grid. Keeping them apart is what lets a host regenerate the feel without regenerating the part.

## Generating onsets

`generateRhythm` places onsets on a grid, weighting each slot by its metric strength:

```ts
import { generateRhythm, parseTimeSignature, rhythmDensity } from '@libraz/libcantus';

const ts = parseTimeSignature('4/4');

const sparse = generateRhythm(ts, { seed: 42, density: 0.2, bars: 2 });
const dense = generateRhythm(ts, { seed: 42, density: 0.9, bars: 2 });

sparse.length <= dense.length; // true
rhythmDensity(dense, ts) >= rhythmDensity(sparse, ts); // true
```

`subdivision` is the grid resolution in steps per quarter-note beat: 2 is an eighth-note grid, 4 a sixteenth, 3 an eighth-note triplet. `density` scales the per-slot probability and is sugar for `ctx.complexity.rhythmic`.

`onsetWeightCurve` exposes the weighting itself — the base probability for a metric weight from 0 (off-pulse) to 3 (downbeat) — for a host building its own placement:

```ts
import { onsetWeightCurve } from '@libraz/libcantus';

onsetWeightCurve(3) > onsetWeightCurve(0); // true
```

## From onsets to notes

`RhythmEvent` values carry position and length but no pitch. `rhythmToNoteEvents` attaches one:

```ts
import { generateRhythm, parseTimeSignature, rhythmToNoteEvents } from '@libraz/libcantus';

const rhythm = generateRhythm(parseTimeSignature('4/4'), { seed: 3, bars: 1 });
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

const played = humanize(quantized, { seed: 1, timing: 0.03 });

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

`fills: true` replaces the final bar with a fill. A pre-chorus leading into a chorus builds instead — the two-bar lift already marks the phrase end, so it takes precedence.

The `role` option gates which voices appear at all, from `full` through `ambient` and `minimal` to `fxOnly`. `drumVoiceOf` maps a generated hit back to its named voice, and `DRUM_NOTES` gives the General MIDI note numbers, which is what an exporter needs.

## Swing and feel

`feel` selects the underlying subdivision treatment for the drum generator. For material generated elsewhere, a groove template extracted from swung playing carries the same information and applies to any part, which is usually the more flexible route.

## Where this connects

Metric weight, bar positions, and tuplets are in [Time and arrangement](time-and-arrangement.md); the dials and their reproducibility guarantees are in [Determinism and seeding](determinism-and-seeding.md).
