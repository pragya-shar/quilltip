import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['scripts/articles/*.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
})
