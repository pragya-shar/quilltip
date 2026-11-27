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
      // v2 tip flow state, basket and amount rules (lib/tip/v2).
      'scripts/tip-flow/*.test.ts',
      // The other scripts/chain suites run in the edge runtime (test:chain).
      'scripts/chain/canonical-article.test.ts',
      'scripts/pr-hygiene/*.test.ts',
      'scripts/brand/*.test.ts',
      // The CI fixture shards against the fixture suite list.
      'scripts/ci/*.test.ts',
      'scripts/contracts/*.test.ts',
      'scripts/perf/*.test.ts',
      'scripts/payments/*.test.ts',
      'scripts/nft/*.test.ts',
      // The article storage status panel (components/articles/ArweaveStatus).
      'scripts/storage/*.test.ts',
      // Browser tab modules over fake-indexeddb and Node WebCrypto.
      'scripts/tab/*.test.ts',
      // Tab screens: flows and state models (lib/tab-ui).
      'scripts/tab-ui/*.test.ts',
      // Convex default-runtime code bundled as Convex bundles it.
      'scripts/convex-runtime/*.test.ts',
      // The design system: money figure layout, navigation config.
      'scripts/system/*.test.ts',
      // Files deleted by the rebuild stay deleted through merges.
      'scripts/rebuild/*.test.ts',
      // The balance (Pocket): one activity list from two, and its words.
      'scripts/pocket/*.test.ts',
    ],
  },
})
