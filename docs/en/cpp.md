# C++ core and surface differences

The library has a C++17 core that reproduces the TypeScript reference result for result and message for message. WebAssembly, Node, Python and the command-line tool are thin layers over that core. This page covers using the core from C++, how the layers are built, and where a surface can differ from pure TypeScript. [Packages and surfaces](packages.md) lists what is installed from where.

## Using the C++ library

The package is named `cantus` and exports three targets:

| Target | Provides | Link it for |
| --- | --- | --- |
| `cantus::cantus` | The typed C++ API under `include/cantus/`. No JSON type appears in its headers. | An application that calls the library directly. |
| `cantus::ops` | The JSON op layer (`cantus/ops.h`) and the C ABI (`cantus/cantus_c.h`). | A host that exchanges JSON, or a binding. |
| `cantus::shared` | The C ABI as a shared library. Built only with `CANTUS_BUILD_SHARED=ON`; linkable by this name from the installed package only. | A language runtime that loads a shared library. |

From an installed prefix:

```cmake
find_package(cantus REQUIRED)
target_link_libraries(app PRIVATE cantus::cantus)
```

Or from source, with the same names for `cantus::cantus` and `cantus::ops`. `cantus::shared` exists only in the installed package; a source build builds the `cantus_shared` target instead:

```cmake
include(FetchContent)
FetchContent_Declare(cantus GIT_REPOSITORY https://github.com/libraz/libcantus.git GIT_TAG main)
FetchContent_MakeAvailable(cantus)
target_link_libraries(app PRIVATE cantus::cantus)
```

`add_subdirectory` works the same way. When the library is not the top-level project, its tests, command-line tool and install rules are off. The options are:

| Option | Default (top-level project) | Effect |
| --- | --- | --- |
| `CANTUS_BUILD_TESTS` | `ON` | Build the Catch2 tests. |
| `CANTUS_BUILD_CLI` | `ON` | Build the `cantus` command-line tool. |
| `CANTUS_BUILD_SHARED` | `OFF` | Build `libcantus.{so,dylib}` for the Python binding. |
| `CANTUS_INSTALL` | `ON` | Generate install and `find_package` rules. |

CMake 3.24 and a C++17 compiler are required. A C++ API change is a SemVer major change.

## The typed API

Headers are grouped by layer, `<cantus/core/…>` through `<cantus/model/…>`, and `<cantus/cantus.h>` includes all of them. Everything lives in `namespace cantus`; the layer is visible only in the header path.

```cpp
#include <cantus/cantus.h>

#include <cstdio>
#include <string>

int main() {
  std::vector<cantus::ChordMatch> matches = cantus::detect_chord({60, 64, 67});
  const cantus::ChordMatch& best = matches.front();
  std::printf("%d %s\n", best.rootPc, std::string(cantus::to_string(best.quality)).c_str());

  try {
    cantus::detect_chord({128});
  } catch (const cantus::InvalidInputError& error) {
    std::printf("%s\n", error.what());
  }
}
```

The mapping from TypeScript is mechanical:

- Functions are `snake_case` (`detectChord` becomes `detect_chord`); types keep their names; constants keep their TypeScript names.
- An optional field `x?: T` is `std::optional<T>`. `T | null` is `cantus::Nullable<T>`, which serialises as `null`. A string-literal union is an `enum class` with `to_string` and `parse_…` helpers; an object union is a `std::variant`.
- Options are aggregate structs with every field optional (`DetectChordOptions`).
- Callbacks are `std::function`. An exception thrown inside a callback propagates to the caller unchanged.
- The model classes are immutable value types with `data()`. Methods that transform one return a new instance.
- Errors derive from `cantus::Error : std::runtime_error`, which carries `code()`: `InvalidInputError`, `NoSolutionError` (with `at()`) and `BudgetExceededError`. Messages are identical to the TypeScript ones. `try_…` parsers return `ParseResult<T>`.
- Numbers are `double` unless TypeScript validates an integer, in which case `int` is used, `std::size_t` for an index or a count, `std::uint32_t` for a seed, and `std::int64_t` where the validated range exceeds `int`.

The core keeps no global mutable state. Objects are not shared between threads; separate instances may be used concurrently.

## The JSON op layer and the C ABI

Every binding goes through one entry point. An op is addressed by name (`detectChord`, `Score.fromData`, `Score#transpose`, `$const:NAMED_SCALES`), takes a JSON array of arguments and returns JSON. `cantus::ops::call` is the in-process form:

```cpp
#include <cantus/ops.h>

#include <cstdio>

int main() {
  cantus::ops::Result chord = cantus::ops::call("detectChordBest", "[[60, 64, 67]]");
  std::printf("%s\n", chord.json.c_str());
}
```

