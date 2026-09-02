#!/usr/bin/env node
// Regenerates the notated documentation figures.
//
//   node scripts/figures/build.mjs [outDir]   (default: docs/images)
//
// Each figure module renders every locale from one layout, so the English and
// Japanese pair cannot drift apart. Only the figures listed here are generated;
// the remaining diagrams in docs/images are hand-authored.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import cadence from './cadence.mjs';
import chords from './chords.mjs';
import interval from './interval.mjs';
import romanFunction from './roman-function.mjs';
import scaleDegrees from './scale-degrees.mjs';
import voiceLeading from './voice-leading.mjs';

const FIGURES = [interval, chords, scaleDegrees, romanFunction, cadence, voiceLeading];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = resolve(root, process.argv[2] ?? 'docs/images');
mkdirSync(outDir, { recursive: true });

for (const figure of FIGURES) {
  for (const [lang, loc] of Object.entries(figure.locales)) {
    const file = lang === 'en' ? `${figure.base}.svg` : `${figure.base}-${lang}.svg`;
    const svg = figure.render(loc);
    writeFileSync(join(outDir, file), svg);
    process.stdout.write(`${file.padEnd(24)} ${String(svg.length).padStart(6)} bytes\n`);
  }
}
