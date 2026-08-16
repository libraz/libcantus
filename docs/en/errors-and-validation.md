# Errors and validation

Every failure the library raises falls into one of three kinds, and the kind decides what the caller can do about it. A message string is not a contract, so the kind travels as a `code` on the error.

## The three kinds

| Code | Class | Extends | What has to change |
| --- | --- | --- | --- |
| `INVALID_INPUT` | `InvalidInputError` | `RangeError` | The argument. It is malformed, out of range, or names something unknown. |
| `NO_SOLUTION` | `NoSolutionError` | `Error` | The constraints. The input is valid, but nothing satisfies it. |
| `BUDGET_EXCEEDED` | `BudgetExceededError` | `RangeError` | The size of the request, or the budget it is measured against. |

The classes extend the built-in error a caller would otherwise catch, so the `code` narrows an existing category rather than replacing it. `isLibcantusError` is the type guard from `unknown` to that union:

```ts
import { isLibcantusError, parseChordSymbol, voiceChord } from '@libraz/libcantus';

function voiceOrCode(symbol: string, range: { min: number; max: number }): number[] | string {
  try {
    return voiceChord(parseChordSymbol(symbol), { ranges: [range] });
  } catch (error) {
    if (!isLibcantusError(error)) throw error;
    return error.code;
  }
}

voiceOrCode('C', { min: 60, max: 72 }); // [60]
voiceOrCode('C', { min: 61, max: 61 }); // 'NO_SOLUTION'
voiceOrCode('C', { min: 72, max: 60 }); // 'INVALID_INPUT'
```

Re-throw anything the guard rejects. A `TypeError` raised by a bug inside the library is not a constraint problem, and catching it here would turn a crash into a wrong answer.

`NoSolutionError` carries `at` when the operation was working through a sequence, so a progression that fails on its fourth chord can be reported at that chord rather than as a whole.

## Parsing text without exceptions

A text field is parsed on every keystroke, and most keystrokes land halfway through a valid symbol. The `try*` parsers report that as a value:

```ts
import { tryParseChordSymbol, tryParseInterval, tryParseNote } from '@libraz/libcantus';

tryParseNote('Bb3').ok; // true
tryParseNote('C#b').ok; // false
tryParseInterval('P5').ok; // true
tryParseChordSymbol('Cmaj7').ok; // true

const typed = tryParseChordSymbol('C(');
const label = typed.ok ? typed.value.quality : typed.error.message;
```

`ParseResult<T>` is `{ ok: true; value: T }` or `{ ok: false; error: LibcantusError }`. The error travels in the result rather than collapsing to `null`, because an input field has to say what is wrong with what was typed. `Chord.tryParse` is the class-API equivalent.

Each throwing parser is written on top of its non-throwing sibling, so `parseNote` and `tryParseNote` cannot disagree about what is valid.

## Validating what a host hands over

TypeScript checks a string union at compile time only. A value that arrives from JSON, a project file, a plugin host, or a JavaScript caller reaches the engine unchecked, and is then read against a table that has no entry for it. The `assert*` helpers are exported so a host can apply the same checks at its own boundary:

```ts
import { assertMidiPitch, assertNoteEvents, assertOneOf, clampToMidi } from '@libraz/libcantus';

assertMidiPitch(60); // 60
assertOneOf('walking', ['pop', 'walking', 'root'], 'bass style'); // 'walking'
clampToMidi(140); // 127

assertNoteEvents([{ pitch: 60, startBeat: 0, durationBeat: 1 }]).length; // 1
```

Each helper returns its argument, so it can wrap a value in place instead of sitting on a line of its own. `assertMidiPitch` rejects an out-of-range pitch; `clampToMidi` folds it into 0..127 instead, which is what an importer usually wants.

`assertNoteEvents` checks an array without copying it, and takes the tolerances an import needs:

- `allowNonPositiveDuration` accepts the zero-length artefacts a MIDI import produces, so the array can be validated before they are dropped.
- `minStartBeat` rejects a note earlier than the pickup the caller declared. Onsets are unbounded below by default, because a pickup sounds before beat 0.
- `budget` caps the event count.

A hole in a sparse array and an explicit `undefined` are both rejected, rather than being dropped silently or surfacing as a `TypeError` further along.

## Notes that never sound

Analysis entry points ignore events with a non-positive duration. `dropSilentNotes` — also exported as `soundingNotesOnly` — applies that policy explicitly, which is useful right after an import:

```ts
import { dropSilentNotes } from '@libraz/libcantus';

dropSilentNotes([
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 0 },
]).length; // 1
```

## The generation budget

Generation is synchronous, so a request for a million bars would block the thread rather than fail. `assertGenerationBudget` compares an estimate against a cap and raises `BudgetExceededError` when the work is larger than the caller asked to wait for:

```ts
import { assertGenerationBudget, DEFAULT_GENERATION_BUDGET, isLibcantusError } from '@libraz/libcantus';

DEFAULT_GENERATION_BUDGET; // 1000000

let code = 'ok';
try {
  assertGenerationBudget(5000, 'requested bars', 512);
} catch (error) {
  if (isLibcantusError(error)) code = error.code;
}
code; // 'BUDGET_EXCEEDED'
```

Entry points that search — `voiceProgression`, the drum and bass generators — take their own `budget` or `maxCandidates` option. Those bound the work rather than the quality of the answer: raising `maxCandidates` buys a closer-to-optimal voicing at the cost of search time.

## Choosing where to validate

The engine validates its own arguments, so a caller does not have to pre-check everything. The `assert*` helpers are for the boundary where untyped data enters the application — a file being opened, a request body, a plugin parameter. An error naming the offending field at that boundary is more useful than one raised three calls later.
