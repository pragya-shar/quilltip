import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { closureEntries } from './plan'

const root = path.join(__dirname, '../..')

type Row = {
  file: string
  app: boolean
  contracts: boolean
  integration: boolean
  shards: string[]
  shardsWithSuites: string[]
}

/**
 * Plans single-file changes through the real planner: inputs computed from
 * this tree, scanned for inputs named as strings, grown to a fixed point.
 * The rows name jobs, not suites, so deleting a fixture suite cannot break
 * them.
 */
function probe(files: string[]): Map<string, Row> {
  const bun = process.env.npm_execpath?.includes('bun')
    ? process.env.npm_execpath
    : 'bun'
  const run = spawnSync(bun, ['scripts/ci/plan.ts', '--probe', ...files], {
    cwd: root,
    encoding: 'utf8',
  })
  expect(run.status, run.stderr).toBe(0)
  const rows = JSON.parse(run.stdout) as Row[]
  return new Map(rows.map((r) => [r.file, r]))
}

describe('the planner, wired to its real inputs', () => {
  const rows = probe([
    'convex/tabs.ts',
    'convex/chain/indexer.ts',
    'scripts/lib/edge-runtime-uint8array.ts',
    'lib/stellar/v2/bindings/newcontract/index.ts:A',
    'lib/articles/publishedLock.ts',
    'patches/some-package@1.0.0.patch:A',
    'app/(app)/(public)/signin/page.tsx:A',
    'app/(legacy)/newsegment/page.tsx:A',
    'app/(legacy)/newsegment/page.tsx',
    'lib/security/contentSecurityPolicy.ts',
    'contracts/core/src/lib.rs',
    'docs/workflow/ci-pipeline.md',
  ])
  const row = (file: string) => rows.get(file)!
  const everyShard = (file: string) =>
    expect(row(file).shards, file).toEqual(row(file).shardsWithSuites)

  it('runs the local-network job for what its tests load by glob or setup file', () => {
    for (const file of [
      'convex/tabs.ts',
      'convex/chain/indexer.ts',
      'scripts/lib/edge-runtime-uint8array.ts',
      'lib/stellar/v2/bindings/newcontract/index.ts:A',
    ]) {
      expect(row(file).integration, file).toBe(true)
    }
  })

  it('follows the files a glob reaches to what they import', () => {
    // convex/ imports it; no integration test imports it directly.
    expect(row('lib/articles/publishedLock.ts').integration).toBe(true)
  })

  it('runs every shard for a patch, a new sign-in page, a new legacy page, the CSP module', () => {
    everyShard('patches/some-package@1.0.0.patch:A')
    everyShard('app/(app)/(public)/signin/page.tsx:A')
    everyShard('app/(legacy)/newsegment/page.tsx:A')
    everyShard('lib/security/contentSecurityPolicy.ts')
    expect(row('patches/some-package@1.0.0.patch:A').integration).toBe(true)
  })

  it('reads the route trees by name only: an edit to a page is not a new path', () => {
    expect(row('app/(legacy)/newsegment/page.tsx').shards).toEqual([])
  })

  it('runs contracts, not the app, for a contract file; nothing but the always-on jobs for docs', () => {
    const contract = row('contracts/core/src/lib.rs')
    expect([contract.contracts, contract.integration, contract.app]).toEqual([
      true,
      true,
      false,
    ])
    const docs = row('docs/workflow/ci-pipeline.md')
    expect([docs.app, docs.contracts, docs.integration, docs.shards]).toEqual([
      false,
      false,
      false,
      [],
    ])
  })
}, 120_000)

describe('a suite closure', () => {
  it('starts from the server process, not only its bundle', () => {
    const entries = closureEntries(
      { server: 'e2e/fixtures/x/server.mjs' },
      ['/repo/e2e/x.spec.ts'],
      '/repo/playwright.config.ts',
      '/repo/e2e/global-setup.ts'
    )
    expect(entries).toContain(path.join(root, 'e2e/fixtures/x/server.mjs'))
    expect(entries).toContain('/repo/e2e/global-setup.ts')
  })
})
