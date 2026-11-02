# @libraz/libcantus-wasm

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/libcantus/ci.yml?branch=main&label=CI)](https://github.com/libraz/libcantus/actions)
[![npm](https://img.shields.io/npm/v/@libraz/libcantus-wasm)](https://www.npmjs.com/package/@libraz/libcantus-wasm)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/libcantus/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?logo=webassembly&logoColor=white)](https://webassembly.org/)

**The libcantus music-theory engine as WebAssembly: the same API and types as `@libraz/libcantus`, running the C++ core.**

Recover the harmony from MIDI note events and write new parts against it, in Node.js or the browser. Every call is synchronous once the module has loaded.

**[Documentation](https://github.com/libraz/libcantus/blob/main/docs/en/getting-started.md)** · **[Differences from pure TypeScript](https://github.com/libraz/libcantus/blob/main/docs/en/cpp.md)** · **[Repository](https://github.com/libraz/libcantus)**

## Install

Node.js 22 or later, or a browser.

```sh
yarn add @libraz/libcantus-wasm
```

The package root exports the whole API. `@libraz/libcantus-wasm/core`, `/theory`, `/analyze`, `/generate` and `/model` are narrower import boundaries onto the same symbols, with the same type declarations as `@libraz/libcantus`.

## Initialisation

There is none to call. The module instantiates with top-level await, so once the `import` resolves every function is ready and synchronous. The package is ESM only: use `import`, not `require()`, which fails with `ERR_REQUIRE_ASYNC_MODULE`. A CommonJS project uses `@libraz/libcantus`.

A bundler for the browser needs a build target of es2022 or later, and must keep `cantus.wasm` next to the module that loads it.

## Quick start

```js
import { InvalidInputError, Score, detectChord, detectChordBest } from '@libraz/libcantus-wasm';

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
  error.message; // 'pitches[0] must be an integer in [0, 127]; received 128'
}
```

## Switching from `@libraz/libcantus`

Code that imports `@libraz/libcantus` can run on this package unchanged. Install it under that name:

```sh
yarn add @libraz/libcantus@npm:@libraz/libcantus-wasm
```

or keep both installed and alias the name in the bundler, e.g. `resolve.alias: { '@libraz/libcantus': '@libraz/libcantus-wasm' }` in Vite. Subpaths follow the alias. See [Switching between pure TypeScript and WebAssembly](https://github.com/libraz/libcantus/blob/main/docs/en/packages.md#switching-between-pure-typescript-and-webassembly).

## Differences from pure TypeScript

Results, errors and messages are the same. What differs:

- **ESM only**, with top-level await, as above.
- **Objects are copied across the boundary.** A result is a fresh value on every call, so comparing two results by identity fails where it can succeed in pure TypeScript, and the per-object caches the pure package keeps do not apply.
- **Handles are released explicitly.** `createRng`, `NoteEventIndex` and `ArrangementSession` return handles with `[Symbol.dispose]`; a finalizer releases a forgotten one. The declarations of these handles reference TypeScript's `esnext.disposable` library, so they need TypeScript 5.2 or later.
- **Arguments cross as JSON.** A function argument is called back into JavaScript, and a cyclic object is cut where it repeats.

The complete list is in [C++ core and surface differences](https://github.com/libraz/libcantus/blob/main/docs/en/cpp.md), and the shared error table and edge-value behaviour are in [Errors and validation](https://github.com/libraz/libcantus/blob/main/docs/en/errors-and-validation.md).

## License

[Apache License 2.0](https://github.com/libraz/libcantus/blob/main/LICENSE).
