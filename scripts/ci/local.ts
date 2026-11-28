/**
 * Runs the CI jobs on this machine, with the steps read from
 * `.github/workflows/ci.yml`, so the two cannot drift
 * (docs/workflow/ci-pipeline.md).
 *
 *   bun scripts/ci/local.ts
 *       what this checkout changes (commits and uncommitted files, against
 *       the merge base with origin/overhaul/v3), as CI would plan it
 *   bun scripts/ci/local.ts --base <rev>     plan against another base
 *   bun scripts/ci/local.ts --jobs app --shards system,surfaces
 *       every app job and the named shards, whatever changed
 *   bun scripts/ci/local.ts --jobs production
 *       only the production-build checks
 *   bun scripts/ci/local.ts --light
 *       only the light jobs: lint, typecheck, unit and regression tests, audit
 *   bun scripts/ci/local.ts --all            every job and every shard
 *   bun scripts/ci/local.ts ... --list       print the steps, run nothing
 *   bun scripts/ci/local.ts ... --workers 2  unit-test workers (default 1)
 *
 * `--jobs` takes job ids from ci.yml, or `app` for every job that builds or
 * checks the app; `--shards` takes fixture shards (scripts/ci/shards.ts);
 * either one replaces the plan.
 *
 * Load: `--light` (Lint & Typecheck, Dependency Audit) uses CPU but builds
 * nothing and starts no browser. Every other job is heavy: a production
 * build, browsers, a perf or font check, or the Rust and Docker builds. On a
 * machine shared by several people or agents, run one heavy selection at a
 * time; `--light` can run beside other light work. Steps run with `CI=1`,
 * as on a runner, so each Playwright config uses its CI worker count (one or
 * two) and retries; `--workers` caps the unit-test workers.
 *
 * Left out, because they set up a CI runner: `uses:` actions (checkout, Bun
 * setup, tool installs, artifact uploads), steps named "Install ..." (system
 * packages, browsers, the Rust toolchain, the Stellar CLI), `bun install`,
 * and steps that run only on failure. No CI step reads a secret. For the
 * result to mean what CI's does, the machine needs:
 * - Bun 1.4.4 and `bun install --frozen-lockfile` on this checkout;
 * - Playwright's browsers for the chosen jobs (`bunx playwright install
 *   chromium webkit`, plus `firefox` for the tab and tab-ui shards);
 * - for the contract jobs: the toolchain in contracts/rust-toolchain.toml with
 *   the wasm32v1-none target, cargo-audit 0.23.0, cargo-deny 0.20.2, Docker,
 *   and Stellar CLI 30.0.1.
 * CI runs every job but Font Fallbacks on Linux. On macOS, engine rendering
 * and fonts differ, so a layout or pixel check can pass or fail differently.
 *
 * A production build is made once per set of build settings and shared by
 * every check that needs it, in place of one per job. Each job's steps stop
 * at its first failure, as in CI, and the run ends with a table of every step.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  changedFiles,
  computeContext,
  decide,
  outputs,
  shardCheck,
  withShardCheck,
  type Plan,
} from './plan'
import { SHARDS } from './shards'

const root = path.resolve(import.meta.dirname, '../..')

type Step = {
  name?: string
  id?: string
  uses?: string
  run?: string
  if?: string
  env?: Record<string, string>
  'working-directory'?: string
}
type Job = {
  name?: string
  'runs-on'?: string
  strategy?: { matrix?: Record<string, unknown> }
  defaults?: { run?: { 'working-directory'?: string } }
  env?: Record<string, string>
  steps?: Step[]
}
type Workflow = { jobs: Record<string, Job> }

/** One step to run: a job instance (a matrix entry) and a command. */
export type LocalStep = {
  job: string
  name: string
  id?: string
  run: string
  env: Record<string, string>
  cwd: string
  /** Set for `bun run build` steps: the settings that make the build. */
  build?: string
  /** The build this step reads, when it needs one. */
  needsBuild?: string
  /** `steps.<id>.outcome == 'success'` in its `if:`. */
  after?: string
  /** `always()` or `!cancelled()` in its `if:`: runs after a failed step. */
  always?: boolean
}

