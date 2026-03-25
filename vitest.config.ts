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
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['**/*.test.ts', '**/*.test.tsx'],
          exclude: ['node_modules', '.next', 'convex/**'],
          environment: 'node',
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
