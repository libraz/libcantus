# Command line

`cantus` runs one op of the library and prints the result as JSON. It is the C++ core behind the same entry point every binding uses, so any op that takes plain data can be called from a shell or a script.

## Usage

```sh
cantus <op> [ARGS_JSON | @file | -]
cantus list
cantus describe <op>
cantus version
```

`<op>` is the TypeScript name of a function (`detectChord`), a static method (`Score.fromData`), an instance method with the receiver as the first argument (`Score#transpose`), or a constant (`$const:NAMED_SCALES`). The arguments are one JSON array of the positional arguments, given as a word on the command line, as `@path` to read a file, or as `-` to read standard input. Omitting them means no arguments.

```sh
cantus detectChordBest '[[60, 64, 67]]'
echo '[[60, 64, 67]]' | cantus detectChordBest -
cantus midiToNote '[61, "flat"]'
cantus '$const:ALGORITHM_VERSION'
```

The first command prints `{"rootPc":0,"quality":"maj","intervals":[0,4,7]}`. `cantus list` prints every registered op with the flags `callbacks` and `handles`; `cantus describe detectChord` prints one entry; `cantus version` prints the library version as a JSON string.

`python -m libcantus` accepts the same arguments and gives the same output and exit codes.

## Results and errors

A result goes to standard output as JSON. A failure goes to standard error as an object with `code`, `name`, `message` and, for `NO_SOLUTION` raised in the middle of a sequence, `at`. The exit code identifies the failure:

| Exit code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | `INVALID_INPUT` |
| 2 | `NO_SOLUTION` |
| 3 | `BUDGET_EXCEEDED` |
| 4 | `HOST_TYPE_ERROR` |
| 10 | `UNKNOWN_OP` |
| 11 | `BAD_REQUEST`: malformed arguments, an unreadable `@file`, or an unsupported op |
| 99 | `INTERNAL` |

```sh
cantus detectChord '[[200]]'
```

This prints `{"code":"INVALID_INPUT","name":"InvalidInputError","message":"pitches[0] must be an integer in [0, 127]; received 200"}` on standard error and exits with 1. The status numbers are the ones in [Errors and validation](errors-and-validation.md#status-codes-across-surfaces).

An op that needs a callback or a handle (`Score#filter`, `createRng`, `Rng#next`) is refused with `BAD_REQUEST` and the message `callback arguments are not available from the CLI`. Each invocation is one call with no state kept between runs.

## The wire format

Arguments and results use the wire format of the C ABI, which is JSON with a few tagged objects. Any object whose key starts with `$` is a tag, so the command line does not guess which you meant:

| Tag | Value |
| --- | --- |
| `{"$n": "NaN"}` | A number JSON cannot hold: `"NaN"`, `"Infinity"`, `"-Infinity"` or `"-0"` |
| `{"$u": 1}` | An `undefined` element of an array |
| `{"$big": "10"}` | A bigint, as a decimal string |
| `{"$class": "Chord", …}` | An instance of a model class, with its data fields |

An unknown `$` tag is `BAD_REQUEST`. A key of your own that begins with `$` is written with a doubled `$$`, and a result that has such a key shows it the same way:

```sh
cantus '$echo' '[{"$$note": 1}]'
```

This prints `{"$$note":1}`, an object whose key is `$note`. The JavaScript and Python bindings add and remove the doubled `$` themselves; only the command line shows it.

`1e400` is read as `Infinity`, as `JSON.parse` reads it. A lone surrogate escape (`"\ud800"`) is accepted in strings and written back as an escape. Nesting deeper than 4096 levels is `BAD_REQUEST`.

## In scripts

Because failures use distinct exit codes and structured output, a script can branch on them without parsing messages:

```sh
if ! voiced=$(cantus voiceProgression "$args" 2>err.json); then
  status=$?
  [ "$status" -eq 2 ] && echo "no voicing fits"
fi
```

Pipe results to a JSON tool for further processing. The output has no whitespace and keeps object keys in the order the library produces them.
