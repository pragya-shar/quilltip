import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: [
      'scripts/integration/local-network.test.ts',
      'scripts/integration/article-registration.test.ts',
    ],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
