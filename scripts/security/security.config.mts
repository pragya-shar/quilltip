import { defineConfig } from 'vitest/config'

// Security regressions: the dependency audit CLI and the content security
// policy that proxy.ts sends with every page.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: [
      'scripts/security/audit.test.ts',
      'scripts/security/content-security-policy.test.ts',
    ],
  },
})
