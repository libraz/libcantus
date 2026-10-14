// Reads four bars of block chords through the native package.

import { detectChord, detectChordBest, InvalidInputError, Score } from '@libraz/libcantus-node';

process.stdout.write(`${JSON.stringify(detectChordBest([60, 64, 67]))}\n`);

const chords = [
  [48, 60, 64, 67],
  [41, 60, 65, 69],
  [43, 59, 62, 65],
  [48, 60, 64, 67],
];
const notes = chords.flatMap((pitches, bar) =>
  pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);
const numerals = Score.of(notes)
  .timeline()
  .roman()
  .map((entry) => entry.roman);
process.stdout.write(`${numerals.join(' ')}\n`);
if (numerals.join(' ') !== 'I IV V7 I') process.exit(1);

try {
  detectChord([128]);
  process.exit(1);
} catch (error) {
  if (!(error instanceof InvalidInputError)) throw error;
  process.stdout.write(`${error.message}\n`);
}
