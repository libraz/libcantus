# Contributing to libcantus

libcantus has two implementations of one library: the pure TypeScript package in `ts/` and a C++17 core with bindings (WebAssembly, Node, Python, CLI). The TypeScript source in `ts/src` is the reference. The C++ core reproduces its behaviour exactly: the same results, the same errors with the same messages, and the same floating-point bits on every platform.

## Building and testing

| Command | What it does |
|---|---|
| `make build` | Configure `build/` (Debug) and build it incrementally |
| `make release` | The same in `build-release/` (Release) |
| `make test-cxx` | Build, then run every Catch2 test with `ctest --no-tests=error` |
| `make test-install` | Install into a scratch prefix and build outside projects against it, through `find_package(cantus)` and through `add_subdirectory()` |
| `make conformance-fast` | Public-header, banned-API, generated-table and install checks |
| `make format` | Apply every formatter of the repository, then `make lint` |
| `make format-check` / `make lint` | The same checks without modifying anything; the C++ tools must be LLVM 18 (`LLVM_VERSION` in `mk/toolchain.mk`) |
| `make test-wasm` / `make test-node` / `make test-python` / `make test-cli` | Build one surface and run its boundary tests and the fixed corpus through it |
| `make corpus` / `make corpus-check UNIT=<id>\|all` | Record the call corpus from pure TS; replay a unit's recorded calls through the C ABI |
| `make spec-ready IMPL=node\|wasm` | Run the spec files whose ops are all registered against that surface |
| `make parity` | Generated artifacts up to date, the file map, and the API member by member across pure TS, the manifest, the C++ registry and the facade |
| `make ci-local` | Every check CI runs, in one command, cheapest first |
| `make release-check` | Before tagging: versions, CHANGELOG, package contents and the WebAssembly size budget |

Builds run two jobs under `nice` by default; set `JOBS=` to change that. `yarn spec` runs the shared behavioural suite in `tests/spec` against the implementation selected by `CANTUS_IMPL`; `node tools/spec/count.mjs --compare <impl>` checks that an implementation passes exactly the tests pure TS passes, with nothing skipped.

## Shared and TS-only tests

The shared suite in `tests/spec` and the TS-only tests in `ts/test` were split unit by unit from one suite, and `tests/spec/manifest.json` records the split. `node tools/spec/count.mjs` checks that every unit of the split is still in its half and in only one; tests added since are reported. A new test goes in `tests/spec` unless it reads internals, source text or object identity that no other surface can reproduce; a test that has to move to `ts/test` later is listed in `ts_only_units` of `api/annotations.json` with its reason.

## Layout and ownership

- `ts/src/<layer>/<module>/<name>.ts` corresponds to `src/<layer>/<module>/<snake_name>.{h,cpp}`, one file to one file. `index.ts` corresponds to `<module>.cpp`, and its public declarations go in `include/cantus/<layer>/<module>.h`. The model layer is flat: `ts/src/model/<name>.ts` corresponds to `src/model/<snake_name>.{h,cpp}`.
- Each module directory adds its own sources with `target_sources(cantus PRIVATE ...)` in its `CMakeLists.txt`.
- `tools/conformance/check_file_map.mjs` checks the correspondence both ways. A file that has no counterpart on purpose (a C++-only placement, or a TS module whose job C++ does differently) is listed in `file_map_exceptions` of `api/annotations.json` with its reason.
- `include/cantus/` is the typed C++ API (`cantus::cantus`). No public header except `cantus_c.h` and `ops.h` may name a JSON type, and every public header must compile on its own with only `-I include`.
- `src/ops/` is the JSON op layer (`cantus::ops`): one adapter per public TS function, member or constant, registered with `ops::def`, plus the wire codec. Every binding goes through `cantus_call` in `include/cantus/cantus_c.h`.
- Default values live only in C++. Bindings send an absent argument as absent.

## Porting rules

The C++ code uses the helpers in `src/js/` wherever JavaScript semantics differ from the C++ standard library. `tools/conformance/check_banned.py` rejects the banned forms in `src/` and `include/`.

