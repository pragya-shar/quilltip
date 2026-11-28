/**
 * Runs the CI jobs on this machine, with the steps read from
 * `.github/workflows/ci.yml`, so the two cannot drift
 * (docs/workflow/ci-pipeline.md).
 *
 *   bun scripts/ci/local.ts                    what this checkout changes (commits and
 *                                              uncommitted files), as CI would plan it
 *   bun scripts/ci/local.ts --base <rev>       plan against another base (default: the
 *                                              merge base with origin/overhaul/v3)
 *   bun scripts/ci/local.ts --all              every job and every shard
 *   bun scripts/ci/local.ts --jobs quality,production --shards system,balance
 *   bun scripts/ci/local.ts --list             print the steps, run nothing
 *
 * `--jobs` takes job ids from ci.yml (quality, production, perf-budget,
 * font-fallbacks, audit, contracts, contracts-integration, e2e-auth) and
 * `--shards` takes fixture shards (scripts/ci/shards.ts); either one replaces
 * the plan. Setup steps (checkout, Bun, `bun install`, browser and tool
 * installs, artifact uploads) are left to the machine: run `bun install` and
 * `bunx playwright install` first. A production build is made once per set of
 * build settings and shared by every check that needs it, in place of one
 * per job. Each job's steps stop at its first failure, as in CI, and the run
 * ends with a table of every step.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  allSuiteInputs,
  changedFiles,
  decide,
  fullPlan,
  integrationInputs,
  outputs,
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
      const local: LocalStep = {
        job: label,
        name: expand(step.name ?? run.split('\n')[0]!, matrix, temp),
        id: step.id,
        run,
        env,
        cwd: path.join(root, dir),
        after,
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
    } else if (failedJobs.has(step.job)) {
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

/** The job instances (with matrix values) a plan turns on. */
export function instancesOf(plan: Plan, workflow: Workflow) {
  const out: { job: string; matrix: Record<string, string> }[] = [
    { job: 'quality', matrix: {} },
    { job: 'audit', matrix: {} },
  ]
  if (plan.app.run) {
    out.push(
      { job: 'production', matrix: {} },
      { job: 'perf-budget', matrix: {} }
    )
    const engines = (workflow.jobs['font-fallbacks']?.strategy?.matrix
      ?.engine ?? []) as string[]
    for (const engine of engines)
      out.push({ job: 'font-fallbacks', matrix: { engine } })
    out.push({ job: 'e2e-auth', matrix: {} })
  }
  if (plan.contracts.run) out.push({ job: 'contracts', matrix: {} })
  if (plan.contractsIntegration.run)
    out.push({ job: 'contracts-integration', matrix: {} })
  for (const shard of JSON.parse(outputs(plan).fixtures!) as Record<
    string,
    string
  >[]) {
    out.push({ job: 'e2e-fixtures', matrix: shard })
  }
  return out
}

async function main(argv: string[]): Promise<number> {
  const value = (flag: string) => {
    const at = argv.indexOf(flag)
    return at === -1 ? undefined : argv[at + 1]
  }
  const workflow = Bun.YAML.parse(
    await Bun.file(path.join(root, '.github/workflows/ci.yml')).text()
  ) as Workflow
  const temp = mkdtempSync(path.join(tmpdir(), 'ci-local-'))
  process.env.RUNNER_TEMP = temp

  let instances: { job: string; matrix: Record<string, string> }[]
  const jobs = value('--jobs')
  const shards = value('--shards')
  if (jobs || shards) {
    instances = []
    for (const job of jobs?.split(',').filter(Boolean) ?? []) {
      const matrix = workflow.jobs[job]?.strategy?.matrix
      const engines = (matrix?.engine ?? []) as string[]
      if (engines.length > 0) {
        for (const engine of engines)
          instances.push({ job, matrix: { engine } })
      } else {
        instances.push({ job, matrix: {} })
      }
    }
    for (const name of shards?.split(',').filter(Boolean) ?? []) {
      const shard = SHARDS.find((s) => s.shard === name)
      if (!shard)
        throw new Error(
          `Unknown shard ${name}. Known: ${SHARDS.map((s) => s.shard).join(', ')}`
        )
      instances.push({ job: 'e2e-fixtures', matrix: { ...shard } })
    }
  } else {
    let plan: Plan
    if (argv.includes('--all')) {
      plan = fullPlan('--all')
    } else {
      const base =
        value('--base') ??
        spawnSync('git', ['merge-base', 'HEAD', 'origin/overhaul/v3'], {
          cwd: root,
          encoding: 'utf8',
        }).stdout.trim()
      if (!base)
        throw new Error('No merge base with origin/overhaul/v3; pass --base')
      const changes = changedFiles(base)
      const [suites, integration] = await Promise.all([
        allSuiteInputs(),
        integrationInputs(),
      ])
      plan = decide(changes, suites, integration)
      console.log(`${changes.length} files changed since ${base.slice(0, 8)}.`)
    }
    instances = instancesOf(plan, workflow)
  }

  const steps = order(stepsOf(workflow, instances, temp))
  const results = execute(steps, argv.includes('--list'))
  console.log(`\n${summaryTable(results)}`)
  return results.some((r) => r.result === 'failed') ? 1 : 0
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
