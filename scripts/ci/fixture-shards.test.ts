import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES, SURFACES_GROUP, selectFixtures } from '../fixture-suites'
import { SURFACE_SUITES } from '../../e2e/suites'
import { SHARDS, shardProblems } from './shards'

const workflow = readFileSync(
  path.join(__dirname, '../../.github/workflows/ci.yml'),
  'utf8'
)

/** The suites of each shard in scripts/ci/shards.ts, one entry per shard. */
function shardSuites(): string[][] {
  return SHARDS.map((shard) =>
    shard.suites
      .split(',')
      .map((name) => name.trim())
      .flatMap((name) =>
        name === SURFACES_GROUP ? SURFACE_SUITES.map((s) => s.name) : [name]
      )
  )
}

describe('the shard list', () => {
  it('names only suites that exist, and every suite once', () => {
    const problems = shardProblems(SHARDS, FIXTURES, SURFACE_SUITES, (file) =>
      existsSync(path.join(__dirname, '../..', file))
    )
    expect(problems.join('\n')).toBe('')
  })

  it('says which entry to remove when a suite is deleted', () => {
    const shards = [
      { shard: 'tips', suites: 'tips-v2', browsers: 'chromium' },
      { shard: 'mix', suites: 'wallet,nft', browsers: 'chromium' },
    ]
    const suites = [
      { name: 'wallet', server: 'e2e/fixtures/wallet/server.mjs' },
      { name: 'nft', server: 'e2e/fixtures/nft/server.mjs' },
      { name: 'balance', server: 'e2e/fixtures/balance/server.mjs' },
    ]
    const problems = shardProblems(
      shards,
      suites,
      [],
      (f) => !f.includes('nft')
    )
    expect(problems).toEqual([
      'Shard "tips" names suite "tips-v2", which scripts/fixture-suites.ts does not define: remove "tips-v2" from that shard in scripts/ci/shards.ts.',
      'Shard "tips" has no suite left: remove it from scripts/ci/shards.ts.',
      'Suite "nft" has no server at e2e/fixtures/nft/server.mjs: remove it from scripts/fixture-suites.ts and from shard "mix" in scripts/ci/shards.ts.',
      'Suite "balance" is in no shard: add it to a shard in scripts/ci/shards.ts.',
    ])
  })
})

describe('fixture shards in CI', () => {
  it('run every fixture suite exactly once', () => {
    const shards = shardSuites()
    expect(shards.length).toBeGreaterThan(1)
    expect(shards.flat().sort()).toEqual(
      FIXTURES.map((fixture) => fixture.name).sort()
    )
  })

  it('keep Required failing when any shard fails', () => {
    const required = workflow.slice(workflow.indexOf('\n  required:'))
    expect(required).toMatch(/needs:[\s\S]*\be2e-fixtures\b/)
    expect(required).toContain(
      'E2E_FIXTURES_RESULT: ${{ needs.e2e-fixtures.result }}'
    )
    expect(required).toContain('if: always()')
    expect(workflow).toMatch(/e2e-fixtures:[\s\S]*?fail-fast: false/)
  })

  it('take their matrix from What changed', () => {
    const job = workflow.slice(
      workflow.indexOf('\n  e2e-fixtures:'),
      workflow.indexOf('\n  contracts-integration:')
    )
    const include = job.match(
      /include: \$\{\{ fromJSON\(needs\.changes\.outputs\.fixtures \|\| '(.*)'\) \}\}/
    )
    expect(include).not.toBeNull()
    // Without a plan, one job runs every suite in every engine a shard uses.
    const fallback = JSON.parse(include![1]!) as {
      suites: string
      browsers: string
    }[]
    expect(fallback).toHaveLength(1)
    expect(fallback[0]!.suites).toBe('')
    const engines = new Set(SHARDS.flatMap((s) => s.browsers.split(' ')))
    expect(new Set(fallback[0]!.browsers.split(' '))).toEqual(engines)
    expect(job).toContain('bun run test:e2e:fixtures\n')
    expect(job).toContain(
      "timeout-minutes: ${{ matrix.shard == 'all' && 75 || 15 }}"
    )
    expect(new Set(SHARDS.map((s) => s.shard)).size).toBe(SHARDS.length)
  })
})

