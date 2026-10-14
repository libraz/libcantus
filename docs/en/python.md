# Python

The `libcantus` package is the C++ core called through `ctypes`. It exposes the same functions, classes and constants as the TypeScript package, with Python spelling, and returns plain dicts and lists. Behaviour and error messages match the TypeScript reference; the few differences are listed in [C++ core and surface differences](cpp.md).

## Install

Python 3.10 or later.

```sh
pip install libcantus
```

The wheel bundles the shared library for its platform. In a source checkout the library is taken from `build-shared/` (`make build-shared`); set the `CANTUS_LIB` environment variable to load another file. The library is loaded on the first call, so importing the package needs nothing installed.

## A first call

```python
import libcantus

libcantus.detect_chord_best([60, 64, 67])
# {'rootPc': 0, 'quality': 'maj', 'intervals': [0, 4, 7]}

chords = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]]
notes = [
    {"pitch": pitch, "startBeat": bar * 4, "durationBeat": 4}
    for bar, pitches in enumerate(chords)
    for pitch in pitches
]

timeline = libcantus.Score.of(notes).timeline()
[entry["roman"] for entry in timeline.roman()]
# ['I', 'IV', 'V7', 'I']
```

`Score`, `Chord`, `Key` and the other model classes keep their names and their methods; static methods are `snake_case` (`Score.from_data`). Getters are properties (`score.total_beats`).

## Names and arguments

- Function and method names are the `snake_case` form of the TypeScript names: `detectChord` is `detect_chord`, `Score#withTempo` is `with_tempo`.
- An options object becomes keyword-only arguments, also in `snake_case`: `detect_chord(pitches, input="midi", bass_pc=0)`. The field names inside a plain dict that you pass keep their TypeScript spelling (`startBeat`, `durationBeat`), because that dict is the data itself.
- Keyword arguments default to `None`, and `None` means not given. A positional `None`, or a `None` inside a dict or list, is sent as JSON `null`, so it is validated exactly as TypeScript validates `null`.
- An unknown keyword argument is a `TypeError`, raised by Python. TypeScript ignores unknown option keys.
- `int` crosses as a decimal integer, `float` including `nan` and `inf` as a tagged number, and `bool` as a boolean. `bool` and `str` where a number is expected are rejected with the TypeScript message.

## Results

Results are dicts and lists with the TypeScript field names. Three kinds of value come back as objects:

- Model instances (`Score`, `Timeline`, `Chord`, …) are thin immutable wrappers. Their methods and properties call into the core, and `repr` shows their data.
- Hybrids such as the `ChordTimeline` returned by `chord_timeline_from_chords` expose their data fields as attributes and their methods as methods: `timeline.segments`, `timeline.at(5)`.
- Handles are described below.

Constants are read from the module (`libcantus.NAMED_SCALES`, `libcantus.ALGORITHM_VERSION`). `libcantus.version()` and `libcantus.algorithm_version()` report the loaded library, and `libcantus.list_ops()` lists the registered ops.

## Handles

State that is mutable or expensive to rebuild stays inside the core and is held by a handle: `Rng`, `NoteEventIndex` and `ArrangementSession`. Release one with `close()` or a `with` block; garbage collection releases a forgotten one as a fallback.

```python
import libcantus

with libcantus.create_rng(1) as rng:
    rng.next()
# 0.6270739405881613
```

Using a closed handle raises `CantusError` with code `RELEASED_HANDLE`. Each handle serialises its own calls with a lock; do not share one across threads for concurrent use.

## Callbacks

Where the TypeScript API takes a function, pass a Python callable. It receives the same arguments as in TypeScript, including the index.

```python
import libcantus

notes = [{"pitch": pitch, "startBeat": beat, "durationBeat": 1} for beat, pitch in enumerate([60, 64, 67])]
libcantus.Score.of(notes).filter(lambda note, index: note["pitch"] > 60).notes
# [{'pitch': 64, 'startBeat': 1, 'durationBeat': 1}, {'pitch': 67, 'startBeat': 2, 'durationBeat': 1}]
```

An exception raised inside a callback propagates out of the call as the original exception, not wrapped.

## Errors

| Class | Also a | Raised for |
| --- | --- | --- |
| `CantusError` | `Exception` | Base of every error below. Has `code`. |
| `InvalidInputError` | `ValueError` | `INVALID_INPUT`: a rejected argument. |
| `NoSolutionError` | | `NO_SOLUTION`: valid input, no answer. Has `at`. |
| `BudgetExceededError` | `ValueError` | `BUDGET_EXCEEDED`: the request is larger than the budget. |

`code` is a member of `libcantus.ErrorCode`, an `IntEnum` whose values are the status numbers in [Errors and validation](errors-and-validation.md#status-codes-across-surfaces). Codes with no dedicated class (`HOST_TYPE_ERROR`, `UNKNOWN_OP`, `BAD_REQUEST`, `RELEASED_HANDLE`, `INTERNAL`) raise `CantusError` itself. `libcantus.is_libcantus_error(value)` is the type guard.

```python
import libcantus

try:
    libcantus.detect_chord([128])
except libcantus.InvalidInputError as error:
    error.code == libcantus.ErrorCode.INVALID_INPUT
    str(error)
    # 'pitches[0] must be an integer in [0, 127]; received 128'
```

## Command line

`python -m libcantus` provides the same contract as the `cantus` tool, without a console script: `python -m libcantus detectChordBest '[[60, 64, 67]]'`. See [Command line](cli.md).

## Types

The package ships `py.typed` and a `.pyi` generated from the same manifest as the functions, so editors and `mypy --strict` see the keyword names. Return types are `Any`, because results are plain data.