/** Steps that only set up a CI runner. */
export function isSetup(step: Step): boolean {
  if (step.uses) return true
  const name = step.name ?? ''
  if (/^Install\b/.test(name)) return true
  if (/^bun install\b/.test(step.run?.trim() ?? '')) return true
  if (step.if?.includes('failure()')) return true
  return false
}

/** `${{ matrix.x }}` and `${{ runner.temp }}` filled in; other expressions refused. */
export function expand(
  text: string,
  matrix: Record<string, string>,
  temp: string
): string {
  return text.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (whole, expr: string) => {
    const m = expr.match(/^matrix\.(\w+)$/)
    if (m) {
      const value = matrix[m[1]!]
      if (value === undefined) throw new Error(`No matrix value for ${whole}`)
      return value
    }
    if (expr === 'runner.temp') return temp
    throw new Error(`Cannot run ${whole} locally`)
  })
}

/** The build settings of a build step: its env, sorted. */
const buildKey = (env: Record<string, string>) =>
  JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)))

/**
 * The steps of the chosen job instances, in workflow order. A step after a
 * build step in the same job reads that build.
 */
export function stepsOf(
  workflow: Workflow,
  instances: readonly { job: string; matrix: Record<string, string> }[],
  temp: string
): LocalStep[] {
  const out: LocalStep[] = []
  for (const { job: id, matrix } of instances) {
    const job = workflow.jobs[id]
    if (!job) throw new Error(`No job ${id} in ci.yml`)
    const label = expand(job.name ?? id, matrix, temp)
    let build: string | undefined
    for (const step of job.steps ?? []) {
      if (!step.run || isSetup(step)) continue
      const env = Object.fromEntries(
        Object.entries({ ...job.env, ...step.env }).map(([k, v]) => [
          k,
          expand(String(v), matrix, temp),
        ])
      )
      const dir =
        step['working-directory'] ??
        job.defaults?.run?.['working-directory'] ??
        '.'
      const run = expand(step.run, matrix, temp)
      const isBuild = run.trim() === 'bun run build'
      const after = step.if?.match(/steps\.([\w-]+)\.outcome == 'success'/)?.[1]
      const always = /always\(\)|!cancelled\(\)/.test(step.if ?? '')
      const local: LocalStep = {
        job: label,
        name: expand(step.name ?? run.split('\n')[0]!, matrix, temp),
        id: step.id,
        run,
        env,
        cwd: path.join(root, dir),
        after,
        always,
      }
      if (isBuild) {
        build = buildKey(env)
        local.build = build
      } else if (build) {
        local.needsBuild = build
      }
      out.push(local)
    }
  }
  return out
}

/**
 * Run order: steps that need no build first, then each build once, followed
 * by every step that reads it. Within a group, workflow order.
 */
export function order(steps: readonly LocalStep[]): LocalStep[] {
  const free = steps.filter((s) => !s.build && !s.needsBuild)
  const builds: string[] = []
  for (const s of steps) {
    const key = s.build ?? s.needsBuild
    if (key && !builds.includes(key)) builds.push(key)
  }
  const out = [...free]
  for (const key of builds) {
    out.push(...steps.filter((s) => s.build === key || s.needsBuild === key))
  }
  return out
}

type Result = {
  step: LocalStep
  result: 'passed' | 'failed' | 'skipped' | 'reused' | 'listed'
  seconds: number
}

