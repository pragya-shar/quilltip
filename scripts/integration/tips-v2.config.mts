import { defineConfig } from 'vitest/config'

// tipsV2 on a local network: Convex functions in convex-test, Core on the
// local standalone RPC. Needs QUILLTIP_WASM_DIR and a running local network
// (`bun scripts/integration/run.ts --start` starts one).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['scripts/integration/tips-v2.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
    testTimeout: 300_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
