import { defineConfig } from 'vitest/config'

// Plain unit tests for lib/ helpers and tooling that need no Convex runtime.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: [
      'scripts/network/*.test.ts',
      'scripts/profile/*.test.ts',
      'scripts/health/*.test.ts',
    ],
  },
})
