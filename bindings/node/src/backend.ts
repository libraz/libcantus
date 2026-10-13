/**
 * The facade backend over the Node-API addon: every op goes through `cantus_call` of the native
 * core, synchronously on the calling thread. The facade's `#backend` import resolves here.
 */
import { createRequire } from 'node:module';
import type { Backend, CallReply, HostCallback } from '../../js/src/backend.js';

/** What the addon (src/addon.cpp) exports. */
type Addon = {
  call(op: string, argsJson: string, cb: HostCallback | null): CallReply;
  release(handle: number): void;
  version(): { version: string; algorithmVersion: number; abiVersion: number };
  listOps(): string;
};

/** One registered op, as `cantus_list_ops` describes it. */
export type OpInfo = { name: string; callbacks: boolean; handles: boolean };

// Resolved from the dist/ file this module is bundled into.
const addon = createRequire(import.meta.url)('../build/Release/cantus_node.node') as Addon;

/** The native core as a facade backend. */
export const backend: Backend = { call: addon.call, release: addon.release };

/** The library, algorithm and C ABI versions of the loaded core. */
export const version = addon.version();

/** The ops the loaded core registers, sorted by name. */
export function listOps(): OpInfo[] {
  return JSON.parse(addon.listOps()) as OpInfo[];
}
