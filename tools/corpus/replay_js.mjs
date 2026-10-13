#!/usr/bin/env node
/**
 * Replay call-corpus files through a JS facade backend, with the comparison rules of the C ABI
 * replayer (tests/corpus/replay.cpp): results and errors are normalized to the op layer's wire
 * text and compared byte for byte, `$h` / `$id` values are paired (per file) with the ones this
 * process issues, and a `$cb` argument is answered with its argument array.
 *
 * Usage: node tools/corpus/replay_js.mjs --backend <name> [--min N] FILE...
 *   <name> is a surface package whose build exports `backend` from bindings/<name>/dist/backend.js.
 *   The pure TS backend runs through the boundary test instead (it is TS source).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function numberText(n) {
  if (Number.isNaN(n)) return '{"$n":"NaN"}';
  if (n === Number.POSITIVE_INFINITY) return '{"$n":"Infinity"}';
  if (n === Number.NEGATIVE_INFINITY) return '{"$n":"-Infinity"}';
  if (n === 0 && 1 / n < 0) return '{"$n":"-0"}';
  return String(n);
}

/** The op layer's serialization of a parsed wire value. */
export function stringifyWire(v) {
  if (typeof v === 'number') return numberText(v);
  if (Array.isArray(v)) return `[${v.map(stringifyWire).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    return `{${Object.keys(v)
      .map((k) => `${JSON.stringify(k)}:${stringifyWire(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Pairs recorded `$h` / `$id` values with this process's. */
class IdMap {
  #pairs = { $h: new Map(), $id: new Map() };
  #back = { $h: new Map(), $id: new Map() };

  bind(expected, actual) {
    if (Array.isArray(expected) && Array.isArray(actual)) {
      return expected.every((e, i) => i >= actual.length || this.bind(e, actual[i]));
    }
    if (
      typeof expected !== 'object' ||
      expected === null ||
      typeof actual !== 'object' ||
      actual === null
    ) {
      return true;
    }
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) continue;
      if (
        (key === '$h' || key === '$id') &&
        typeof expected[key] === 'number' &&
        typeof actual[key] === 'number'
      ) {
        const e = expected[key];
        const a = actual[key];
        const known = this.#pairs[key].get(e);
        const back = this.#back[key].get(a);
        if ((known !== undefined && known !== a) || (back !== undefined && back !== e))
          return false;
        this.#pairs[key].set(e, a);
        this.#back[key].set(a, e);
        expected[key] = a;
      } else if (!this.bind(expected[key], actual[key])) {
        return false;
      }
    }
    return true;
  }

  apply(args) {
    if (Array.isArray(args)) return args.map((a) => this.apply(a));
    if (typeof args !== 'object' || args === null) return args;
    const out = {};
    for (const [k, v] of Object.entries(args)) {
      const value = k === '$h' && this.#pairs.$h.has(v) ? this.#pairs.$h.get(v) : this.apply(v);
      Object.defineProperty(out, k, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return out;
  }
}

const echoArguments = (_id, argsJson) => argsJson;

/** Replay one parsed record; returns undefined when it matched, else what went wrong. */
function replayRecord(backend, record, ids) {
  if (typeof record.op !== 'string') return 'record has no "op"';
  const args =
    typeof record.args_raw === 'string'
      ? record.args_raw
      : stringifyWire(ids.apply(record.args ?? []));
  const reply = backend.call(record.op, args, echoArguments);
  const wantError = record.error !== undefined;
  if (wantError === (reply.status === 0)) {
    return `expected ${wantError ? 'an error' : 'a result'}, got status ${reply.status}: ${reply.json.slice(0, 400)}`;
  }
  const expected = structuredClone(wantError ? record.error : record.result);
  const actual = JSON.parse(reply.json);
  if (!ids.bind(expected, actual)) {
    return `handle or identity ids disagree with an earlier line: expected ${stringifyWire(expected)}, actual ${reply.json}`;
  }
  const want = stringifyWire(expected);
  const got = stringifyWire(actual);
  if (want !== got)
    return `args ${args.slice(0, 400)}\n  expected ${want.slice(0, 400)}\n  actual   ${got.slice(0, 400)}`;
  return undefined;
}

/**
 * Replay corpus files through `backend`.
 *
 * @param {{ call(op: string, argsJson: string, cb: unknown): { status: number; json: string } }} backend
 * @param {string[]} files JSONL corpus files.
 * @returns {{ replayed: number; skipped: number; mismatches: string[] }}
 */
export function replayCorpus(backend, files) {
  const out = { replayed: 0, skipped: 0, mismatches: [] };
  for (const file of files) {
    const ids = new IdMap();
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line === '') return;
      const record = JSON.parse(line);
      if (record.skip !== undefined) {
        out.skipped += 1;
        return;
      }
      out.replayed += 1;
      const problem = replayRecord(backend, record, ids);
      if (problem !== undefined) out.mismatches.push(`${file}:${index + 1}: ${problem}`);
    });
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  let name;
  let min = 1;
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--backend') name = argv[++i];
    else if (argv[i] === '--min') min = Number(argv[++i]);
    else files.push(argv[i]);
  }
  if (!name || files.length === 0) {
    console.error('usage: replay_js.mjs --backend <name> [--min N] FILE...');
    process.exit(2);
  }
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const { backend } = await import(
    pathToFileURL(path.join(repo, 'bindings', name, 'dist/backend.js')).href
  );
  const result = replayCorpus(backend, files);
  for (const m of result.mismatches) console.error(m);
  process.stdout.write(
    `replay_js: ${name}: replayed ${result.replayed} calls from ${files.length} files (${result.skipped} skipped), ${result.mismatches.length} mismatched` +
      '\n',
  );
  if (result.mismatches.length > 0 || result.replayed < Math.max(1, min)) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
