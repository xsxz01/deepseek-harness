import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/desktop/tests/shell.packaged.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
})
