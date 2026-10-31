import { defineConfig } from 'vitest/config';

// Coverage of src counts both suites that run it: the TS-only tests here and the shared spec
// suite under its default CANTUS_IMPL=ts, which holds most of the behavioural tests.
export default defineConfig({
  test: {
    projects: [
      { extends: './vitest.config.ts', test: { name: 'ts' } },
      '../tests/spec/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
