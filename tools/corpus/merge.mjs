#!/usr/bin/env node
/**
 * Merge the per-worker recordings of `yarn corpus` into the replayable corpus.
 *
 * Reads tests/corpus/out/raw/*.jsonl (written by record.mts; `seen` lines only name an op a spec
 * file called) and writes:
 *   ops/<op>.jsonl  one file per op (name URI-encoded): distinct calls, ordered by spec file and
 *                   position in it, each `{"op","args","result"|"error","file","seq"}`
 *   spec-ops.json   spec file -> every op it called, replayable or not
 *   stamp           hash of ts/src, bindings/js and tests/spec at recording time
 *   summary.json    counts
 * The `$const:` ops are added from bindings/js/src/generated/consts.json, which is what the facade
 * hands out without a call. The raw files are removed once merged, so the next recording starts
 * from nothing. Two recordings of one call that disagree fail the merge.
 *
 * Usage: node tools/corpus/merge.mjs
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  computeStamp,
  fail,
  OPS_DIR,
  OUT,
  opFile,
  RAW,
  REPO,
  readJson,
  SPEC_OPS,
  STAMP,
} from './lib.mjs';

const TOOL = 'merge';
const CONSTS = path.join(REPO, 'bindings/js/src/generated/consts.json');

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function main() {
  if (!existsSync(RAW)) fail(TOOL, 'nothing recorded under tests/corpus/out/raw; run yarn corpus');
  const rawFiles = readdirSync(RAW).filter((f) => f.endsWith('.jsonl'));
  if (rawFiles.length === 0) fail(TOOL, 'nothing recorded under tests/corpus/out/raw');

  const specOps = new Map();
  const records = [];
  const skipped = {};
  let calls = 0;
  for (const name of rawFiles) {
    for (const line of readFileSync(path.join(RAW, name), 'utf8').split('\n')) {
      if (line === '') continue;
      const r = JSON.parse(line);
      calls += 1;
      if (!specOps.has(r.file)) specOps.set(r.file, new Set());
      specOps.get(r.file).add(r.op);
      if (r.seen !== undefined) continue;
      if (r.skip !== undefined) {
        skipped[r.skip] = (skipped[r.skip] ?? 0) + 1;
        continue;
      }
      records.push(r);
    }
  }
  for (const [op, entry] of Object.entries(readJson(CONSTS))) {
    records.push({ file: '(consts)', seq: 0, op: `$const:${op}`, args: [], result: entry.wire });
  }

  records.sort((a, b) => compare(a.op, b.op) || compare(a.file, b.file) || a.seq - b.seq);
  const byOp = new Map();
  const seen = new Map();
  const conflicts = [];
  for (const r of records) {
    const call = JSON.stringify([r.op, r.args]);
    const outcome = JSON.stringify(
      r.error === undefined ? { result: r.result } : { error: r.error },
    );
    const known = seen.get(call);
    if (known !== undefined) {
      if (known !== outcome) conflicts.push(`${r.op} in ${r.file}`);
      continue;
    }
    seen.set(call, outcome);
    const line = { op: r.op, args: r.args };
    if (r.error === undefined) line.result = r.result;
    else line.error = r.error;
    line.file = r.file;
    line.seq = r.seq;
    if (!byOp.has(r.op)) byOp.set(r.op, []);
    byOp.get(r.op).push(JSON.stringify(line));
  }
  if (conflicts.length > 0) {
    fail(
      TOOL,
      `${conflicts.length} calls recorded with different outcomes, e.g. ${conflicts.slice(0, 5).join('; ')}`,
    );
  }
  if (byOp.size === 0) fail(TOOL, 'no replayable call was recorded');

  rmSync(OPS_DIR, { recursive: true, force: true });
  mkdirSync(OPS_DIR, { recursive: true });
  let distinct = 0;
  for (const [op, lines] of byOp) {
    writeFileSync(opFile(op), `${lines.join('\n')}\n`);
    distinct += lines.length;
  }
  const specOut = {};
  for (const file of [...specOps.keys()].sort()) specOut[file] = [...specOps.get(file)].sort();
  writeFileSync(SPEC_OPS, `${JSON.stringify(specOut, null, 1)}\n`);
  writeFileSync(STAMP, `${computeStamp()}\n`);
  const summary = {
    calls,
    replayable: calls - Object.values(skipped).reduce((a, b) => a + b, 0),
    distinct,
    ops: byOp.size,
    specFiles: Object.keys(specOut).filter((f) => f.startsWith('tests/spec/')).length,
    skipped,
  };
  writeFileSync(path.join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
  rmSync(RAW, { recursive: true, force: true });
  process.stdout.write(
    `merge: ${calls} calls (${summary.replayable} replayable) -> ${distinct} distinct over ${byOp.size} ops; ` +
      `${summary.specFiles} spec files; skipped ${JSON.stringify(skipped)}` +
      '\n',
  );
}

main();
