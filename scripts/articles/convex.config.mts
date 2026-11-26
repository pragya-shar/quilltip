import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'edge-runtime',
    include: ['scripts/articles/*.test.ts'],
    setupFiles: ['scripts/lib/edge-runtime-uint8array.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
})
