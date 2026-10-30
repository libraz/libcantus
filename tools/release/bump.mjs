#!/usr/bin/env node
/**
 * Write one release version into every site `tools/release/versions.json` lists.
 *
 * Each pattern must match exactly once in its file; nothing is written unless all of them do.
 * `tools/release/check_versions.py` checks the result.
 *
 * Usage: node tools/release/bump.mjs <major.minor.patch>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITES = path.join(REPO, 'tools/release/versions.json');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(`bump: ${message}`);
  process.exit(1);
}

const version = process.argv[2];
if (process.argv.length !== 3 || !SEMVER.test(version ?? '')) {
  if (/^\d+\.\d+\.\d+-/.test(version ?? '')) {
    fail(
      `${version}: a prerelease suffix is not accepted (CMake and PEP 440 take major.minor.patch)`,
    );
  }
  fail('usage: node tools/release/bump.mjs <major.minor.patch>');
}
const [, major, minor, patch] = SEMVER.exec(version);
const parts = { version, major, minor, patch };

const { sites } = JSON.parse(readFileSync(SITES, 'utf8'));
if (sites.length === 0) fail('versions.json lists no site');
const texts = new Map();
for (const site of sites) {
  const file = path.join(REPO, site.file);
  const text = texts.get(file) ?? readFileSync(file, 'utf8');
  const pattern = new RegExp(site.pattern, 'gm');
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) fail(`${site.file}: ${site.pattern} matches ${matches.length} times`);
  const [match, old] = matches[0];
  const at = matches[0].index + match.indexOf(old);
  texts.set(file, text.slice(0, at) + parts[site.part ?? 'version'] + text.slice(at + old.length));
}
for (const [file, text] of texts) writeFileSync(file, text);
process.stdout.write(`bump: ${sites.length} sites in ${texts.size} files now say ${version}\n`);
