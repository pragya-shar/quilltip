import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES, SURFACES_GROUP, selectFixtures } from '../fixture-suites'
import { SURFACE_SUITES } from '../../e2e/suites'
import { SHARDS } from './shards'

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
    expect(job).toContain(
      'include: ${{ fromJSON(needs.changes.outputs.fixtures) }}'
    )
    expect(new Set(SHARDS.map((s) => s.shard)).size).toBe(SHARDS.length)
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
