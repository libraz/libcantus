/**
 * The corpus recorder the pure TS backend calls when `CANTUS_RECORD=1`.
 *
 * Each vitest worker appends to its own file under tests/corpus/out/raw/. A
 * call is written with the spec file running it, its position in that file,
 * the op, its arguments and its result or error. A call that passes or returns
 * a callback or handle, or a hybrid whose payload could not be read, is written
 * as a `skip` line instead: replay cannot reproduce it, but the spec file still
 * depends on the op. `$ref` keys are removed, since only this backend reads
 * them. Builtin `$` ops other than `$const:` are not recorded.
 *
 * A worker writes a call it has already written once, and keeps at most
 * PER_FILE_OP calls (BYTES_PER_FILE_OP bytes) per spec file and op; the first
 * call of each spec file and op is always written, as a `seen` line when it is
 * a repeat, so spec-ops.json still lists every op a file calls.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { threadId } from 'node:worker_threads';
import { expect } from 'vitest';
import type { RecordedCall, Recorder } from '../../bindings/js/src/backends/ts.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = path.join(REPO, 'tests/corpus/out/raw');
/** Calls kept per spec file and op: a sweep over one large input adds volume, not coverage. */
const PER_FILE_OP = 200;
/** Bytes kept per spec file and op. */
const BYTES_PER_FILE_OP = 4 << 20;

type Wire = null | boolean | number | string | Wire[] | { [key: string]: Wire };

/** Remove `$ref`, and report the tags that keep a value out of replay. */
function strip(v: Wire, found: Set<string>): Wire {
  if (Array.isArray(v)) return v.map((e) => strip(e, found));
  if (typeof v !== 'object' || v === null) return v;
  const out: { [key: string]: Wire } = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === '$ref') continue;
    if (k === '$cb' || k === '$h') found.add(k);
    out[k] = strip(x, found);
  }
  return out;
}

function currentFile(): string {
  const testPath = expect.getState().testPath;
  return testPath ? path.relative(REPO, testPath).split(path.sep).join('/') : '(none)';
}

/** A recorder writing this worker's calls. */
export function createRecorder(): Recorder {
  mkdirSync(RAW, { recursive: true });
  const out = path.join(RAW, `${process.pid}-${threadId}.jsonl`);
  // Unbuffered: a vitest worker can end without an exit event, which would lose a buffer.
  const fd = openSync(out, 'a');
  const seq = new Map<string, number>();
  const kept = new Map<string, { calls: number; bytes: number }>();
  const written = new Set<string>();
  return (call: RecordedCall) => {
    if (call.op.startsWith('$') && !call.op.startsWith('$const:')) return;
    const file = currentFile();
    const n = seq.get(file) ?? 0;
    seq.set(file, n + 1);
    const head = { file, seq: n, op: call.op };
    const slot = `${file}\0${call.op}`;
    let budget = kept.get(slot);
    const first = budget === undefined;
    if (budget === undefined) {
      budget = { calls: 0, bytes: 0 };
      kept.set(slot, budget);
    }
    const capped = budget.calls >= PER_FILE_OP || budget.bytes >= BYTES_PER_FILE_OP;
    const hash = capped
      ? ''
      : createHash('sha1').update(call.op).update('\0').update(call.argsJson).digest('base64');
    if (capped || written.has(hash)) {
      if (first) writeSync(fd, `${JSON.stringify({ ...head, seen: 1 })}\n`);
      return;
    }
    written.add(hash);
    const found = new Set<string>();
    const args = strip(JSON.parse(call.argsJson) as Wire, found);
    const reply = strip(JSON.parse(call.reply.json) as Wire, found);
    let line: object;
    if (found.size > 0 || call.incomplete) {
      const reason = found.size > 0 ? [...found].sort().join(',') : 'hybrid payload';
      line = { ...head, skip: reason };
    } else if (call.reply.status === 0) {
      line = { ...head, args, result: reply };
    } else {
      line = { ...head, args, error: reply };
    }
    const text = `${JSON.stringify(line)}\n`;
    budget.calls += 1;
    budget.bytes += text.length;
    writeSync(fd, text);
  };
}
