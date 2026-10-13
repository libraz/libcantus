/**
 * The seam a backend plugs into: one synchronous op entry point plus handle
 * release, mirroring `cantus_call` / `cantus_release` of the C ABI.
 *
 * The facade picks its backend through the `#backend` import (package.json
 * `imports`): this package maps it to the pure TS backend; the wasm and node
 * packages map it to a module whose `backend` export wraps their native core.
 * A backend module may finish its setup with top-level await; every call made
 * after the import resolves is synchronous.
 */

/** The outcome of one call: the C ABI status and its output JSON. */
export type CallReply = {
  /** `CANTUS_OK` (0) or one of the failure codes in `ERROR_CODES`. */
  status: number;
  /** The wire JSON of the result, or `{"code","name","message","at"?}` on failure. */
  json: string;
};

/**
 * The host function behind every `{"$cb": id}` argument of one call.
 *
 * @param id The id from the `$cb` tag.
 * @param argsJson Wire JSON array of the callback's arguments.
 * @returns The wire JSON of the return value, or undefined when the callback
 *   threw; the backend then reports `CALLBACK_FAILED` to the op's caller.
 */
export type HostCallback = (id: number, argsJson: string) => string | undefined;

/** A core the facade can call. */
export interface Backend {
  /**
   * Run one op.
   *
   * @param op Op name, e.g. `detectChord`, `Score#transpose`, `$echo`.
   * @param argsJson Wire JSON array of the positional arguments.
   * @param cb Host function for `$cb` arguments, or null when the call passes none.
   */
  call(op: string, argsJson: string, cb: HostCallback | null): CallReply;
  /** Release a handle (`{"$h": id}`); unknown and released ids are ignored. */
  release(handle: number): void;
}

/** What a `#backend` module exports. */
export type BackendModule = {
  backend: Backend;
};
