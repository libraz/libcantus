/** The emscripten module factory (`cantus.js`, built by cmake/CantusWasm.cmake). */

/** The C ABI of include/cantus/cantus_c.h as the module exports it; pointers and size_t are i32. */
export interface CantusModule {
  readonly HEAPU8: Uint8Array;
  readonly HEAPU32: Uint32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _cantus_call(
    op: number,
    opLen: number,
    args: number,
    argsLen: number,
    cb: number,
    cbCtx: number,
    outJson: number,
    outLen: number,
  ): number;
  _cantus_free(ptr: number): void;
  _cantus_release(handle: bigint): void;
  _cantus_abi_version(): number;
  addFunction(fn: (...args: number[]) => number, signature: string): number;
}

/** Instantiate the module; resolves once the wasm is compiled and ready for synchronous calls. */
export default function createCantusModule(options?: object): Promise<CantusModule>;
