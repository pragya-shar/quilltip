import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'edge-runtime',
    include: ['scripts/tips/*.test.ts', 'scripts/counts/*.test.ts'],
    setupFiles: ['scripts/lib/edge-runtime-uint8array.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
})
