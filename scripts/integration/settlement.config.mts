import { defineConfig } from 'vitest/config'

/**
 * Tab settlement on the local network, with the Convex ledger in convex-test.
 * Run through `scripts/integration/run.ts`, which starts the network and
 * builds the contracts, or directly with QUILLTIP_WASM_DIR set.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'edge-runtime',
    include: ['scripts/integration/tab-settlement.test.ts'],
    setupFiles: ['scripts/lib/edge-runtime-uint8array.ts'],
    server: { deps: { inline: ['convex-test'] } },
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
})
