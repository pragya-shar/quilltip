/**
 * The fixture suites that `scripts/run-fixture-e2e.ts` runs, and the
 * `--suite` selection. CI runs them as parallel shards; the shard list in
 * `scripts/ci/shards.ts` must name every suite here
 * (`scripts/ci/fixture-shards.test.ts`), and `scripts/ci/plan.ts` runs only
 * the shards a change can affect. The rebuilt surfaces' suites come
 * from `e2e/suites/` (one file per package) and run together in one shard,
 * selected as `--suite @surfaces`.
 */
import { SURFACE_SUITES, type FixtureSuite } from '../e2e/suites'

/** Selects every suite from e2e/suites/. */
export const SURFACES_GROUP = '@surfaces'

const LEGACY_FIXTURES = [
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
    spec: 'e2e/wallet-(states|verification|coverage|connect|restore).spec.ts',
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
    // v2 article, highlight and basket tips in every state in Chromium; the
    // keyboard, focus and result tests in WebKit too (its own config).
    name: 'tips-v2',
    server: 'e2e/fixtures/tips-v2/server.mjs',
    port: 4179,
    spec: 'e2e/tips-v2.spec.ts',
    config: 'e2e/fixtures/tips-v2/playwright.config.ts',
    env: {
      TIPS_V2_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4179',
    },
  },
  {
    // The v2 article NFT: mint at the threshold and transfer, every state.
    name: 'nft-v2',
    server: 'e2e/fixtures/nft-v2/server.mjs',
    port: 4182,
    spec: 'e2e/nft-v2.spec.ts',
    env: {
      NFT_V2_FIXTURES: '1',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4182',
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
    // The passage tip from the balance, the balance and earnings screens, on
    // the real payments runtime over a stand-in backend: phone in Chromium
    // and WebKit, then tablet and desktop (its own config). No network.
    name: 'balance',
    server: 'e2e/fixtures/balance/server.mjs',
    port: 4184,
    spec: 'e2e/balance-tip.spec.ts',
    config: 'e2e/fixtures/balance/playwright.config.ts',
    env: {},
  },
] as const satisfies readonly FixtureSuite[]

export type Fixture = FixtureSuite

/** Every suite: the existing ones, then the rebuilt surfaces' suites. */
export const FIXTURES: readonly Fixture[] = [
  ...LEGACY_FIXTURES,
  ...SURFACE_SUITES,
]

/**
 * The suites named by `--suite a,b` (or `--suite=a,b`); every suite without
 * it. `@surfaces` names every suite from e2e/suites/ (possibly none).
 */
export function selectFixtures(
  argv: readonly string[],
  surfaces: readonly Fixture[] = SURFACE_SUITES
): Fixture[] {
  const all: readonly Fixture[] = [...LEGACY_FIXTURES, ...surfaces]
  const at = argv.findIndex((a) => a === '--suite' || a.startsWith('--suite='))
  if (at === -1) return [...all]
  const value = argv[at]!.includes('=')
    ? argv[at]!.slice('--suite='.length)
    : argv[at + 1]
  const asked = (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (asked.length === 0) {
    throw new Error('--suite needs one or more suite names')
  }
  const names = asked.flatMap((name) =>
    name === SURFACES_GROUP ? surfaces.map((suite) => suite.name) : [name]
  )
  const known = new Set<string>(all.map((fixture) => fixture.name))
  const unknown = names.filter((name) => !known.has(name))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown fixture suite: ${unknown.join(', ')}. Known: ${[...known].join(', ')}`
    )
  }
  return all.filter((fixture) => names.includes(fixture.name))
}
