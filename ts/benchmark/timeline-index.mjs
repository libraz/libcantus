import { performance } from 'node:perf_hooks';
import { createNoteEventIndex } from '../dist/core/index.js';

for (const size of [1_000, 10_000, 100_000]) {
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const notes = Array.from({ length: size }, (_, index) => ({
    pitch: 60 + (index % 12),
    startBeat: index * 0.25,
    durationBeat: 0.5,
  }));
  const started = performance.now();
  const timeline = createNoteEventIndex(notes);
  for (let index = 0; index < size; index += 1) {
    timeline.at(index * 0.25);
  }
  const elapsedMs = performance.now() - started;
  const heapDeltaMiB = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
  process.stdout.write(`${JSON.stringify({ size, elapsedMs, heapDeltaMiB })}\n`);
}
