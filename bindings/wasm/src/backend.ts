/**
 * The facade backend over the wasm build of the C ABI.
 *
 * Instantiation happens once, with top-level await; every call after the import resolves is
 * synchronous. The calls themselves are in calls.ts.
 */
import type { Backend } from '../../js/src/backend.js';
import { wasmBackend } from './calls.js';
import createCantusModule from './cantus.js';

/** CANTUS_ABI_VERSION this backend is written against. */
const ABI_VERSION = 1;

const wasm = await createCantusModule();
if (wasm._cantus_abi_version() !== ABI_VERSION) {
  throw new Error(
    `libcantus wasm reports ABI version ${wasm._cantus_abi_version()}, expected ${ABI_VERSION}`,
  );
}

/** The wasm C ABI as a facade backend. */
export const backend: Backend = wasmBackend(wasm);
