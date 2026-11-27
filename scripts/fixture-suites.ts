/**
 * The fixture suites that `scripts/run-fixture-e2e.ts` runs, and the
 * `--suite` selection. CI runs them as parallel shards; the shard list in
 * `.github/workflows/ci.yml` must name every suite here
 * (`scripts/ci/fixture-shards.test.ts`).
 */

export const FIXTURES = [
  {
    name: 'recovery',
    server: 'e2e/fixtures/recovery/server.mjs',
    port: 4175,
    spec: 'e2e/recovery-presentation.spec.ts',
    env: { RECOVERY_FIXTURES: '1' },
  },
  {
    name: 'avatar',
    server: 'e2e/fixtures/avatar/server.mjs',
    port: 4176,
    spec: 'e2e/profile-avatar-focus.spec.ts',
    env: {
      AVATAR_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4176',
    },
  },
  {
    name: 'payments',
    server: 'e2e/fixtures/payments/server.mjs',
    port: 4180,
    spec: 'e2e/payment-states.spec.ts',
    env: {
      PAYMENT_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4180',
    },
  },
  {
    name: 'wallet',
    server: 'e2e/fixtures/wallet/server.mjs',
    port: 4177,
    spec: 'e2e/wallet-(states|verification|coverage|connect).spec.ts',
    env: {
      WALLET_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4177',
    },
  },
  {
    // Chromium, Firefox and WebKit (its own config); key storage and
    // WebCrypto Ed25519 differ between engines.
    name: 'tab',
    server: 'e2e/fixtures/tab/server.mjs',
    port: 4181,
    spec: 'e2e/tab-session-keys.spec.ts',
    config: 'e2e/fixtures/tab/playwright.config.ts',
    env: {},
  },
  {
    // Tab screens (#449) and the tip dialog's tab section (#546): every
    // state in Chromium, the session-key and voucher paths in Chromium,
    // Firefox and WebKit (its own config).
    name: 'tab-ui',
    server: 'e2e/fixtures/tab-ui/server.mjs',
    port: 4183,
    spec: 'e2e/(tab-ui(-keys)?|tab-tip-dialog).spec.ts',
    config: 'e2e/fixtures/tab-ui/playwright.config.ts',
    env: {},
  },
  {
    // The design system gallery and the application shell: 390 with touch,
    // 768 and 1440 in Chromium and WebKit (its own config).
    name: 'system',
    server: 'e2e/fixtures/system/server.mjs',
    port: 4185,
    spec: 'e2e/system-(gallery|shell).spec.ts',
    config: 'e2e/fixtures/system/playwright.config.ts',
    env: { SYSTEM_FIXTURES: '1' },
  },
  {
    // The article view on the application shell, on a fake payments
    // runtime: choosing a line, the tip bar by touch and keyboard, the tip
    // exactly once across a reload, the receipt sheet, the reader's place.
    // 390 with touch and 1440, in Chromium and WebKit (its own config).
    name: 'read',
    server: 'e2e/fixtures/read/server.mjs',
    port: 4189,
    spec: 'e2e/read.spec.ts',
    config: 'e2e/fixtures/read/playwright.config.ts',
    env: { READ_FIXTURES: '1' },
  },
] as const satisfies readonly {
  name: string
  server: string
  port: number
  spec: string
  config?: string
  env: Record<string, string>
}[]

export type Fixture = (typeof FIXTURES)[number]

/** The suites named by `--suite a,b` (or `--suite=a,b`); every suite without it. */
export function selectFixtures(argv: readonly string[]): Fixture[] {
  const at = argv.findIndex((a) => a === '--suite' || a.startsWith('--suite='))
  if (at === -1) return [...FIXTURES]
  const value = argv[at]!.includes('=')
    ? argv[at]!.slice('--suite='.length)
    : argv[at + 1]
  const names = (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.length === 0) {
    throw new Error('--suite needs one or more suite names')
  }
  const known = new Set<string>(FIXTURES.map((fixture) => fixture.name))
  const unknown = names.filter((name) => !known.has(name))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown fixture suite: ${unknown.join(', ')}. Known: ${[...known].join(', ')}`
    )
  }
  return FIXTURES.filter((fixture) => names.includes(fixture.name))
}
