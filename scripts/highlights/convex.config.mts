import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['scripts/highlights/*.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
})