function execute(steps: readonly LocalStep[], list: boolean): Result[] {
  const results: Result[] = []
  const failedJobs = new Set<string>()
  const builds = new Map<string, 'passed' | 'failed'>()
  const outcomes = new Map<string, 'passed' | 'failed' | 'skipped'>()
  let current: string | undefined
  for (const step of steps) {
    const key = `${step.job}/${step.id ?? ''}`
    const skip = (why: string) => {
      console.log(`\n-- ${step.job}: ${step.name} skipped (${why})`)
      results.push({ step, result: 'skipped', seconds: 0 })
      if (step.id) outcomes.set(key, 'skipped')
    }
    if (step.after) {
      if (outcomes.get(`${step.job}/${step.after}`) !== 'passed') {
        skip(`${step.after} did not pass`)
        continue
      }
    } else if (failedJobs.has(step.job) && !step.always) {
      skip('an earlier step of the job failed')
      continue
    }
    if (step.needsBuild && builds.get(step.needsBuild) !== 'passed') {
      skip('its build did not pass')
      continue
    }
    if (step.build && builds.has(step.build) && current === step.build) {
      const outcome = builds.get(step.build)!
      console.log(
        `\n-- ${step.job}: ${step.name}: same build as before, reused`
      )
      results.push({ step, result: 'reused', seconds: 0 })
      if (step.id) outcomes.set(key, outcome)
      if (outcome === 'failed') failedJobs.add(step.job)
      continue
    }
    console.log(`\n-- ${step.job}: ${step.name}\n${step.run.trim()}`)
    if (list) {
      results.push({ step, result: 'listed', seconds: 0 })
      if (step.id) outcomes.set(key, 'passed')
      if (step.build) {
        builds.set(step.build, 'passed')
        current = step.build
      }
      continue
    }
    const started = Date.now()
    const run = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], {
      cwd: step.cwd,
      stdio: 'inherit',
      env: { ...process.env, ...step.env },
    })
    const result = run.status === 0 ? 'passed' : 'failed'
    results.push({ step, result, seconds: (Date.now() - started) / 1000 })
    if (step.id) outcomes.set(key, result)
    if (result === 'failed') failedJobs.add(step.job)
    if (step.build) {
      builds.set(step.build, result)
      current = step.build
    }
  }
  return results
}

export function summaryTable(results: readonly Result[]): string {
  const width = Math.max(
    ...results.map((r) => `${r.step.job}: ${r.step.name}`.length),
    10
  )
  const lines = results.map(
    (r) =>
      `${`${r.step.job}: ${r.step.name}`.padEnd(width)}  ${r.result.padEnd(7)}  ${
        r.seconds ? `${Math.round(r.seconds)} s` : ''
      }`
  )
  return [`${'Step'.padEnd(width)}  Result`, ...lines].join('\n')
}

/** The jobs that build and check the app (ids from ci.yml, old and new). */
const APP_JOBS = [
  'build',
  'production',
  'csp',
  'no-script',
  'early-taps',
  'perf-budget',
  'font-fallbacks',
  'e2e-auth',
]

/**
 * Jobs that need no build and no browser (lint, typecheck, unit and
 * regression tests, the dependency audit): `--light`.
 */
const LIGHT_JOBS = ['quality', 'audit']

/** Jobs that only plan or report. */
const NOT_RUN = ['changes', 'required']

type Instance = { job: string; matrix: Record<string, string> }

/**
 * A job's matrix entries: its `include` list (or `shards` when the list comes
 * from another job), its one list-valued key, or one empty entry.
 */
export function matrixOf(
  job: Job | undefined,
  shards?: readonly Record<string, string>[]
): Record<string, string>[] {
  const matrix = job?.strategy?.matrix
  if (!matrix) return [{}]
  if (Array.isArray(matrix.include)) {
    return matrix.include as Record<string, string>[]
  }
  if (matrix.include !== undefined) {
    if (!shards) throw new Error('The matrix comes from another job')
    return [...shards]
  }
  const lists = Object.entries(matrix).filter(([, v]) => Array.isArray(v))
  if (lists.length !== 1) return [{}]
  const [key, values] = lists[0]!
  return (values as unknown[]).map((v) => ({ [key]: String(v) }))
}

/** Job instances for `--all`, `--jobs` (ids, or `app`) and `--shards`. */
export function chosen(
  workflow: Workflow,
  options: { all?: boolean; jobs?: string[]; shards?: string[] },
  shards?: readonly Record<string, string>[]
): Instance[] {
  const ids = Object.keys(workflow.jobs).filter((id) => !NOT_RUN.includes(id))
  const fixtureJob = ids.find((id) =>
    matrixOf(workflow.jobs[id], shards ?? [{}]).some((m) => 'suites' in m)
  )
  const wanted = options.all
    ? ids.filter((id) => id !== fixtureJob)
    : (options.jobs ?? []).flatMap((id) =>
        id === 'app' ? APP_JOBS.filter((a) => ids.includes(a)) : [id]
      )
  const out: Instance[] = []
  for (const id of wanted) {
    if (!workflow.jobs[id]) {
      throw new Error(`No job ${id} in ci.yml. Jobs: ${ids.join(', ')}`)
    }
    for (const matrix of matrixOf(workflow.jobs[id], shards)) {
      out.push({ job: id, matrix })
    }
  }
  if (fixtureJob) {
    const all = matrixOf(workflow.jobs[fixtureJob], shards)
    const names = options.all
      ? all.map((m) => m.shard!)
      : (options.shards ?? [])
    for (const name of names) {
      const matrix = all.find((m) => m.shard === name)
      if (!matrix) {
        throw new Error(
          `Unknown shard ${name}. Shards: ${all.map((m) => m.shard).join(', ')}`
        )
      }
      out.push({ job: fixtureJob, matrix })
    }
  }
  return out
}

