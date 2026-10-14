# @libraz/libcantus-node

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/libcantus/ci.yml?branch=main&label=CI)](https://github.com/libraz/libcantus/actions)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/libcantus/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**The libcantus music-theory engine as a Node-API addon: the same API and types as `@libraz/libcantus`, calling the C++ core natively.**

This package is not published to npm. A native addon has to be built for each platform and Node version; `@libraz/libcantus-wasm` gives a JavaScript application the same core without a build. Use this package from a checkout of the repository, for example to run the shared test suite against the native core or to avoid the WebAssembly runtime.

**[Documentation](https://github.com/libraz/libcantus/blob/main/docs/en/getting-started.md)** · **[Differences from pure TypeScript](https://github.com/libraz/libcantus/blob/main/docs/en/cpp.md)** · **[Repository](https://github.com/libraz/libcantus)**

## Install

Node.js 22 or later, CMake 3.24 and a C++17 compiler. From the repository root:

```sh
yarn install
make build-node
```

`make build-node` compiles the addon with cmake-js into `bindings/node/build/` and bundles `bindings/node/dist/`. The package is a workspace member, so another workspace package depends on it as `@libraz/libcantus-node`.

## Initialisation

There is none to call. The addon is loaded when the package is imported, and every function is synchronous. The package ships ESM and CommonJS builds, and both load the same addon.

## Quick start

```js
import { InvalidInputError, Score, detectChord, detectChordBest } from '@libraz/libcantus-node';

detectChordBest([60, 64, 67]);
// { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] }

const harmony = [[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 65], [48, 60, 64, 67]].flatMap(
  (pitches, bar) => pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);
Score.of(harmony).timeline().roman().map((entry) => entry.roman);
// ['I', 'IV', 'V7', 'I']

try {
  detectChord([128]);
} catch (error) {
  error instanceof InvalidInputError; // true
}
```

## Differences from pure TypeScript

Results, errors and messages are the same. What differs:

- **Objects are copied across the boundary.** A result is a fresh value on every call, so comparing two results by identity fails where it can succeed in pure TypeScript, and the per-object caches the pure package keeps do not apply.
- **Handles are released explicitly.** `createRng`, `NoteEventIndex` and `ArrangementSession` return handles with `[Symbol.dispose]`; a finalizer releases a forgotten one.
- **Arguments cross as JSON.** A function argument is called back into JavaScript, and a cyclic object is cut where it repeats.
- **The addon is platform-specific.** It is built for the Node-API version and platform of the machine that ran `make build-node`.

The complete list is in [C++ core and surface differences](https://github.com/libraz/libcantus/blob/main/docs/en/cpp.md), and the shared error table and edge-value behaviour are in [Errors and validation](https://github.com/libraz/libcantus/blob/main/docs/en/errors-and-validation.md).

## License

[Apache License 2.0](https://github.com/libraz/libcantus/blob/main/LICENSE).
