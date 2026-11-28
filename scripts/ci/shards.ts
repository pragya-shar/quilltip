/**
 * The fixture shards of the CI job `e2e-fixtures`, one job each. Every suite
 * in `scripts/fixture-suites.ts` is in exactly one shard
 * (`scripts/ci/fixture-shards.test.ts`). `scripts/ci/plan.ts` turns this list
 * into the job's matrix, keeping only the shards that a change can affect.
 */
import { SURFACES_GROUP } from '../fixture-suites'

export type Shard = {
  /** The job name says `Playwright (fixtures, <shard>)`. */
  shard: string
  /** `--suite` value for `scripts/run-fixture-e2e.ts`. */
  suites: string
  /** Playwright engines to install, separated by spaces. */
  browsers: string
}

export const SHARDS: readonly Shard[] = [
  {
    shard: 'presentation',
    suites: 'nft,recovery,avatar',
    browsers: 'chromium',
  },
  { shard: 'payments', suites: 'payments', browsers: 'chromium' },
  { shard: 'wallet', suites: 'wallet', browsers: 'chromium' },
  { shard: 'article-tips', suites: 'article-tips', browsers: 'chromium' },
  // Every state in Chromium; keyboard, focus and results in WebKit.
  { shard: 'tips-v2', suites: 'tips-v2', browsers: 'chromium webkit' },
  { shard: 'nft-v2', suites: 'nft-v2', browsers: 'chromium' },
  // The tab session-key suite runs in all three engines.
  { shard: 'tab', suites: 'tab', browsers: 'chromium firefox webkit' },
  // The tab screens: every state in Chromium, key paths in all three.
  { shard: 'tab-ui', suites: 'tab-ui', browsers: 'chromium firefox webkit' },
  // The balance tip and screens: phone in Chromium and WebKit.
  { shard: 'balance', suites: 'balance', browsers: 'chromium webkit' },
  // The design system gallery and the application shell: three widths with
  // real touch and keys, in Chromium and WebKit.
  { shard: 'system', suites: 'system', browsers: 'chromium webkit' },
  // Every rebuilt surface's suite (e2e/suites/, one file per package), in
  // Chromium and WebKit. A package adds its file, never a shard.
  { shard: 'surfaces', suites: SURFACES_GROUP, browsers: 'chromium webkit' },
]