A failed call does not throw: `status` is a `CantusStatus` and `json` is an object `{ "code", "name", "message", "at"? }`. `call` refuses ops that need a host callback or handle with `BAD_REQUEST`; those need `cantus_call` from `cantus/cantus_c.h`, which accepts a callback function. The status table is in [Errors and validation](errors-and-validation.md#status-codes-across-surfaces).

Values that JSON cannot carry travel as tagged objects: `{"$n": "NaN"}` for `NaN`, `Infinity`, `-Infinity` and `-0`, `{"$u": 1}` for an `undefined` array element, `{"$big": "10"}` for a bigint, `{"$class": "Chord", …}` for a model class, `{"$h": 1, "$type": "Rng"}` for a handle, `{"$class": "Score", "$ref": 7}` for a value the core retains, and `{"$cb": 1}` for a callback. A user key that begins with `$` is written with a doubled `$$`; the facades and the Python binding do this themselves, while the command line takes the wire form directly ([Command line](cli.md#the-wire-format)).

## The same answers on every surface

The surfaces share one specification. The shared test suite runs against pure TypeScript, the WebAssembly build and the native addon, and a recorded corpus of calls is replayed through the C ABI, Python, the command line and both JavaScript backends. Results, error classes and error messages match. Floating-point results match bit for bit across platforms: the core compiles with `-ffp-contract=off`, uses `double` only, and ports V8's `Math.log2`, `Math.exp` and `**` so that libm differences do not reach a result. `Math.round`, `sort` and number formatting follow ECMAScript rather than the C++ standard library.

Defaults live in C++ only. The JavaScript facade and the Python binding send an absent argument as absent, so the same call gives the same answer everywhere.

## Differences from pure TypeScript

These differences are deliberate and listed in full. Anything not listed here is a defect.

**Implicit conversion in the typed API.** Numeric arguments of the typed C++ API convert under C++ rules before any check runs: `-1` becomes a `uint32_t`, `63.7` becomes an `int`. A value that TypeScript rejects can arrive in range. The JSON surfaces receive doubles and validate them as TypeScript does, so `63.7` is rejected as a velocity there.

**Unknown keyword arguments in Python.** Python raises `TypeError` for an unknown keyword argument. TypeScript ignores unknown option keys.

**Explicit `undefined`.** An object field holding `undefined` is omitted on the wire, so a check that tells it from an absent field sees it absent. The `'numerator' in data` test that reads a meter from plain data is the documented case. A check that rejects an explicit `undefined` (the countermelody weights) accepts the omitted field instead.

**Cyclic arguments.** JSON holds no cycle. An argument that contains itself crosses with each repeat cut to an empty object or array, and the facade reports what the cut value fails. Pure TypeScript reports the cycle.

**Object identity.** Each call receives a fresh copy of its arguments, and each result is a fresh decoded value. Identity survives only for the objects a handle getter returns, for handles themselves, and for a `ChordTimeline` passed back unchanged, so a result compared with `toBe` against an earlier result is a different object. Results are unchanged.

**Malformed chords in `checkPartWriting`.** Pure TypeScript reads a chord entry only where a rule needs its tones, so a malformed entry (a non-finite interval, say) is rejected when a rule reaches it. The core does not read the entry there and returns the violations. Well-formed chords give identical results.

**No module memo.** The C++ core does not remember the joint scale spellings that TypeScript caches. A repeated question is worked out again, with the same result.

**Handles.** `Rng`, `NoteEventIndex` and `ArrangementSession` live in the core and are released explicitly. In JavaScript a handle has `[Symbol.dispose]` and a finalizer as a fallback; in Python it has `close()`, a context manager and `__del__`. Using a released handle is an error with code `RELEASED_HANDLE`. The same handle must not be used from two threads at once.

**Retained values.** A `Score`, `Timeline`, `ChordTimeline` or `Arrangement` is handed to the core once, the first time one of its methods is called, and kept there decoded; later calls send only a reference, so a per-note loop costs what it costs in TypeScript and an `Arrangement` keeps its analysis session across `update`. The facades and the Python binding do this themselves and release the value with the host object; at most 1024 values and 4 MiB of their wire text are retained per runtime; past either, the least recently used are released when a call returns and are retained again on their next use, and a value larger than that is sent as data. A copied or unpickled Python value is retained on its own, and a Node worker's retained values are released when the worker exits. A retained value never changes, so it may be used from several threads at once. For the same reason an edit made in place after the first method call is not seen: after `timeline.at(1)`, assigning `timeline.segments[0].chord` or `.endBeat` changes the host object only, and later `at` calls answer from the value the core holds, where pure TypeScript reads the edited segments. Build a new timeline from the edited segments instead.

**WebAssembly is ESM only.** The module instantiates with top-level await, so after the import resolves every call is synchronous. `require()` of it fails with `ERR_REQUIRE_ASYNC_MODULE`; a CommonJS application uses pure TypeScript. A bundler for the browser needs a target of es2022 or later.

**Frozen results.** Results are frozen exactly where pure TypeScript freezes them, so writing to a frozen result raises the same `TypeError` in strict mode. Most results are mutable in both.

The edge-value behaviour (`NaN`, `-0`, `null`, empty input, range limits) is specified in [Errors and validation](errors-and-validation.md#edge-values-across-surfaces).

## Threads and size limits

- The op layer is thread-safe and the handle table is guarded by a mutex. Using one handle from several threads at once is outside the contract; a retained value may be shared.
- The JSON parser accepts nesting up to 4096 levels; deeper input is `BAD_REQUEST`.
- Strings are carried as UTF-8, with lone surrogates preserved (WTF-8) and written back as `\udXXX` escapes. Lengths and truncation are counted in UTF-16 code units, as in JavaScript.
