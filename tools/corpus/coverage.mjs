#!/usr/bin/env node
/**
 * Check that the recorded corpus covers the API: every op in api/manifest.json has at least one
 * replayable call, unless api/annotations.json lists it with a reason, under `unrecordable` (its
 * calls cannot be replayed) or `unexercised` (the shared suite never calls it). A listed op that
 * did get recorded is reported too, so the lists cannot go stale.
 *
 * Usage: node tools/corpus/coverage.mjs
 */
import { ANNOTATIONS, MANIFEST, readJson, recordedCalls, requireFreshCorpus } from './lib.mjs';

const TOOL = 'coverage';

function main() {
  requireFreshCorpus(TOOL);
  const manifest = readJson(MANIFEST);
  const annotations = readJson(ANNOTATIONS);
  const calls = recordedCalls();
  const ops = new Set(manifest.ops.map((op) => op.name));
  const listed = new Map();
  const problems = [];
  for (const entry of [...(annotations.unrecordable ?? []), ...(annotations.unexercised ?? [])]) {
    if (!ops.has(entry.op)) problems.push(`unrecordable names unknown op ${entry.op}`);
    if (typeof entry.reason !== 'string' || entry.reason === '')
      problems.push(`${entry.op}: no reason`);
    if (listed.has(entry.op)) problems.push(`${entry.op}: listed twice`);
    listed.set(entry.op, entry.reason);
  }
  const missing = [];
  const stale = [];
  let covered = 0;
  for (const op of ops) {
    const n = calls.get(op) ?? 0;
    if (listed.has(op)) {
      if (n > 0) stale.push(op);
    } else if (n === 0) {
      missing.push(op);
    } else {
      covered += 1;
    }
  }
  if (missing.length > 0)
    problems.push(`${missing.length} recordable ops have no recorded call: ${missing.join(', ')}`);
  if (stale.length > 0)
    problems.push(
      `${stale.length} ops listed as unrecordable or unexercised were recorded: ${stale.join(', ')}`,
    );
  for (const p of problems) console.error(`coverage: ${p}`);
  process.stdout.write(
    `coverage: ${covered} ops recorded, ${listed.size} unrecordable, ${missing.length} missing (of ${ops.size})\n`,
  );
  if (problems.length > 0 || covered === 0) process.exit(1);
}

main();
