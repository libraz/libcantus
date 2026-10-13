#!/usr/bin/env node
/**
 * Print the spec files whose recorded ops are all registered in the C++ registry.
 *
 * The registry is read through the C ABI replayer (`cantus_list_ops`). A spec file that called no
 * op at all is never selected: it exercises nothing a port adds. An empty selection fails.
 *
 * Usage:
 *   node tools/corpus/select.mjs [--build-dir DIR] [--unit ID]
 *       print the ready spec files, one per line; with --unit, also fail unless every file the
 *       unit and its dependencies make ready is among them
 *   node tools/corpus/select.mjs --expected [--write]
 *       per unit: its ops, recorded calls, and the spec files it makes ready beyond its
 *       dependencies; --write stores the counts as `expected` in api/units.json
 */
import { writeFileSync } from 'node:fs';
import {
  fail,
  formatJson,
  MANIFEST,
  opsOfUnit,
  readJson,
  recordedCalls,
  registeredOps,
  requireFreshCorpus,
  SPEC_OPS,
  UNITS,
} from './lib.mjs';

const TOOL = 'select';

function parseArgs(argv) {
  const args = { buildDir: undefined, unit: undefined, expected: false, write: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--build-dir') args.buildDir = argv[++i];
    else if (argv[i] === '--unit') args.unit = argv[++i];
    else if (argv[i] === '--expected') args.expected = true;
    else if (argv[i] === '--write') args.write = true;
    else fail(TOOL, `unknown argument ${argv[i]}`);
  }
  return args;
}

/** Spec file -> the ops it called, for spec files that called at least one. */
function specFiles() {
  const all = readJson(SPEC_OPS);
  return Object.entries(all).filter(
    ([file, ops]) => file.startsWith('tests/spec/') && ops.length > 0,
  );
}

function readyWith(files, registered) {
  return files.filter(([, ops]) => ops.every((op) => registered.has(op))).map(([file]) => file);
}

/** The unit and every unit it depends on, transitively. */
function closure(units, id, out = new Set()) {
  if (out.has(id)) return out;
  out.add(id);
  for (const dep of units.units.find((u) => u.id === id)?.depends ?? []) closure(units, dep, out);
  return out;
}

function opsOfClosure(manifest, units, id) {
  const ops = new Set();
  for (const u of closure(units, id)) {
    if (units.units.some((x) => x.id === u))
      for (const op of opsOfUnit(manifest, units, u)) ops.add(op);
  }
  return ops;
}

function expected(args) {
  const manifest = readJson(MANIFEST);
  const units = readJson(UNITS);
  const files = specFiles();
  const calls = recordedCalls();
  const rows = [];
  for (const unit of units.units) {
    const ops = opsOfUnit(manifest, units, unit.id);
    const replay = ops.reduce((n, op) => n + (calls.get(op) ?? 0), 0);
    const ready = new Set(readyWith(files, opsOfClosure(manifest, units, unit.id)));
    const before = new Set();
    for (const dep of unit.depends) {
      if (!units.units.some((u) => u.id === dep)) continue;
      for (const f of readyWith(files, opsOfClosure(manifest, units, dep))) before.add(f);
    }
    const fresh = [...ready].filter((f) => !before.has(f)).length;
    rows.push({ unit: unit.id, ops: ops.length, replay, specFiles: fresh, cumulative: ready.size });
    unit.expected = { replay, spec_files: fresh };
  }
  process.stdout.write('unit  ops  replay  spec_files  cumulative\n');
  for (const r of rows) {
    process.stdout.write(
      `${r.unit.padEnd(5)} ${String(r.ops).padStart(4)} ${String(r.replay).padStart(7)} ${String(r.specFiles).padStart(11)} ${String(r.cumulative).padStart(11)}` +
        '\n',
    );
  }
  process.stdout.write(`spec files with ops: ${files.length}\n`);
  if (args.write) {
    writeFileSync(UNITS, formatJson(UNITS, units));
    process.stdout.write('select: wrote expected counts to api/units.json\n');
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  requireFreshCorpus(TOOL);
  if (args.expected) {
    expected(args);
    return;
  }
  const registered = registeredOps(TOOL, args.buildDir);
  const files = specFiles();
  const selected = readyWith(files, registered);
  if (selected.length === 0) {
    fail(TOOL, `selection empty: none of ${files.length} spec files has all its ops registered`);
  }
  if (args.unit !== undefined) {
    const manifest = readJson(MANIFEST);
    const units = readJson(UNITS);
    const want = readyWith(files, opsOfClosure(manifest, units, args.unit));
    const have = new Set(selected);
    const missing = want.filter((f) => !have.has(f));
    if (missing.length > 0) {
      fail(
        TOOL,
        `${missing.length} spec files ${args.unit} should make ready are not, e.g. ${missing.slice(0, 5).join(', ')}`,
      );
    }
  }
  console.error(`select: ${selected.length} of ${files.length} spec files ready`);
  process.stdout.write(`${selected.join('\n')}\n`);
}

main();
