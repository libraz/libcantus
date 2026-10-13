# libcantus (Python)

Python binding of the libcantus C++ core, loaded through `ctypes` from the `libcantus` shared
library that the wheel bundles.

```python
import libcantus

libcantus.detect_chord([60, 64, 67])
```

- Functions are the snake_case names of the TypeScript exports. A TypeScript options object becomes
  keyword-only arguments; `None` means "not given". A positional `None`, or one inside a list or
  dict, is sent as JSON `null`.
- Results are plain dicts and lists. Model classes, hybrids and handles come back as objects;
  handles are released with `close()`, a `with` block, or when dropped.
- Errors derive from `CantusError`; `InvalidInputError` and `BudgetExceededError` are also
  `ValueError`, and `NoSolutionError` carries `at`. An exception raised inside a callback you passed
  is re-raised unchanged.
- `python -m libcantus <op> [ARGS_JSON | @file | -]` is the same command line as `cantus`.

In a source checkout the library is taken from `build-shared/` (`make build-shared`); set
`CANTUS_LIB` to point at another one.
