# Errors and validation

Every failure the library raises falls into one of three kinds, and the kind decides what the caller can do about it. A message string is not a contract, so the kind travels as a `code` on the error. The surfaces built on the C++ core add a few codes for the boundary between a host language and the core; see [Status codes across surfaces](#status-codes-across-surfaces).

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

## Parsing invalid text without exceptions

A text field is parsed on every keystroke, and most keystrokes land halfway through a valid symbol. The `try*` parsers report that as a value:

```ts
import {
  tryParseChordSymbol,
  tryParseInterval,
  tryParseKeyName,
  tryParseNote,
  tryParseTimeSignature,
} from '@libraz/libcantus';

tryParseNote('Bb3').ok; // true
tryParseNote('C#b').ok; // false
tryParseInterval('P5').ok; // true
tryParseChordSymbol('Cmaj7').ok; // true
tryParseKeyName('gis moll').ok; // true
tryParseTimeSignature('7/8').ok; // true
tryParseTimeSignature('7/').ok; // false

const typed = tryParseChordSymbol('C(');
const label = typed.ok ? typed.value.quality : typed.error.message;
```

`ParseResult<T>` is `{ ok: true; value: T }` or `{ ok: false; error: LibcantusError }`. It reports invalid text rather than collapsing it to `null`, because an input field has to say what is wrong with what was typed. Every text parser has one: notes, intervals, chord symbols, key names, and time signatures. The class API mirrors the pair on the class that reads the text: `Note.tryParse`, `Interval.tryParse`, `Key.tryParse`, `Chord.tryParse`, and `Meter.tryParse` beside `Note.parse`, `Interval.parse`, `Key.parse`, `Chord.parse`, and `Meter.parse`.

The parser options are API arguments, not text. They are validated before parsing, so a malformed options bag from JavaScript — including `null` — raises `InvalidInputError` from either the throwing or the `try*` form. Omit options when there are none; use `ParseResult` only for text the user is still typing.

Each throwing parser is written on top of its non-throwing sibling, so `parseNote` and `tryParseNote` cannot disagree about what is valid.

An entry point that takes a note, a key, or a chord accepts the text form as well as the data (bar the data-level helpers named in [Interoperability](interoperability.md)), and reads it through the same parsers (see [Interoperability](interoperability.md)). That means such a function can raise `InvalidInputError` for text that names nothing, where the plain-data form could only have failed on a value out of range. Where a name arrives from a user rather than from your own code, parse it first with the `try*` sibling and hand over the result, so the failure surfaces at the field it was typed into rather than several calls later.

## Validating what a host hands over

TypeScript checks a string union at compile time only. A value that arrives from JSON, a project file, a plugin host, or a JavaScript caller reaches the engine unchecked, and is then read against a table that has no entry for it. The `assert*` helpers are exported so a host can apply the same checks at its own boundary:

```ts
import { assertMidiPitch, assertNoteEvents, assertOneOf, clampToMidi } from '@libraz/libcantus';

assertMidiPitch(60); // 60
assertOneOf('walking', ['pop', 'walking', 'root'], 'bass style'); // 'walking'
clampToMidi(140); // 127

assertNoteEvents([{ pitch: 60, startBeat: 0, durationBeat: 1 }]).length; // 1
```

`assertChordTimeline` applies the same boundary check to a timeline another part of an application has already built. It requires an `at` function, a segment array, and finite bounds on every segment, and returns the same timeline. A JSON value needs to be restored to a timeline with `at` before this check can accept it:

```ts
import { assertChordTimeline, chordTimelineFromChords } from '@libraz/libcantus';

const timeline = chordTimelineFromChords([], 4);
assertChordTimeline(timeline) === timeline; // true
```

Each helper returns its argument, so it can wrap a value in place instead of sitting on a line of its own. Both `assertMidiPitch` and `clampToMidi` require a whole number — a MIDI byte has no fractional value to carry — and they differ only in what they do with the range: `assertMidiPitch` rejects a pitch outside 0..127, while `clampToMidi` folds it into 0..127, which is what an importer usually wants.

Every note event is held to that rule. `pitch` is a whole number in 0..127, and `velocity`, where an event carries one, has the same domain and is checked the same way: a velocity arriving at 96.5 is a rounding left undone upstream, and admitting it would hand the writer a note the format cannot store. `articulation`, where an event carries one, is checked against the names the library knows, so a misspelt technique is an input error rather than the musical claim that the instrument cannot play it that way. `startBeat` and `durationBeat` are beats rather than MIDI bytes, so they are not limited to 0..127; each must be a finite value within `Number.MAX_SAFE_INTEGER` in magnitude (`startBeat` has its lower bound raised by `minStartBeat`), and `durationBeat` must also be positive unless `allowNonPositiveDuration` is set.

```ts
import { assertNoteEvents, isLibcantusError } from '@libraz/libcantus';

let reported = 'ok';
try {
  assertNoteEvents([{ pitch: 60, startBeat: 0, durationBeat: 1, velocity: 96.5 }], 'score notes');
} catch (error) {
  if (isLibcantusError(error)) reported = error.message;
}

reported; // 'score notes[0].velocity must be an integer in [0, 127]; received 96.5'
```

`assertNoteEvents` checks an array without copying it, and takes the tolerances an import needs:

- `allowNonPositiveDuration` accepts the zero-length artefacts a MIDI import produces, so the array can be validated before they are dropped.
- `minStartBeat` rejects a note earlier than the pickup the caller declared — the pickup being the notes that lead into the first downbeat, which therefore sound before beat 0. Onsets are unbounded below by default for that reason.
- `budget` caps the event count.

A hole in a sparse array and an explicit `undefined` are both rejected, rather than being dropped silently or surfacing as a `TypeError` further along.

An instrument profile is checked the same way, at the point it is accepted. A stringed profile needs at least one string, every open string is a MIDI pitch in 0..127, and its fret count is an integer in 0..127 — a neck longer than the MIDI compass would name positions that sound no pitch. A percussion profile needs at least one voice within reach, and every voice it reaches is a MIDI pitch in 0..127. A profile outside those bounds is an `InvalidInputError` naming the field, not a failure further in.

## Notes that never sound

The aggregate analysis entry points ignore events with a non-positive duration. The per-note results, `analyzeVoice` and `spellLine`, return one entry per input event and keep them. `dropSilentNotes` — also exported as `soundingNotesOnly` — applies that policy explicitly, which is useful right after an import:

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

## Status codes across surfaces

The C++ core, the WebAssembly and Node packages, Python and the command line share one error table. The three kinds above are the only errors the library itself raises. The boundary between a host language and the core adds codes for failures that are not about the musical input: a language-level type error, an unknown op, a malformed request, a released handle and an internal fault. Each code has a fixed status number, which is also the exit code of the command-line tool where it applies.

| Code | Status | Raised when | C++ typed API | JavaScript | Python | CLI exit |
| --- | --- | --- | --- | --- | --- | --- |
| `INVALID_INPUT` | 1 | An argument is rejected | `InvalidInputError` | `InvalidInputError` (a `RangeError`) | `InvalidInputError` (a `ValueError`) | 1 |
| `NO_SOLUTION` | 2 | Valid input, no answer | `NoSolutionError` with `at()` | `NoSolutionError` with `at` | `NoSolutionError` with `at` | 2 |
| `BUDGET_EXCEEDED` | 3 | The request exceeds the budget | `BudgetExceededError` | `BudgetExceededError` (a `RangeError`) | `BudgetExceededError` (a `ValueError`) | 3 |
| `HOST_TYPE_ERROR` | 4 | The language itself rejects a value, such as a `Symbol` in a message | Not raised | `TypeError`, with the message pure TypeScript gives | `CantusError` | 4 |
| `UNKNOWN_OP` | 10 | The op name is not registered | Not raised | `Error` with `code` | `CantusError` | 10 |
| `BAD_REQUEST` | 11 | The request is malformed, such as an unknown `$` tag or JSON nested too deeply | Not raised | `Error` with `code` | `CantusError` | 11 |
| `CALLBACK_FAILED` | 12 | A callback you passed raised | The exception propagates unchanged | The original exception is rethrown | The original exception is re-raised | Not raised |
| `RELEASED_HANDLE` | 13 | A released handle was used | Not raised | `Error` with `code` | `CantusError` | Not raised |
| `INTERNAL` | 99 | Any other failure inside the core | The `std::exception` | `Error` with `code` | `CantusError` | 99 |

The class of an error follows the TypeScript classification: a wrong type and an out-of-range value are both `InvalidInputError`. The message is the same word for word on every surface, so a message you match on in TypeScript matches on the others. `isLibcantusError` narrows to the three library classes in JavaScript, `is_libcantus_error` does the same in Python, and `cantus::is_libcantus_error` in C++. The command line prints the error object `{ "code", "name", "message", "at"? }` on standard error.

```js
import { InvalidInputError, detectChord, isLibcantusError } from '@libraz/libcantus-wasm';

try {
  detectChord([128]);
} catch (error) {
  if (!isLibcantusError(error)) throw error;
  error.code === 'INVALID_INPUT' && error instanceof InvalidInputError;
}
```

```python
import libcantus

try:
    libcantus.detect_chord([128])
except libcantus.CantusError as error:
    error.code == libcantus.ErrorCode.INVALID_INPUT
```

```cpp
#include <cantus/cantus.h>

try {
  cantus::detect_chord({128});
} catch (const cantus::Error& error) {
  bool invalid = error.code() == cantus::ErrorCode::kInvalidInput;
}
```

## Edge values across surfaces

Each row is the behaviour of pure TypeScript, and every surface returns the same result or the same error unless its column says otherwise. The command line and Python can only send what JSON can hold, so the rows for values JSON lacks (`undefined`, bigint, `Symbol`) apply to the JavaScript surfaces only.

| Input | Behaviour | C++ typed API | Python and JSON surfaces |
| --- | --- | --- | --- |
| Zero | A value in range is used as it is. Zero bars of generation are rejected: `rhythm bars must be an integer in [1, 1000000]; received 0`. | Same | Same |
| Negative zero | Validation keeps `-0`, and some results are `-0`. A few places normalise it to `+0`. `String(-0)` is `"0"`. | `double` keeps `-0` | `{"$n": "-0"}` on the wire; `-0.0` in Python |
| `NaN` | Rejected: `midi must be finite; received NaN`. A hole in an array and a `null` element report the same message where the code reads them as `NaN`. | Same | `{"$n": "NaN"}`; `float("nan")` in Python |
| `Infinity`, `-Infinity` | Rejected: `received Infinity`. A tuning result is checked against `[5e-324, 1.7976931348623157e+308]`. | Same | `{"$n": "Infinity"}`; `1e400` in JSON reads as `Infinity` |
| `null` as an argument | Rejected by validation: `opts must be an object; received null`. | Not possible; the type excludes it | The same message. A positional `None` is sent as `null`. |
| `null` as an option value | Treated as the default by most options and rejected by some; only options that distinguish absent from `null` keep the difference. | Not possible | The same per option. A keyword left as `None` is not sent. |
| `null` inside a list or dict | The element's own check rejects it, or reads it as `NaN`. | Not possible | Sent as `null`, so the same check applies |
| Missing or `undefined` | An omitted option bag is `{}`, and an omitted argument takes its default. | `std::optional` | The key is absent; `undefined` inside an array is `{"$u": 1}` |
| A field set to `undefined` | Counts as present in the two checks that test with `in` or reject an explicit `undefined`. | Not possible | Omitted on the wire, so it counts as absent (see [C++ core and surface differences](cpp.md)) |
| Empty list or text | `detectChord([])` is `[]`, `detectChordBest([])` is `null`, and `parseChordSymbol('')` fails with `Invalid chord symbol: ""`. Empty meter and tempo maps are rejected. | Same | Same |
| Limits | Ranges are closed: pitch and velocity `0..127`, seed `0..0xffffffff`, tempo `0.1..1000` (context tempo from `Number.MIN_VALUE`), ppq up to `1e6`, a budget up to `Number.MAX_SAFE_INTEGER` (default `1e6`). | Same constants | Same |
| One past a limit | Rejected: `must be an integer in [0, 127]; received 128`. `midiToNote` and `pitchClassOf` take any finite number and round it. | Same | Same |
| Beyond 2^31, 2^32, 2^53 | A safe-integer check rejects what is out of range. | The value is checked, then narrowed; a caller's implicit conversion comes first (see below) | A `double` is checked on the wire; a Python `int` is sent in decimal |
| A fraction where an integer is required | Rejected: a velocity of `63.7`. | Converted by C++ before the check, so it can arrive as `63` | Rejected |
| A boolean or string where a number is required | Rejected: `received true`, `received 5`. | Not possible | Rejected |
| An object with `toJSON` where a number is required | Rejected: `received [object Object]`, or the result of its `toString`. | Not possible | Tagged `{"$tojson": …, "$repr": …}` by the JavaScript facade |
| An object with `toJSON` where plain data is read | The `toJSON` result is used. | A type with `.data()` is accepted | Used by the JavaScript facade; a dict in Python |
| `Symbol` | A `TypeError` from the language. | Not possible | `HOST_TYPE_ERROR`: a `TypeError` in JavaScript, a `CantusError` in Python |
| `bigint` | Rejected: `received 10`. | Not possible | `{"$big": "10"}` in JavaScript; an `int` in Python |
| An unknown option key | Ignored. | Not possible | Ignored on the wire; a `TypeError` for a Python keyword argument |
| Non-ASCII text and lone surrogates | Lengths and truncation count UTF-16 code units. | Stored as WTF-8 and counted in UTF-16 code units | Read as WTF-8, written as `\udXXX` escapes; Python uses `surrogatepass` |
| Floating-point output | Beats, seconds, hertz, cents and scores. | Bit-identical to TypeScript, except the last bit of a tuning result against pure TypeScript on arm64 Node | Shortest round-trip text; a Python `float` |

A C++ call that passes `-1` where an unsigned integer is declared, or `63.7` where an `int` is declared, converts the number before any validation runs. This is the C++ type system rather than a different rule, and the JSON surfaces, which receive doubles, reject the same values. Validate at the boundary if the value comes from elsewhere.
