import { defineConfig } from 'vitest/config';

/** The facade's own tests: the boundary (per backend) and the class shapes. */
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['test/**/*.test.ts'],
    // The handle-release test drives the garbage collector.
    execArgv: ['--expose-gc'],
  },
});
