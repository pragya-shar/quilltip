import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'edge-runtime',
    include: ['scripts/beta/*.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
})