| TypeScript | C++ | Banned | Why |
|---|---|---|---|
| `Math.round(x)` | `js::round` | `std::round`, `std::lround` | Half-way cases: JS rounds -2.5 to -2, `std::round` to -3 |
| `Math.max` / `Math.min` | `js::max` / `js::min` | `std::max` / `std::min` / `fmax` / `fmin` on numbers | NaN propagation and -0 < +0. For integers, name the type: `std::max<int>(a, b)` |
| `Math.log2` / `Math.exp` / `**` | `js::log2` / `js::exp` / `js::pow` | `std::log2`, `std::exp`, `std::pow`, `std::log` | libm results differ by platform; these are ports of V8's implementation |
| `Math.sqrt`, `+ - * /`, `floor` / `ceil` / `trunc` / `abs` | the standard library | — | Exactly specified by IEEE 754 |
| `Math.sign` | `js::sign` | — | Keeps -0 and NaN |
| `Math.imul`, `\| 0`, `>>> 0` | `js::imul`, `js::to_int32`, `js::to_uint32` | relying on signed overflow | Wrap-around is defined |
| `x % y` | `std::fmod` | `%` on negative integers | Sign rules |
| `Array.prototype.sort` | `std::stable_sort` with a comparator giving the TS order | `std::sort` | JS sort is stable |
| `sort((a, b) => a.x - b.x)` over values not yet checked | `js::array_sort` | `std::stable_sort` over keys that may be NaN | A comparator that returns NaN is no ordering; NaN reads as 0 and V8's run detection fixes the result |
| `` `${n}` `` / `String(n)` | `js::to_string` | `std::to_string`, printf `%f` / `%g` / `%e` | ES number formatting |
| `` `${v}` `` of any value | `js::template_string` | — | Messages match word for word |
| `describeRejected` / `JSON.stringify(s)` | `js::describe_rejected` / `js::quote` | — | Same |
| `n.toFixed(d)` | `js::to_fixed` | printf `%.Nf` | `(0.125).toFixed(2)` is `"0.13"` |
| `Number(s)` / `Number.parseInt` | `js::number` / `js::parse_int` | `std::stod`, `atoi` and relatives | Accepted syntax differs |
| `n + v` for a number and a wire value of unknown kind | `js::add_number` | `+` between a number and a wire value | A string or object operand turns the sum into text |
| `a > b` for two wire values of unknown kind | `js::greater_than` | A relational comparison between wire values | Text against text compares by code unit, so `"10" > "9"` is false |
| `a < b` / `a <= b` for wire values of unknown kind | `js::less_than` / `js::less_equal` | A relational comparison between wire values | The rules of `>`; `<=` is false where either side is NaN |
| `a === b` / `includes`, Map and Set keys over wire values | `js::strict_equals` / `js::same_value_zero` | `==` between wire values | A container equals only itself; SameValueZero matches NaN with NaN |
| `v * n` for a wire value of unknown kind | `js::multiply` | Multiplying the converted value directly | A bigint operand is a TypeError |
| `table[name]` of a plain object for any name | own keys, then `js::inherits_object_member` | Reading own keys only | `toString` and the other `Object.prototype` members are found as well |
| string `length` / `slice` / comparison / hashing | `js::utf16_*` | `std::string::size` as an observable length | JS counts UTF-16 code units |
| `Object.freeze` | `const` and value semantics | — | |

Floating point: only `double` (`float` and `long double` are banned). Every target is compiled with `-ffp-contract=off`, without fast-math, and with SSE2 on x86-64; `check_banned.py` verifies this from `compile_commands.json`. Epsilon comparisons and exact comparisons keep the form they have in TS.

## Absent, null and narrowing

An absent value is `std::optional` in C++ and a missing key on the wire, never a magic value. A TS `T | null` is `cantus::Nullable<T>`, which the codec writes as `null`. Numbers arrive as `double` and are validated exactly as TS validates them before they are narrowed to an integer type.

TS reads a nullable option field in one of three ways, and each adapter keeps the reading of the TS code it ports (`src/ops/accessors.h`):

| TS | Accessor | Absent | `null` |
|---|---|---|---|
| `opts.x ?? fallback` | `ops::opt_null_default` | fallback | fallback |
| `opts.x === undefined ? fallback : check(opts.x)` | `ops::opt_strict` | fallback | rejected by the validator |
| `assertNullable(...)` | `ops::opt_nullable` | absent | null |

Each validation helper of `ts/src/core/validation` has two C++ twins: a typed one in `src/core/validation/` (range, finiteness, integrality, emptiness) and a loose one in `src/ops/validate.{h,cpp}`, which checks the kind of the wire value and rejects it with the TS message before converting it and calling the typed twin. A helper that only checks the kind of a value (`assertArray`, `assertRecord`, `assertOptions`, `assertFlag`, `assertFunction`) has no typed twin: a typed argument already has the kind. `soundingNotesOnly`, the alias of `dropSilentNotes`, is `cantus::sounding_notes_only`; its op calls the loose `ops::drop_silent_notes`. The JS-semantics helpers the loose twins share (`type_of`, `truthy`, `to_number`, `template_string`) live in `src/js/`.

