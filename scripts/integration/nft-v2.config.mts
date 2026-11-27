import { defineConfig } from 'vitest/config'

// nftsV2 and the v2 NFT client on a local network: Convex functions in
// convex-test, Core and the NFT contract on the local standalone RPC. Needs QUILLTIP_WASM_DIR and a
// running local network (`bun scripts/integration/run.ts --start` starts one).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: [
      'scripts/integration/nft-v2.test.ts',
      'scripts/integration/nft-v2-client.test.ts',
    ],
    server: { deps: { inline: ['convex-test'] } },
    testTimeout: 300_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
