import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Fixture } from '../fixture-suites'
import {
  decide,
  fullPlan,
  matches,
  outputs,
  serverLiterals,
  type Change,
  type Context,
  type Inputs,
} from './plan'
import { SHARDS, type Shard } from './shards'

const suite = (name: string): Fixture => ({
  name,
  server: `e2e/fixtures/${name}/server.mjs`,
  port: 4000,
  spec: `e2e/${name}.spec.ts`,
  env: {},
})
const SUITES = ['a', 'b', 'c'].map(suite)
const TEST_SHARDS: Shard[] = [
  { shard: 'ab', suites: 'a,b', browsers: 'chromium' },
  { shard: 'c', suites: 'c', browsers: 'chromium webkit' },
  { shard: 'surfaces', suites: '@surfaces', browsers: 'chromium webkit' },
]
const inputs = (files: string[], patterns: string[] = []): Inputs => ({
  files: new Set(files),
  patterns,
})
const SUITE_INPUTS = new Map<string, Inputs | undefined>([
  ['a', inputs(['lib/a.ts', 'lib/shared.ts'], ['e2e/fixtures/a/**'])],
  ['b', inputs(['lib/b.ts', 'lib/shared.ts'], ['e2e/fixtures/b/**'])],
  ['c', inputs(['lib/c.ts'], ['public/**'])],
])
const INTEGRATION = new Set(['lib/stellar/v2/client.ts'])

const changed = (...paths: string[]): Change[] =>
  paths.map((p) => ({ path: p, deleted: false }))
const SHARED_FILES = new Set(['lib/routing/atHandle.ts'])
const context = (more: Partial<Context> = {}): Context => ({
  suiteInputs: SUITE_INPUTS,
  integrationFiles: INTEGRATION,
  sharedFiles: SHARED_FILES,
  shards: TEST_SHARDS,
  allSuites: SUITES,
  ...more,
})
const plan = (changes: Change[], suites = SUITE_INPUTS) =>
  decide(changes, context({ suiteInputs: suites }))
const shards = (p: ReturnType<typeof plan>) =>
  p.shards
    .filter((s) => s.decision.run)
    .map((s) => `${s.shard.shard}:${s.suites.join(',')}`)

describe('matches', () => {
  it('matches folders, extensions and exact files', () => {
    expect(matches('docs', ['docs/**'])).toBe(true)
    expect(matches('docs/a/b.md', ['docs/**'])).toBe(true)
    expect(matches('docsx/a.md', ['docs/**'])).toBe(false)
    expect(matches('README.md', ['**/*.md'])).toBe(true)
    expect(matches('lib/x/README.md', ['**/*.md'])).toBe(true)
    expect(matches('lib/x/README.mdx', ['**/*.md'])).toBe(false)
    expect(matches('package.json', ['package.json'])).toBe(true)
    expect(matches('e2e/package.json', ['package.json'])).toBe(false)
    expect(matches('e2e/fixtures/nft-v2/a.ts', ['e2e/fixtures/nft/**'])).toBe(
      false
    )
    expect(matches('axb', ['a.b'])).toBe(false)
  })
})

