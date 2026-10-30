/**
 * The wasm backend's calls over a stand-in module: every allocation is freed on every way out of
 * a call, and a failed allocation throws before the core is reached.
 */
import { describe, expect, it } from 'vitest';
import { wasmBackend } from '../../wasm/src/calls.js';
import type { CantusModule } from '../../wasm/src/cantus.js';

/** Where the stand-in core writes its replies and the trampoline its out parameters. */
const REPLY_AT = 1 << 15;
const SCRATCH_AT = REPLY_AT + 1024;

/** A module whose `_malloc` fails on its `failAt`-th call, recording what is still allocated. */
function standIn(failAt = 0) {
  const memory = new Uint8Array(1 << 16);
  const heap32 = new Uint32Array(memory.buffer);
  const allocated = new Set<number>();
  const calls: string[] = [];
  let next = 8;
  let mallocs = 0;
  let trampoline: ((...args: number[]) => number) | undefined;
  const text = (ptr: number, len: number) =>
    new TextDecoder().decode(memory.subarray(ptr, ptr + len));
  const wasm: CantusModule = {
    HEAPU8: memory,
    HEAPU32: heap32,
    _malloc(size) {
      mallocs += 1;
      if (mallocs === failAt) return 0;
      const ptr = next;
      next += (size + 7) & ~7;
      allocated.add(ptr);
      return ptr;
    },
    _free(ptr) {
      allocated.delete(ptr);
    },
    _cantus_call(op, opLen, args, argsLen, cb, ctx, outJson, outLen) {
      calls.push(text(op, opLen));
      let reply = text(args, argsLen);
      if (cb !== 0 && trampoline !== undefined) {
        const failed = trampoline(ctx, 0, args, argsLen, SCRATCH_AT, SCRATCH_AT + 4);
        reply =
          failed === 0
            ? text(heap32[SCRATCH_AT >>> 2] ?? 0, heap32[(SCRATCH_AT + 4) >>> 2] ?? 0)
            : 'failed';
      }
      memory.set(new TextEncoder().encode(reply), REPLY_AT);
      heap32[outJson >>> 2] = REPLY_AT;
      heap32[outLen >>> 2] = reply.length;
      return 0;
    },
    _cantus_free() {},
    _cantus_release() {},
    _cantus_abi_version: () => 1,
    addFunction(fn) {
      trampoline = fn;
      return 1;
    },
  };
  return { wasm, allocated, calls };
}

describe('wasm backend calls', () => {
  it('frees what a call allocated once it returns', () => {
    const { wasm, allocated, calls } = standIn();
    const backend = wasmBackend(wasm);
    expect(backend.call('$echo', '[1]', null)).toEqual({ status: 0, json: '[1]' });
    expect(calls).toEqual(['$echo']);
    expect(allocated.size).toBe(0);
  });

  it('frees the op name when the arguments cannot be stored', () => {
    const { wasm, allocated, calls } = standIn(2);
    const backend = wasmBackend(wasm);
    expect(() => backend.call('$echo', '[1]', null)).toThrow(
      new RangeError('libcantus wasm: out of memory'),
    );
    expect(calls).toEqual([]);
    expect(allocated.size).toBe(0);
  });

  it('throws before the core is reached when the out parameters cannot be allocated', () => {
    const { wasm, allocated, calls } = standIn(3);
    const backend = wasmBackend(wasm);
    expect(() => backend.call('$call', '[{"$cb":0}]', () => '"first"')).toThrow(RangeError);
    expect(calls).toEqual([]);
    expect(allocated.size).toBe(0);
    // The failed call left no callback frame behind: the next call's callback is its own.
    expect(backend.call('$call', '[{"$cb":0}]', () => '"second"').json).toBe('"second"');
    expect(allocated.size).toBe(0);
  });
});
