import type { FixtureSuite } from './types'

/** The pocket package's fixture suites. Owned by that package. */
export const suites: readonly FixtureSuite[] = [
  {
    // The balance on the application shell, on fixture money: phone and
    // desktop in Chromium and WebKit, and /pocket with no script.
    name: 'pocket',
    server: 'e2e/fixtures/pocket/server.mjs',
    port: 4210,
    spec: 'e2e/pocket(-no-script)?.spec.ts',
    config: 'e2e/fixtures/pocket/playwright.config.ts',
    env: { POCKET_FIXTURES: '1' },
  },
  {
    // Add money, quick tips and turning them off, on an emulated wallet
    // and network: phones at 360, 390 and 412 in Chromium and WebKit.
    name: 'add-money',
    server: 'e2e/fixtures/add-money/server.mjs',
    port: 4212,
    spec: 'e2e/add-money.spec.ts',
    config: 'e2e/fixtures/add-money/playwright.config.ts',
    env: { ADD_MONEY_FIXTURES: '1' },
  },
]