describe('decide', () => {
  it('runs only the shards and suites whose inputs changed', () => {
    const p = plan(changed('lib/b.ts'))
    expect(shards(p)).toEqual(['ab:b'])
    expect(p.app.run).toBe(true)
    expect(p.contracts.run).toBe(false)
    expect(p.contractsIntegration.run).toBe(false)
  })

  it('runs every suite that shares a changed file', () => {
    expect(shards(plan(changed('lib/shared.ts')))).toEqual(['ab:a,b'])
    expect(
      shards(plan(changed('e2e/fixtures/a/page.tsx', 'public/f.woff2')))
    ).toEqual(['ab:a', 'c:c'])
  })

  it('runs nothing but the always-on jobs for a docs-only change', () => {
    const p = plan(changed('docs/workflow/x.md', 'lib/stellar/README.md'))
    expect(p.app.run).toBe(false)
    expect(p.contracts.run).toBe(false)
    expect(p.contractsIntegration.run).toBe(false)
    expect(shards(p)).toEqual([])
  })

  it('runs the contract jobs, not the app, for a contract change', () => {
    const p = plan(changed('contracts/core/src/lib.rs'))
    expect(p.contracts.run).toBe(true)
    expect(p.contractsIntegration.run).toBe(true)
    expect(p.app.run).toBe(false)
    expect(shards(p)).toEqual([])
  })

  it('runs the local-network job for a file its scripts import', () => {
    const p = plan(changed('lib/stellar/v2/client.ts'))
    expect(p.contractsIntegration.run).toBe(true)
    expect(p.contracts.run).toBe(false)
  })

  it('runs everything for a workflow, lockfile or planner change', () => {
    for (const file of [
      'bun.lock',
      'package.json',
      '.github/workflows/ci.yml',
      'scripts/ci/plan.ts',
    ]) {
      const p = plan(changed(file))
      expect(p.app.run && p.contracts.run && p.contractsIntegration.run).toBe(
        true
      )
      expect(shards(p)).toEqual(['ab:a,b', 'c:c'])
    }
  })

  it('runs every shard for a shared input the bundles do not read', () => {
    for (const file of [
      'proxy.ts',
      'next.config.ts',
      'lib/routing/redirects/today.ts',
      'lib/routing/segments/read.ts',
      'lib/routing/atHandle.ts',
      'e2e/suites/today.ts',
      'scripts/fixture-suites.ts',
      'e2e/fixtures/system/crossing.config.ts',
    ]) {
      expect(shards(plan(changed(file)))).toEqual(['ab:a,b', 'c:c'])
    }
    expect(shards(plan(changed('lib/routing/README.md')))).toEqual([])
  })

  it('leaves the shell, layouts and backend to the graph', () => {
    for (const file of [
      'shell/AppShell.tsx',
      'app/(app)/layout.tsx',
      'convex/tabs.ts',
    ]) {
      expect(shards(plan(changed(file)))).toEqual([])
    }
  })

  it('runs every shard when the shared inputs are unknown', () => {
    const p = decide(changed('lib/b.ts'), context({ sharedFiles: undefined }))
    expect(shards(p)).toEqual(['ab:a,b', 'c:c'])
  })

  it('runs everything for a path under a new top-level entry', () => {
    const roots = new Set(['lib', 'docs', 'e2e'])
    const p = decide(changed('newdir/x.ts'), context({ knownRoots: roots }))
    expect(p.contracts.run && p.contractsIntegration.run && p.app.run).toBe(
      true
    )
    expect(shards(p)).toEqual(['ab:a,b', 'c:c'])
    const known = decide(changed('docs/x.md'), context({ knownRoots: roots }))
    expect(shards(known)).toEqual([])
  })

  it('treats a deleted input like a changed one', () => {
    expect(shards(plan([{ path: 'lib/c.ts', deleted: true }]))).toEqual(['c:c'])
    expect(
      shards(plan([{ path: 'e2e/retired.spec.ts', deleted: true }]))
    ).toEqual([])
  })

  it('fails closed when a suite or the local network has no inputs', () => {
    const unknown = new Map(SUITE_INPUTS)
    unknown.set('c', undefined)
    expect(shards(plan(changed('docs/a.md'), unknown))).toEqual(['c:c'])
    const p = decide(
      changed('docs/a.md'),
      context({ integrationFiles: undefined })
    )
    expect(p.contractsIntegration.run).toBe(true)
  })

  it('skips a shard with no suites', () => {
    const p = plan(changed('bun.lock'))
    const surfaces = p.shards.find((s) => s.shard.shard === 'surfaces')!
    expect(surfaces.decision.run).toBe(false)
  })
})

describe('outputs', () => {
  it('writes the matrix of the shards that run, with their suites', () => {
    const out = outputs(plan(changed('lib/a.ts')))
    expect(out.app).toBe('true')
    expect(out.contracts).toBe('false')
    expect(JSON.parse(out.fixtures!)).toEqual([
      { shard: 'ab', suites: 'a', browsers: 'chromium' },
    ])
    expect(outputs(plan(changed('docs/a.md'))).fixtures).toBe('[]')
  })

  it('turns on every shard with suites in the full plan', () => {
    const full = fullPlan('push')
    expect(
      full.app.run && full.contracts.run && full.contractsIntegration.run
    ).toBe(true)
    const ran = full.shards
      .filter((s) => s.decision.run)
      .map((s) => s.shard.shard)
    const withSuites = SHARDS.filter((s) => s.suites !== '@surfaces').map(
      (s) => s.shard
    )
    expect(ran).toEqual(expect.arrayContaining(withSuites))
  })
})

