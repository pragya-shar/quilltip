/**
 * The fixture suites that `scripts/run-fixture-e2e.ts` runs, and the
 * `--suite` selection. CI runs them as parallel shards; the shard list in
 * `.github/workflows/ci.yml` must name every suite here
 * (`scripts/ci/fixture-shards.test.ts`).
 */

export const FIXTURES = [
  {
    name: 'nft',
    server: 'e2e/fixtures/nft/server.mjs',
    port: 4174,
    spec: 'e2e/nft-presentation.spec.ts',
    env: { NFT_FIXTURES: '1' },
  },
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
    name: 'article-tips',
    server: 'e2e/fixtures/article-tips/server.mjs',
    port: 4178,
    spec: 'e2e/article-tips.spec.ts',
    env: {
      ARTICLE_TIPS_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4178',
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
