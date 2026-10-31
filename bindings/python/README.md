# libcantus

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/libcantus/ci.yml?branch=main&label=CI)](https://github.com/libraz/libcantus/actions)
[![PyPI](https://img.shields.io/pypi/v/libcantus)](https://pypi.org/project/libcantus/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/libcantus/blob/main/LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)

**Music-theory analysis and generation for MIDI note events, from Python: recover the harmony from notes and write new parts against it.**

The package calls the libcantus C++ core through `ctypes`. It exposes the same functions, classes and constants as the TypeScript package `@libraz/libcantus`, with Python spelling, and returns plain dicts and lists.

**[Python guide](https://github.com/libraz/libcantus/blob/main/docs/en/python.md)** · **[Differences from pure TypeScript](https://github.com/libraz/libcantus/blob/main/docs/en/cpp.md)** · **[Repository](https://github.com/libraz/libcantus)**

## Install

Python 3.10 or later.

```sh
pip install libcantus
```

The wheel bundles the native library for its platform, so nothing needs compiling.

## Initialisation

There is none to call. The library is loaded on the first call, from the copy in the wheel. In a source checkout it is taken from `build-shared/` (`make build-shared`); set `CANTUS_LIB` to load a different file.

## Quick start

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

try:
    libcantus.detect_chord([128])
except libcantus.InvalidInputError as error:
    str(error)
    # 'pitches[0] must be an integer in [0, 127]; received 128'
```

- Function and method names are the `snake_case` form of the TypeScript names. An optional TypeScript options object becomes keyword-only arguments, where `None` means not given; a required one (`generate_progression`, `Composer(...)`) is passed as a dict with the TypeScript field names. A positional `None`, or one inside a list or dict, is sent as JSON `null`.
- Model classes, hybrids and handles come back as objects. Release a handle with `close()` or a `with` block.
- Errors derive from `CantusError` and carry `code`. `InvalidInputError` and `BudgetExceededError` are also `ValueError`, and `NoSolutionError` carries `at`. An exception raised inside a callback you passed is re-raised unchanged.
- `python -m libcantus <op> [ARGS_JSON | @file | -]` is the same command line as the `cantus` tool.

## Differences from pure TypeScript

Results, errors and messages are the same. What differs:

- **Unknown keyword arguments** raise `TypeError`, from Python itself; TypeScript ignores unknown option keys.
- **Objects are copied across the boundary.** A result is a fresh value on every call, and the per-object caches the TypeScript package keeps do not apply.
- **Handles** (`Rng`, `NoteEventIndex`, `ArrangementSession`) are released explicitly. A closed handle raises `CantusError` with code `RELEASED_HANDLE`.

The complete list is in [C++ core and surface differences](https://github.com/libraz/libcantus/blob/main/docs/en/cpp.md), and the shared error table and edge-value behaviour are in [Errors and validation](https://github.com/libraz/libcantus/blob/main/docs/en/errors-and-validation.md).

## License

[Apache License 2.0](https://github.com/libraz/libcantus/blob/main/LICENSE).
