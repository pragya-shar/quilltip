import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES, selectFixtures } from '../fixture-suites'

const workflow = readFileSync(
  path.join(__dirname, '../../.github/workflows/ci.yml'),
  'utf8'
)

/** The `suites:` values of the e2e-fixtures matrix, one entry per shard. */
function shardSuites(): string[][] {
  const job = workflow.slice(
    workflow.indexOf('\n  e2e-fixtures:'),
    workflow.indexOf('\n  contracts-integration:')
  )
  return [...job.matchAll(/^\s+suites: (.+)$/gm)].map((m) =>
    m[1]!.split(',').map((name) => name.trim())
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
})

describe('selectFixtures', () => {
  it('runs every suite without --suite', () => {
    expect(selectFixtures([])).toEqual([...FIXTURES])
  })

  it('selects named suites in either form, in list order', () => {
    expect(
      selectFixtures(['--suite', 'avatar,recovery']).map((f) => f.name)
    ).toEqual(['recovery', 'avatar'])
    expect(selectFixtures(['--suite=tab']).map((f) => f.name)).toEqual(['tab'])
  })

  it('refuses an unknown or empty selection', () => {
    expect(() => selectFixtures(['--suite', 'nope'])).toThrow(
      'Unknown fixture suite: nope'
    )
    expect(() => selectFixtures(['--suite'])).toThrow('one or more')
  })
})
