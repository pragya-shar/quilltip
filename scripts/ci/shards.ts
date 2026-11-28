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

/**
 * What is wrong with a shard list, one sentence per problem: a shard that
 * names a suite `scripts/fixture-suites.ts` does not define, a suite whose
 * server file is gone, a shard left with no suite, a suite in no shard.
 */
export function shardProblems(
  shards: readonly Shard[],
  suites: readonly { name: string; server: string }[],
  surfaces: readonly { name: string }[],
  exists: (file: string) => boolean
): string[] {
  const problems: string[] = []
  const named = new Set<string>()
  for (const shard of shards) {
    for (const name of shard.suites.split(',').map((n) => n.trim())) {
      if (name === SURFACES_GROUP) {
        for (const s of surfaces) named.add(s.name)
        continue
      }
      named.add(name)
      const suite = suites.find((s) => s.name === name)
      if (!suite) {
        problems.push(
          `Shard "${shard.shard}" names suite "${name}", which scripts/fixture-suites.ts does not define: remove "${name}" from that shard in scripts/ci/shards.ts.`
        )
      } else if (!exists(suite.server)) {
        problems.push(
          `Suite "${name}" has no server at ${suite.server}: remove it from scripts/fixture-suites.ts and from shard "${shard.shard}" in scripts/ci/shards.ts.`
        )
      }
    }
    const kept = shard.suites
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n === SURFACES_GROUP || suites.some((s) => s.name === n))
    if (kept.length === 0) {
      problems.push(
        `Shard "${shard.shard}" has no suite left: remove it from scripts/ci/shards.ts.`
      )
    }
  }
  for (const suite of suites) {
    if (!named.has(suite.name)) {
      problems.push(
        `Suite "${suite.name}" is in no shard: add it to a shard in scripts/ci/shards.ts.`
      )
    }
  }
  return problems
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
