import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/lib': fileURLToPath(new URL('../../lib', import.meta.url)),
      '@/components': fileURLToPath(
        new URL('../../components', import.meta.url)
      ),
    },
  },
  test: {
    include: ['scripts/security/compatibility/*.test.{ts,tsx}'],
    // Let Vite convert the kit's CommonJS wallet SDKs (freighter-api) to ESM.
    server: { deps: { inline: ['@creit.tech/stellar-wallets-kit'] } },
  },
})
