import { describe, expect, it } from 'vitest'
import { expand, isSetup, order, stepsOf } from './local'

const FIXTURE = {
  SKIP_ENV_VALIDATION: '1',
  NEXT_PUBLIC_CONVEX_URL: 'http://127.0.0.1:3299',
}
const workflow = {
  jobs: {
    lint: {
      name: 'Lint',
      steps: [
        { uses: 'actions/checkout@abc' },
        { name: 'Install dependencies', run: 'bun install --frozen-lockfile' },
        { name: 'Lint', run: 'bun run lint' },
      ],
    },
    checks: {
      name: 'Checks',
      steps: [
        { name: 'Install Chromium', run: 'bunx playwright install chromium' },
        { name: 'Build', id: 'b', run: 'bun run build', env: FIXTURE },
        {
          name: 'CSP',
          if: "${{ !cancelled() && steps.b.outcome == 'success' }}",
          run: 'bun run test:e2e:csp',
        },
        {
          name: 'Summarize',
          if: 'failure()',
          run: 'bun scripts/ci/failure-summary.ts',
        },
      ],
    },
    budget: {
      name: 'Budget',
      steps: [
        { name: 'Build', run: 'bun run build', env: { ...FIXTURE } },
        { name: 'Budget', run: 'bun run perf:budget' },
      ],
    },
    shard: {
      name: 'Shard (${{ matrix.shard }})',
      steps: [
        {
          name: 'Run',
          run: 'bun run x --suite "$S"',
          env: { S: '${{ matrix.suites }}' },
        },
      ],
    },
  },
}

describe('local CI steps', () => {
  it('leaves out setup, installs, uploads and failure-only steps', () => {
    expect(isSetup({ uses: 'actions/upload-artifact@x' })).toBe(true)
    expect(
      isSetup({ name: 'Install Chromium', run: 'bunx playwright install' })
    ).toBe(true)
    expect(isSetup({ run: 'bun install --frozen-lockfile' })).toBe(true)
    expect(isSetup({ name: 'Summarize', if: 'failure()', run: 'x' })).toBe(true)
    expect(isSetup({ name: 'Lint', run: 'bun run lint' })).toBe(false)
  })

  it('fills in matrix values and refuses other expressions', () => {
    expect(expand('a ${{ matrix.shard }} b', { shard: 'tab' }, '/t')).toBe(
      'a tab b'
    )
    expect(expand('${{ runner.temp }}/w', {}, '/t')).toBe('/t/w')
    expect(() => expand('${{ secrets.X }}', {}, '/t')).toThrow('Cannot run')
  })

  it('makes each build once and runs every check that reads it after it', () => {
    const steps = order(
      stepsOf(
        workflow,
        [
          { job: 'checks', matrix: {} },
          { job: 'lint', matrix: {} },
          { job: 'budget', matrix: {} },
          { job: 'shard', matrix: { shard: 'tab', suites: 'tab' } },
        ],
        '/t'
      )
    )
    expect(steps.map((s) => `${s.job}: ${s.name}`)).toEqual([
      'Lint: Lint',
      'Shard (tab): Run',
      'Checks: Build',
      'Checks: CSP',
      'Budget: Build',
      'Budget: Budget',
    ])
    const [checksBuild, , budgetBuild] = steps.slice(2)
    expect(checksBuild!.build).toBe(budgetBuild!.build)
    expect(steps[3]!.after).toBe('b')
    expect(steps[1]!.env.S).toBe('tab')
  })
})
