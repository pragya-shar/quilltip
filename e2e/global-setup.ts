/**
 * Runs once before any Playwright suite. Browser tests target a local app
 * server only. Runs that use a Convex backend also pass the operational
 * testnet guard; fixture runs (`bun run test:e2e:fixtures`) use no backend.
 */
import type { FullConfig } from '@playwright/test'

import {
  assertLocalBaseUrl,
  assertScriptTestnetOnly,
} from '../scripts/lib/network-guard'

export const E2E_FIXTURES_ENV = 'QUILLTIP_E2E_FIXTURES'

export default function globalSetup(config: FullConfig): void {
  for (const project of config.projects) {
    assertLocalBaseUrl('playwright e2e', project.use.baseURL)
  }
  if (process.env[E2E_FIXTURES_ENV] === '1') return
  assertScriptTestnetOnly('playwright e2e')
}
