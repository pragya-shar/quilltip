import { describe, expect, it } from 'vitest'
import {
  runnerEnv,
  chosen,
  expand,
  isSetup,
  matrixOf,
  order,
  stepsOf,
} from './local'

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

  it('reads matrix entries from an include list, a key list or another job', () => {
    const include = [{ shard: 'tab', suites: 'tab', browsers: 'chromium' }]
    expect(matrixOf({ strategy: { matrix: { include } } })).toEqual(include)
    expect(
      matrixOf({ strategy: { matrix: { engine: ['chromium', 'webkit'] } } })
    ).toEqual([{ engine: 'chromium' }, { engine: 'webkit' }])
    expect(
      matrixOf(
        { strategy: { matrix: { include: '${{ fromJSON(x) }}' } } },
        include
      )
    ).toEqual(include)
    expect(matrixOf({})).toEqual([{}])
  })

  it('chooses jobs by id or as the app group, and shards by name', () => {
    const wf = {
      jobs: {
        changes: { steps: [] },
        quality: { steps: [] },
        build: { steps: [] },
        'perf-budget': { steps: [] },
        'font-fallbacks': {
          strategy: { matrix: { engine: ['chromium', 'webkit'] } },
          steps: [],
        },
        e2e: {
          strategy: {
            matrix: {
              include: [
                { shard: 'tab', suites: 'tab' },
                { shard: 'system', suites: 'system' },
              ],
            },
          },
          steps: [],
        },
        required: { steps: [] },
      },
    }
    const names = (i: { job: string; matrix: Record<string, string> }[]) =>
      i.map((x) => [x.job, ...Object.values(x.matrix)].join(':'))
    expect(names(chosen(wf, { jobs: ['app'], shards: ['system'] }))).toEqual([
      'build',
      'perf-budget',
      'font-fallbacks:chromium',
      'font-fallbacks:webkit',
      'e2e:system:system',
    ])
    expect(names(chosen(wf, { all: true }))).toEqual([
      'quality',
      'build',
      'perf-budget',
      'font-fallbacks:chromium',
      'font-fallbacks:webkit',
      'e2e:tab:tab',
      'e2e:system:system',
    ])
    expect(() => chosen(wf, { shards: ['nope'] })).toThrow('Unknown shard nope')
    expect(() => chosen(wf, { jobs: ['nope'] })).toThrow('No job nope')
  })

  it('runs steps as on a runner, with few unit-test workers', () => {
    expect(runnerEnv([])).toEqual({ CI: '1', VITEST_MAX_WORKERS: '1' })
    expect(runnerEnv(['--workers', '3']).VITEST_MAX_WORKERS).toBe('3')
    expect(() => runnerEnv(['--workers', '0'])).toThrow('whole number')
    expect(() => runnerEnv(['--workers'])).toThrow('whole number')
  })
})
