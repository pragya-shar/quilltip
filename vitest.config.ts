import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'convex',
          include: ['convex/**/*.test.ts'],
          exclude: ['node_modules', 'convex/_generated'],
          environment: 'edge-runtime',
          // Scheduled-function tests share fake DB state; run files one at a time.
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['**/*.test.ts', '**/*.test.tsx'],
          exclude: ['node_modules', '.next', 'convex/**'],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          // UI interaction tests can exceed 10s when the full suite runs in parallel.
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['lib/**/*.ts', 'convex/**/*.ts'],
      exclude: ['**/*.test.ts', 'convex/_generated/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