describe('serverLiterals', () => {
  it('finds stand-in modules, public and font folders a server names', () => {
    const source = `
      const root = path.resolve(import.meta.dirname, '../../..')
      path.join(import.meta.dirname, 'page.tsx')
      path.join(root, 'e2e/fixtures/wallet/navigation.ts')
      path.join(root, 'e2e/fixtures/wallet/gone.ts')
      path.join(import.meta.dirname, '../nft/link.tsx')
      readFile(path.join(root, 'public', url.pathname))
      readFile(path.join(root, 'system/fonts', name))
      import postcss from 'postcss'
      import tailwind from '@tailwindcss/postcss'
    `
    const found = serverLiterals('e2e/fixtures/tips-v2/server.mjs', source)
    expect(found).toEqual(
      expect.arrayContaining([
        'e2e/fixtures/tips-v2/page.tsx',
        'e2e/fixtures/wallet/navigation.ts',
        'e2e/fixtures/wallet/gone.ts',
        'e2e/fixtures/nft/link.tsx',
        'public/**',
        'system/fonts/**',
      ])
    )
    expect(found.some((f) => f.includes('postcss'))).toBe(false)
  })
})

describe('Required in ci.yml', () => {
  const workflow = readFileSync(
    path.join(__dirname, '../../.github/workflows/ci.yml'),
    'utf8'
  )
  const job = workflow.slice(workflow.indexOf('\n  required:'))
  const script = (() => {
    const lines = job.split('\n')
    const start = lines.findIndex((l) => l.trim() === 'run: |')
    const indent = lines[start]!.indexOf('run:') + 2
    const body: string[] = []
    for (const line of lines.slice(start + 1)) {
      if (line.trim() !== '' && line.search(/\S/) < indent) break
      body.push(line.slice(indent))
    }
    return body.join('\n')
  })()
  const passing: Record<string, string> = {
    CHANGES_RESULT: 'success',
    PLAN_APP: 'true',
    PLAN_CONTRACTS: 'true',
    PLAN_CONTRACTS_INTEGRATION: 'true',
    PLAN_FIXTURES: '[{"shard":"a"}]',
    QUALITY_RESULT: 'success',
    PRODUCTION_RESULT: 'success',
    PERF_BUDGET_RESULT: 'success',
    FONT_FALLBACKS_RESULT: 'success',
    AUDIT_RESULT: 'success',
    CONTRACTS_RESULT: 'success',
    CONTRACTS_INTEGRATION_RESULT: 'success',
    E2E_FIXTURES_RESULT: 'success',
    E2E_AUTH_RESULT: 'success',
  }
  const required = (env: Record<string, string>) =>
    spawnSync('bash', ['-c', script], {
      env: { ...process.env, ...passing, ...env },
    }).status

  it('passes when every job passed', () => {
    expect(required({})).toBe(0)
  })

  it('reads every job it needs', () => {
    const needs = job
      .match(/needs:\s*\[([\s\S]*?)\]/)![1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const name of needs) expect(job).toContain(`needs.${name}.result`)
  })

  it('passes a job skipped only when What changed planned it off', () => {
    expect(
      required({ PLAN_CONTRACTS: 'false', CONTRACTS_RESULT: 'skipped' })
    ).toBe(0)
    expect(required({ CONTRACTS_RESULT: 'skipped' })).toBe(1)
    expect(
      required({ PLAN_FIXTURES: '[]', E2E_FIXTURES_RESULT: 'skipped' })
    ).toBe(0)
    expect(required({ E2E_FIXTURES_RESULT: 'skipped' })).toBe(1)
    expect(required({ PLAN_APP: 'false', PERF_BUDGET_RESULT: 'skipped' })).toBe(
      0
    )
    expect(required({ PLAN_APP: '', PERF_BUDGET_RESULT: 'skipped' })).toBe(1)
  })

  it('fails when a job failed or was cancelled, planned or not', () => {
    expect(required({ PLAN_APP: 'false', PRODUCTION_RESULT: 'failure' })).toBe(
      1
    )
    expect(required({ E2E_FIXTURES_RESULT: 'cancelled' })).toBe(1)
    expect(required({ QUALITY_RESULT: 'skipped' })).toBe(1)
  })

  it('fails when What changed did not pass', () => {
    expect(required({ CHANGES_RESULT: 'failure' })).toBe(1)
    expect(required({ CHANGES_RESULT: 'cancelled' })).toBe(1)
  })
})
