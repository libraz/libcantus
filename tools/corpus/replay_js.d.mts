/** Types of replay_js.mjs, for the TS boundary test. */
export type ReplayBackend = {
  call(
    op: string,
    argsJson: string,
    cb: ((id: number, argsJson: string) => string | undefined) | null,
  ): { status: number; json: string };
};

/** Replay corpus files through `backend` with the C ABI replayer's comparison rules. */
export function replayCorpus(
  backend: ReplayBackend,
  files: readonly string[],
): { replayed: number; skipped: number; mismatches: string[] };

/** The op layer's serialization of a parsed wire value. */
export function stringifyWire(value: unknown): string;
