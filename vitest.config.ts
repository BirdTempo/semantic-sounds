import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Run test files one at a time. The renderer's performance-budget test
    // measures wall-clock time; letting Vitest run test files in parallel
    // worker threads makes that measurement compete with other files'
    // CPU use (e.g. the full-library validation in index.test.ts) for no
    // benefit on a suite this small.
    fileParallelism: false,
  },
});
