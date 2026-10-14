#!/usr/bin/env node
/**
 * Pre-tag checks of what a release publishes, after the packages are built.
 *
 *   CHANGELOG.md   has a dated `## [<version>] - YYYY-MM-DD` section for the ts/package.json version
 *   LICENSE        every package directory's copy is the repository's
 *   npm packages   each published one is not private and packs its README, LICENSE, the files
 *                  its `exports` name and their declarations; the private ones stay private
 *
 * Usage: node tools/release/check_release.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** npm packages the release publishes. */
const PUBLISHED = ['ts', 'bindings/wasm'];
/** Workspace packages that are never published. */
const PRIVATE = ['bindings/js', 'bindings/node'];
const LICENSES = ['ts/LICENSE', 'bindings/wasm/LICENSE'];

const problems = [];
const read = (file) => readFileSync(path.join(REPO, file), 'utf8');
const log = (line) => process.stdout.write(`${line}\n`);

const version = JSON.parse(read('ts/package.json')).version;
const escaped = version.replace(/[.+-]/g, '\\$&');
if (!new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(read('CHANGELOG.md'))) {
  problems.push(`CHANGELOG.md has no dated section for ${version}`);
}

const license = read('LICENSE');
for (const copy of LICENSES) {
  if (read(copy) !== license) problems.push(`${copy} differs from LICENSE`);
}

/** Every file path an `exports` map names. */
function exportTargets(exports) {
  if (typeof exports === 'string') return [exports];
  return Object.values(exports ?? {}).flatMap(exportTargets);
}

for (const dir of PUBLISHED) {
  const pkg = JSON.parse(read(`${dir}/package.json`));
  if (pkg.private) problems.push(`${dir}/package.json is private`);
  const out = execFileSync('yarn', ['pack', '--dry-run', '--json'], {
    cwd: path.join(REPO, dir),
    encoding: 'utf8',
  });
  const packed = new Set(
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).location)
      .filter(Boolean),
  );
  const wanted = [
    'README.md',
    'LICENSE',
    'package.json',
    ...exportTargets(pkg.exports).map((f) => f.replace(/^\.\//, '')),
  ];
  for (const file of new Set(wanted)) {
    if (!packed.has(file)) problems.push(`${pkg.name}: the package does not carry ${file}`);
  }
  log(`${pkg.name}@${pkg.version}: ${packed.size} files`);
}
for (const dir of PRIVATE) {
  if (!JSON.parse(read(`${dir}/package.json`)).private) {
    problems.push(`${dir}/package.json must stay private`);
  }
}

for (const problem of problems) console.error(`check_release: ${problem}`);
if (problems.length > 0) process.exit(1);
log(`check_release: ${version} is ready to tag`);
