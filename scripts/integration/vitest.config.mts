import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: [
      'scripts/integration/local-network.test.ts',
      'scripts/integration/article-registration.test.ts',
      // The browser tab library against the Tab contract.
      'scripts/integration/tab-client.test.ts',
      // Contract failures decoded with the contract that raised them.
      'scripts/integration/contract-errors.test.ts',
    ],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
