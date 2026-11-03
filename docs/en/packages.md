# Packages and surfaces

libcantus is one library with one specification and several ways to call it. Pure TypeScript is the reference implementation; a C++17 core reproduces it and sits under the WebAssembly, Node, Python and command-line surfaces. Every surface exposes the same functions, classes and constants under the same names, and the same inputs give the same results and the same errors.

## The surfaces

| Surface | Package | Installed from | Runs on |
| --- | --- | --- | --- |
| Pure TypeScript | `@libraz/libcantus` | npm | Node.js 22 or later, browsers, workers |
| WebAssembly | `@libraz/libcantus-wasm` | npm | Node.js 22 or later, browsers with ES2022 and WebAssembly exception handling |
| Node native | `@libraz/libcantus-node` | Built from source; not published | Node.js 22 or later |
| Python | `libcantus` | PyPI | Python 3.10 or later |
| Command line | `cantus` | A release asset on GitHub | macOS, Linux |
| C++ | CMake package `cantus` | `find_package`, `add_subdirectory` or FetchContent | Any C++17 toolchain |

The two JavaScript builds that sit on the C++ core, `-wasm` and `-node`, carry the type declarations of the pure TypeScript package. Code written against one compiles against the other. Both are built from a single facade, so the encoding of arguments, the decoding of results and the error classes are the same in each.

All packages carry the same version number.

## Choosing a surface

- **Pure TypeScript** has no native code, is tree-shakeable, and ships both ESM and CommonJS. It is the right choice for a web application that bundles its dependencies and for any code that needs a `require()`.
- **WebAssembly** gives a JavaScript application the C++ core without a native build. It is ESM only and instantiates with top-level await; after the import every call is synchronous.
- **Node native** is the same facade over a Node-API addon. It is not published because it has to be built for each platform; use it from a checkout of the repository.
- **Python** calls the core through `ctypes`. The wheel bundles the shared library, so no compiler is needed to install it.
- **Command line** runs any op that takes plain data, from a shell or a script, and prints JSON.
- **C++** is the typed API for native applications, with no JSON in its headers.

The differences between pure TypeScript and the core-backed surfaces are described in [C++ core and surface differences](cpp.md). They are small; among them are object identity, a few type-system effects, and the module format.

## Switching between pure TypeScript and WebAssembly

The two npm packages have the same exports, subpaths and type declarations, so code keeps importing `@libraz/libcantus` and the build behind that name is chosen by configuration.

To use WebAssembly everywhere, Node.js included, install it under the pure package's name:

```sh
yarn add @libraz/libcantus@npm:@libraz/libcantus-wasm
```

To choose per build, install both and alias the name in the bundler. With Vite:

```js
// vite.config.js
export default {
  resolve: { alias: { '@libraz/libcantus': '@libraz/libcantus-wasm' } },
  build: { target: 'es2022' },
};
```

The alias covers the subpaths too: `@libraz/libcantus/analyze` resolves to `@libraz/libcantus-wasm/analyze`. Either way the code must be ESM, since `require()` cannot load the WebAssembly package.

## Where each surface is documented

| Surface | Page |
| --- | --- |
| Pure TypeScript | [Getting started](getting-started.md) and the domain guides |
| WebAssembly and Node | [C++ core and surface differences](cpp.md) |
| Python | [Python](python.md) |
| Command line | [Command line](cli.md) |
| C++ | [C++ core and surface differences](cpp.md) |
| Errors and edge values on every surface | [Errors and validation](errors-and-validation.md) |

The guides show examples in TypeScript. Each function keeps its name in the other surfaces: `detectChord` is `detect_chord` in Python and C++, and `detectChord` for the command line.

## Install each surface

Pure TypeScript and WebAssembly:

```sh
yarn add @libraz/libcantus
yarn add @libraz/libcantus-wasm
```

Python:

```sh
pip install libcantus
```

The command-line tool is a single executable. Download the archive for your platform from the releases page of the repository (`cantus-linux-x86_64.tar.gz`, `cantus-linux-aarch64.tar.gz` or `cantus-macos-arm64.tar.gz`), extract it, and place the `cantus` file on `PATH`. The Linux binary is statically linked and needs no particular glibc. On macOS, a downloaded binary is quarantined; clear it once with `xattr -d com.apple.quarantine cantus`.

## Building from source

A checkout builds every surface with `make`. Builds run two jobs by default; set `JOBS=` to change that.

| Command | Result |
| --- | --- |
| `make build` | The C++ core, the command-line tool and the C++ tests in `build/` |
| `make test-cxx` | Build, then run the C++ tests |
| `make wasm` | `bindings/wasm/dist`, with the WebAssembly module (needs Emscripten) |
| `make build-node` | The Node-API addon and `bindings/node/dist` |
| `make build-shared` | `libcantus.{so,dylib}` for the Python binding |
| `make test-install` | Install to a scratch prefix and build outside projects against it |
| `make examples` | Build and run the examples under `examples/` (not the browser template) |

The Python binding finds the library in `build-shared/` in a checkout. Set `CANTUS_LIB` to load a different file.