| TS helper | Typed twin (`src/core/validation`) | Loose twin (`src/ops/validate`) |
|---|---|---|
| `describeRejected` | `js::describe_rejected` | `js::describe_rejected` (shared; `src/js/format.h`) |
| `assertFiniteNumber` | `cantus::assert_finite_number` | `ops::assert_finite_number` |
| `assertInteger` | `cantus::assert_integer` | `ops::assert_integer` |
| `assertMidiPitch` | `cantus::assert_midi_pitch` | `ops::assert_midi_pitch` |
| `assertPitchClass` | `cantus::assert_pitch_class` | `ops::assert_pitch_class` |
| `clampToMidi` | `cantus::clamp_to_midi` | `ops::clamp_to_midi` |
| `assertDegree` | `cantus::assert_degree` | `ops::assert_degree` |
| `assertFiniteSemitones` | `cantus::assert_finite_semitones` | `ops::assert_finite_semitones` |
| `dropSilentNotes` | `cantus::drop_silent_notes` | `ops::drop_silent_notes` |
| `assertArray` | none | `ops::assert_array` |
| `assertRecord` | none | `ops::assert_record` |
| `assertOptions` | none | `ops::assert_options` |
| `assertFlag` | none | `ops::assert_flag` |
| `assertFunction` | none | `ops::assert_function` |
| `assertOneOf` | `cantus::assert_one_of` | `ops::assert_one_of` |
| `assertPositiveInt` | `cantus::assert_positive_int` | `ops::assert_positive_int` |
| `assertRange` | `cantus::assert_range` | `ops::assert_range` |
| `assertGenerationBudget` | `cantus::assert_generation_budget` | `ops::assert_generation_budget` |
| `allocateCandidateTable` | `cantus::allocate_candidate_table` | `ops::allocate_candidate_table` |
| `allocateChoiceTable` | `cantus::allocate_choice_table` | `ops::allocate_choice_table` |
| `assertTimeSignature` | `cantus::assert_time_signature` | `ops::assert_time_signature` |
| `assertMeterMap` | `cantus::assert_meter_map` | `ops::assert_meter_map` |
| `assertNoteEvent` | `cantus::assert_note_event` | `ops::assert_note_event` |
| `assertNoteEvents` | `cantus::assert_note_events` | `ops::assert_note_events` |
| `assertDataObject` (`model/shared`) | none | `ops::assert_data_object` (`src/ops/codec_m1.h`) |
| `assertDataArray` (`model/shared`) | none | `ops::assert_data_array` (`src/ops/codec_m1.h`) |
| `assertKeyArgument` (`model/shared`) | none | `ops::assert_key_argument` (`src/ops/codec_m1.h`) |
| `assertDataObjects` (`model/shared`) | none | `ops::assert_data_objects` (`src/ops/codec_m1.h`) |
| `assertNoteEventArray` (`model/shared`) | none | `ops::assert_note_event_array` (`src/ops/codec_m1.h`) |
| `copyPlain` (`model/shared`) | none | `ops::copy_plain` (`src/ops/codec_m1.h`) |
| `samePlain` (`model/shared`) | none | `ops::same_plain` (`src/ops/codec_m1.h`) |

## Errors

Inside the C++ core errors are exceptions. The typed API raises `cantus::InvalidInputError`, `cantus::NoSolutionError` (with `at()`) and `cantus::BudgetExceededError`, all derived from `cantus::Error`; messages are the TS messages verbatim. `cantus_call` catches everything and returns a status with `{"code","name","message","at"?}`. The code-to-status table is defined once, in `src/ops/error_map.cpp`, with no `default:` label; its copies across the surfaces are checked by `tools/conformance/check_error_tables.py`.

## Data tables and limits

Tables and limit constants are generated from the evaluated TS modules, never copied by hand. A module lists what it needs in `src/<layer>/<module>/tables.json`, and `node tools/data/gen_tables.mjs` writes the `*.gen.inc` initializers and the module's `limits.gen.h` (collected by `include/cantus/core/limits.h`). Generated files are committed; `gen_tables.mjs --check` fails when one is stale.

## Changing behaviour

TypeScript first, C++ second, always in the same change:

1. Change `ts/src` and its tests.
2. If generated output changes, raise `ALGORITHM_VERSION` in `ts/src/core/random/version.ts` (following the rules in that file) and run `node tools/data/gen_tables.mjs`.
3. Regenerate the goldens from TypeScript with `tools/spec/regen_golden.mjs`, keeping the tables of older versions. This records an intended output change and is a separate step from re-recording the corpus.
4. Re-record the call corpus with `yarn corpus`.
5. Run `make corpus-check`; it lists every difference from C++ with the op, the input, the expected and the actual value.
6. Fix the C++ side until the difference is zero, and run the shared suite under every `CANTUS_IMPL`.

## Adding an API

Three things are written by hand:

1. The TypeScript implementation.
2. The C++ declaration and implementation.
3. The op adapter (`ops::def` in `src/ops/<group>.cpp`) and the codec lines (`CANTUS_JSON_FIELDS` in `src/ops/codec_<group>.h`).

The API manifest, the TS facade, the Python module and stubs, and the type declarations are generated or copied; `make parity` names anything that is missing.

## Releasing

All packages carry one version. `node tools/release/bump.mjs <version>` writes it into every site listed in `tools/release/versions.json`, and `tools/release/check_versions.py` checks that they agree. Then:

1. Move the `Unreleased` entries of `CHANGELOG.md` under a dated `## [<version>] - YYYY-MM-DD` heading.
2. Run `make ci-local`, then `make release-check`.
3. Tag. The publish workflow builds and publishes the pure TS package, the WebAssembly package, the Python wheels and the CLI executables. `@libraz/libcantus-node` stays private.

`make release-check` fails when the gzip size of `cantus.wasm` exceeds `bindings/wasm/wasm-size-budget.json`. The budget is 1.10 times a measured size; before raising it, take the module through a size-reduction pass.
