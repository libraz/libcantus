/**
 * The facade backend over the wasm build of the C ABI.
 *
 * Instantiation happens once, with top-level await; every call after the import resolves is
 * synchronous. Each `call` copies the op name and the arguments into wasm memory as WTF-8 (lone
 * surrogates kept, as the core reads them), runs `cantus_call` and copies the result out. One
 * trampoline in the function table serves every callback: its `cb_ctx` names the call's frame,
 * and the frame owns the buffers handed back to the core until that call returns.
 */
import type { Backend, CallReply, HostCallback } from '../../js/src/backend.js';
import createCantusModule from './cantus.js';

/** CANTUS_ABI_VERSION this backend is written against. */
const ABI_VERSION = 1;
/** A nonzero trampoline return: the core reports CANTUS_CALLBACK_FAILED for it. */
const HOST_FAILED = 1;
/** Matches a lone surrogate (a paired one is a single code point under the `u` flag). */
const LONE_SURROGATE = /\p{Cs}/u;
/** Bytes for the `out_json` pointer and `out_len` of one call. */
const OUT_PARAMS_SIZE = 8;

const wasm = await createCantusModule();
if (wasm._cantus_abi_version() !== ABI_VERSION) {
  throw new Error(
    `libcantus wasm reports ABI version ${wasm._cantus_abi_version()}, expected ${ABI_VERSION}`,
  );
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** UTF-8 of `s`, with each lone surrogate written as its 3-byte WTF-8 sequence. */
function wtf8(s: string): Uint8Array {
  if (!LONE_SURROGATE.test(s)) return encoder.encode(s);
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Copy `s` into a fresh wasm allocation; the caller frees `ptr`. */
function store(s: string): { ptr: number; len: number } {
  const bytes = wtf8(s);
  const ptr = wasm._malloc(Math.max(bytes.length, 1));
  if (ptr === 0) throw new RangeError('libcantus wasm: out of memory');
  // Read HEAPU8 after the allocation: growing memory replaces the view.
  wasm.HEAPU8.set(bytes, ptr);
  return { ptr, len: bytes.length };
}

function load(ptr: number, len: number): string {
  return decoder.decode(wasm.HEAPU8.subarray(ptr, ptr + len));
}

/** The host side of one in-flight `cantus_call`. */
type Frame = { cb: HostCallback; buffers: number[] };

/** In-flight calls with callbacks, indexed by the `cb_ctx` each one passes. */
const frames: (Frame | undefined)[] = [];

const trampoline = wasm.addFunction(
  (ctx: number, id: number, argsPtr: number, argsLen: number, outPtr: number, lenPtr: number) => {
    const frame = frames[ctx];
    if (frame === undefined) return HOST_FAILED;
    let out: { ptr: number; len: number };
    try {
      const result = frame.cb(id, load(argsPtr, argsLen));
      if (result === undefined) return HOST_FAILED;
      out = store(result);
    } catch {
      // A JS exception must not unwind through wasm frames.
      return HOST_FAILED;
    }
    frame.buffers.push(out.ptr);
    wasm.HEAPU32[outPtr >>> 2] = out.ptr;
    wasm.HEAPU32[lenPtr >>> 2] = out.len;
    return 0;
  },
  'iiiiiii',
);

/** The wasm C ABI as a facade backend. */
export const backend: Backend = {
  call(op: string, argsJson: string, cb: HostCallback | null): CallReply {
    const name = store(op);
    const args = store(argsJson);
    const out = wasm._malloc(OUT_PARAMS_SIZE);
    let ctx = 0;
    let frame: Frame | undefined;
    if (cb !== null) {
      frame = { cb, buffers: [] };
      ctx = frames.length;
      frames.push(frame);
    }
    try {
      const status = wasm._cantus_call(
        name.ptr,
        name.len,
        args.ptr,
        args.len,
        cb === null ? 0 : trampoline,
        ctx,
        out,
        out + 4,
      );
      const ptr = wasm.HEAPU32[out >>> 2] as number;
      const len = wasm.HEAPU32[(out + 4) >>> 2] as number;
      if (ptr === 0) {
        return {
          status,
          json: '{"code":"INTERNAL","name":"Error","message":"cantus_call returned no output"}',
        };
      }
      const json = load(ptr, len);
      wasm._cantus_free(ptr);
      return { status, json };
    } finally {
      if (frame !== undefined) {
        frames.pop();
        for (const p of frame.buffers) wasm._free(p);
      }
      wasm._free(out);
      wasm._free(args.ptr);
      wasm._free(name.ptr);
    }
  },

  release(handle: number): void {
    wasm._cantus_release(BigInt(handle));
  },
};
