import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['scripts/highlights/*.test.ts'],
    setupFiles: ['scripts/lib/edge-runtime-uint8array.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
})