describe('What changed in CI', () => {
  it('falls back to the full plan, and every planned job runs without a plan', () => {
    const changes = workflow.slice(
      workflow.indexOf('\n  changes:'),
      workflow.indexOf('\n  quality:')
    )
    for (const key of [
      'app',
      'contracts',
      'contracts_integration',
      'fixtures',
    ]) {
      expect(changes).toContain(
        `${key}: \${{ steps.plan.outputs.${key} || steps.full.outputs.${key} }}`
      )
    }
    expect(changes.indexOf('id: full')).toBeLessThan(
      changes.indexOf('bun install')
    )
    expect(changes).toMatch(/id: plan\n\s+continue-on-error: true/)
    const gated = [
      ...workflow.matchAll(/^    if: (.*needs\.changes.*)$/gm),
    ].map((m) => m[1]!)
    expect(gated.length).toBeGreaterThanOrEqual(6)
    for (const condition of gated) {
      expect(condition).toContain(
        "!cancelled() && (needs.changes.result != 'success' ||"
      )
    }
  })
})

describe('Forcing the full plan', () => {
  // The planning step's script, run with \`bun\` replaced by an echo.
  const changes = workflow.slice(
    workflow.indexOf('\n  changes:'),
    workflow.indexOf('\n  quality:')
  )
  const step = changes.slice(changes.indexOf('id: plan'))
  const lines = step.split('\n')
  const start = lines.findIndex((l) => l.trim() === 'run: |')
  const indent = lines[start]!.indexOf('run:') + 2
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.search(/\S/) < indent) break
    body.push(line.slice(indent))
  }
  const plan = (env: Record<string, string>) =>
    spawnSync('bash', ['-c', `bun() { echo "$*"; }\n${body.join('\n')}`], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    }).stdout.trim()
  const pr = {
    EVENT_NAME: 'pull_request',
    FULL_LABEL: 'false',
    RUN_ATTEMPT: '1',
  }

  it('reads the ci-full label from the pull request', () => {
    expect(step).toContain(
      "FULL_LABEL: ${{ contains(github.event.pull_request.labels.*.name, 'ci-full') }}"
    )
  })

  it('plans everything for the label, a re-run of every job and a push', () => {
    expect(plan(pr)).toContain('--base HEAD^1 --head HEAD')
    expect(plan({ ...pr, FULL_LABEL: 'true' })).toContain('--full')
    expect(plan({ ...pr, RUN_ATTEMPT: '2' })).toContain('--full')
    expect(plan({ ...pr, EVENT_NAME: 'push' })).toContain('--full')
  })
})

describe('suites from e2e/suites/', () => {
  it('run in the one surfaces shard', () => {
    expect(SHARDS.filter((s) => s.suites === SURFACES_GROUP)).toHaveLength(1)
  })

  it('keep names and ports unique across every suite', () => {
    const names = FIXTURES.map((f) => f.name)
    const ports = FIXTURES.map((f) => f.port)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(ports).size).toBe(ports.length)
  })

  it('are selected together by @surfaces, and none is an empty run', () => {
    const extra = {
      name: 'read-article',
      server: 'e2e/fixtures/read/server.mjs',
      port: 4200,
      spec: 'e2e/read-article.spec.ts',
      env: {},
    }
    expect(selectFixtures(['--suite', '@surfaces'], [extra])).toEqual([extra])
    expect(selectFixtures(['--suite', '@surfaces'], [])).toEqual([])
    expect(
      selectFixtures(['--suite', 'nft,@surfaces'], [extra]).map((f) => f.name)
    ).toEqual(['nft', 'read-article'])
  })
})

describe('selectFixtures', () => {
  it('runs every suite without --suite', () => {
    expect(selectFixtures([])).toEqual([...FIXTURES])
  })

  it('selects named suites in either form, in list order', () => {
    expect(
      selectFixtures(['--suite', 'avatar,nft']).map((f) => f.name)
    ).toEqual(['nft', 'avatar'])
    expect(selectFixtures(['--suite=tab']).map((f) => f.name)).toEqual(['tab'])
  })

  it('refuses an unknown or empty selection', () => {
    expect(() => selectFixtures(['--suite', 'nope'])).toThrow(
      'Unknown fixture suite: nope'
    )
    expect(() => selectFixtures(['--suite'])).toThrow('one or more')
  })
})
