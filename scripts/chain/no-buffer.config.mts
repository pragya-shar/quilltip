import { defineConfig } from 'vitest/config'

// The tab suites again, without a global Buffer (the Convex default runtime
// has none): prepare, sign, accept and settle must not rely on it.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'edge-runtime',
    include: [
      'scripts/chain/tab-encoding.test.ts',
      'scripts/chain/tab-ledger.test.ts',
      'scripts/chain/tab-settler.test.ts',
    ],
    setupFiles: [
      'scripts/lib/edge-runtime-uint8array.ts',
      'scripts/chain/no-buffer-global.ts',
    ],
    server: { deps: { inline: ['convex-test'] } },
  },
})
