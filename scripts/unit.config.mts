import { defineConfig } from 'vitest/config'

// Plain unit tests for lib/ helpers and tooling that need no Convex runtime.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: [
      'scripts/network/*.test.ts',
      'scripts/profile/*.test.ts',
      'scripts/health/*.test.ts',
      'scripts/wallet/*.test.ts',
      'scripts/stellar/*.test.ts',
      // The other scripts/chain suites run in the edge runtime (test:chain).
      'scripts/chain/canonical-article.test.ts',
      'scripts/pr-hygiene/*.test.ts',
    ],
  },
})