async function readWorkflow(): Promise<Workflow> {
  return Bun.YAML.parse(
    await Bun.file(path.join(root, '.github/workflows/ci.yml')).text()
  ) as Workflow
}

/**
 * The environment every step gets, as on a CI runner: `CI` makes each
 * Playwright config use its CI worker count (one or two) and retries, and
 * `VITEST_MAX_WORKERS` caps the unit-test workers (default 1).
 */
export function runnerEnv(argv: readonly string[]): Record<string, string> {
  const at = argv.indexOf('--workers')
  const workers = at === -1 ? '1' : (argv[at + 1] ?? '')
  if (!/^[1-9]\d*$/.test(workers)) {
    throw new Error('--workers needs a whole number of 1 or more')
  }
  return { CI: '1', VITEST_MAX_WORKERS: workers }
}

function runAll(
  workflow: Workflow,
  instances: Instance[],
  argv: readonly string[]
) {
  const list = argv.includes('--list')
  const temp = mkdtempSync(path.join(tmpdir(), 'ci-local-'))
  process.env.RUNNER_TEMP = temp
  Object.assign(process.env, runnerEnv(argv))
  const steps = order(stepsOf(workflow, instances, temp))
  const results = execute(steps, list)
  console.log(`\n${summaryTable(results)}`)
  return results.some((r) => r.result === 'failed') ? 1 : 0
}

const listOf = (argv: string[], flag: string) => {
  const at = argv.indexOf(flag)
  return at === -1 ? undefined : (argv[at + 1] ?? '').split(',').filter(Boolean)
}

const SHARD_MATRIX = SHARDS.map((s) => ({ ...s }))

/** The job instances (with matrix values) a plan turns on. */
export function instancesOf(plan: Plan, workflow: Workflow): Instance[] {
  const out = chosen(workflow, { jobs: ['quality', 'audit'] }, SHARD_MATRIX)
  if (plan.app.run)
    out.push(...chosen(workflow, { jobs: ['app'] }, SHARD_MATRIX))
  if (plan.contracts.run) {
    out.push(...chosen(workflow, { jobs: ['contracts'] }, SHARD_MATRIX))
  }
  if (plan.contractsIntegration.run) {
    out.push(
      ...chosen(workflow, { jobs: ['contracts-integration'] }, SHARD_MATRIX)
    )
  }
  for (const shard of JSON.parse(outputs(plan).fixtures!) as Record<
    string,
    string
  >[]) {
    out.push({ job: 'e2e-fixtures', matrix: shard })
  }
  return out
}

async function main(argv: string[]): Promise<number> {
  const workflow = await readWorkflow()
  const options = {
    all: argv.includes('--all'),
    jobs: listOf(argv, '--jobs'),
    shards: listOf(argv, '--shards'),
  }
  if (argv.includes('--light')) {
    options.jobs = [...(options.jobs ?? []), ...LIGHT_JOBS]
  }
  if (options.all || options.jobs || options.shards) {
    return runAll(workflow, chosen(workflow, options, SHARD_MATRIX), argv)
  }
  const at = argv.indexOf('--base')
  const base =
    (at === -1 ? undefined : argv[at + 1]) ??
    spawnSync('git', ['merge-base', 'HEAD', 'origin/overhaul/v3'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout.trim()
  if (!base)
    throw new Error('No merge base with origin/overhaul/v3; pass --base')
  const changes = changedFiles(base)
  const check = shardCheck()
  const plan = withShardCheck(
    decide(changes, await computeContext(base)),
    check.problems,
    check.unsharded
  )
  for (const note of plan.notes ?? []) console.log(note)
  console.log(`${changes.length} files changed since ${base.slice(0, 8)}.`)
  return runAll(workflow, instancesOf(plan, workflow), argv)
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  )
}
