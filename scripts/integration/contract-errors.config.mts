import { defineConfig } from 'vitest/config'

// Records contract failures on a local network for the error decoder. Needs
// QUILLTIP_WASM_DIR and a running local network (`bun scripts/integration/run.ts
// --start` starts one); QUILLTIP_ERROR_FIXTURES_OUT writes the fixture file.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['scripts/integration/contract-errors.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
