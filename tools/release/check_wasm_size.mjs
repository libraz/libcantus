#!/usr/bin/env node
/**
 * Check the built WebAssembly module against `bindings/wasm/wasm-size-budget.json`.
 *
 * The size is `gzip -9` output bytes, the measure `make wasm` prints. Run after `make wasm`.
 *
 * Usage: node tools/release/check_wasm_size.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fail as failTool, REPO } from '../corpus/lib.mjs';

const BUDGET = path.join(REPO, 'bindings/wasm/wasm-size-budget.json');

function fail(message) {
  failTool('check_wasm_size', message);
}

const budget = JSON.parse(readFileSync(BUDGET, 'utf8'));
const file = path.join(REPO, budget.file);
if (!existsSync(file)) fail(`${budget.file} does not exist; run make wasm`);
const raw = statSync(file).size;
if (raw === 0) fail(`${budget.file} is empty`);
const gzip = execFileSync('gzip', ['-9c', file], { maxBuffer: 1 << 30 }).length;
const share = ((gzip / budget.gzipBytes) * 100).toFixed(1);
const line = `${budget.file}: ${gzip} bytes gzip -9 (${raw} raw), budget ${budget.gzipBytes} (${share}%)`;
if (gzip > budget.gzipBytes) fail(`${line}: over budget`);
process.stdout.write(`check_wasm_size: ${line}\n`);
