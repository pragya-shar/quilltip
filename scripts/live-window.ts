/**
 * Runs the operations of one approved maintenance window on the live Convex
 * deployment (docs/operations/payments-v2-cutover.md, "Live window approval").
 *
 *   bun scripts/live-window.ts check [<operation> <args>...]   # dry mode, no network
 *   bun scripts/live-window.ts run <operation> <args>...
 *
 * Run it with Bun directly, not through `bun run`: `bun run` puts the
 * checkout's node_modules/.bin first in PATH, so a `bun` there would run in
 * place of this tool.
 *
 * Operations: deploy-dry-run, deploy, export <file.zip>, import <file.zip>,
 * env-set <NAME> <value>, env-remove <NAME>, convex-run <function> [json],
 * pause, resume. The rules are in scripts/lib/live-window.ts.
 *
 * `check` evaluates the approval (and the operation, if given) from local
 * state only: the shell environment, the checkout, the clock and the files.
 * `run` evaluates again, prints a warning and writes the log line. It then
 * builds the run's code from the approved commit itself, not from this
 * checkout (scripts/lib/live-window-build.ts: export by object id, checked
 * against the commit's tree; frozen install without scripts; system Node and
 * a clean environment), checks the window again, and runs the Convex CLI
 * there with arguments it builds itself. `deploy` runs the dry run first and
 * pushes only if the dry run names the approved deployment and no other.
 * `pause` and `resume` are dashboard steps; the tool records them and runs
 * nothing.
 */
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

import { prepareWindowBuild, type WindowBuild } from './lib/live-window-build'
import {
  LIVE_WINDOW_APPROVAL_ENV,
  LIVE_WINDOW_ENV_REMOVE,
  LIVE_WINDOW_ENV_SET,
  LIVE_WINDOW_FORMAT,
  LIVE_WINDOW_FUNCTIONS,
  LIVE_WINDOW_OPERATIONS,
  appendLiveWindowLog,
  convexUrlsInOutput,
  describeLiveWindowArgs,
  evaluateLiveWindow,
  liveWindowLogPath,
  liveWindowWarning,
  minutesLeft,
  parseLiveWindowApproval,
  readLiveWindowFacts,
  sha256File,
  stageRestoreCopy,
  type LiveWindowDecision,
  type LiveWindowFacts,
  type LiveWindowLogEntry,
} from './lib/live-window'
import { NetworkGuardError } from './lib/network-guard'

type EnvLike = Record<string, string | undefined>

export type SpawnResult = { status: number | null; output: string }

export type LiveWindowDeps = {
  facts: () => LiveWindowFacts
  /**
   * Build the run's code from the approved commit (export, check, install).
   * Throws NetworkGuardError when it cannot. Returns the checked tree id.
   */
  build: (decision: LiveWindowDecision) => { tree: string }
  /** Run the Convex CLI in the build. `capture` returns its output too. */
  spawn: (convexArgs: string[], capture: boolean) => SpawnResult
  /** Remove the build. */
  close: () => void
  /** Append one log line; throws NetworkGuardError when it cannot. */
  log: (entry: LiveWindowLogEntry, now: Date) => void
  /** SHA-256 of a file. */
  sha256: (file: string) => string
  /** Private copy of a restore archive, imported in place of the original. */
  stage: (file: string) => { path: string; cleanup: () => void }
}

function defaultDeps(env: EnvLike): LiveWindowDeps {
  let build: WindowBuild | null = null
  return {
    facts: () => readLiveWindowFacts(env),
    build: (decision) => {
      build = prepareWindowBuild({
        commit: decision.approval.commit,
        repoRoot: readLiveWindowFacts(env).checkoutRoot,
        deployKey: env.CONVEX_DEPLOY_KEY?.trim() ?? '',
        bun: process.execPath,
        bunVersion: process.versions.bun,
        term: env.TERM,
      })
      return { tree: build.tree }
    },
    spawn: (convexArgs, capture) => {
      if (!build) {
        console.error('No window build. Nothing was run.')
        return { status: 1, output: '' }
      }
      const command = build.command(convexArgs)
      const result = spawnSync(command.file, command.args, {
        cwd: command.cwd,
        env: command.env as NodeJS.ProcessEnv,
        stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
        encoding: 'utf8',
      })
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
      if (capture) process.stdout.write(output)
      return { status: result.status, output }
    },
    close: () => {
      build?.cleanup()
      build = null
    },
    log: (entry, now) => {
      appendLiveWindowLog(
        entry,
        env,
        readLiveWindowFacts(env).checkoutRoot,
        now
      )
    },
    sha256: sha256File,
    stage: stageRestoreCopy,
  }
}

const USAGE = `Usage:
  bun scripts/live-window.ts check [<operation> <args>...]
  bun scripts/live-window.ts run <operation> <args>...

${LIVE_WINDOW_APPROVAL_ENV} format: ${LIVE_WINDOW_FORMAT}`

function approvalFields(env: EnvLike): Partial<LiveWindowLogEntry> {
  const parsed = parseLiveWindowApproval(env[LIVE_WINDOW_APPROVAL_ENV])
  if ('refusal' in parsed) return {}
  return {
    deployment: parsed.approval.deployment,
    commit: parsed.approval.commit,
    windowEnd: parsed.approval.end.toISOString(),
  }
}

function decisionFields(decision: LiveWindowDecision) {
  return {
    operation: decision.request?.detail ?? 'check',
    deployment: decision.approval.deployment,
    commit: decision.approval.commit,
    windowEnd: decision.approval.end.toISOString(),
    ...(decision.request?.sha256 ? { sha256: decision.request.sha256 } : {}),
  }
}

function allowedSummary(): string {
  return [
    `Operations: ${LIVE_WINDOW_OPERATIONS.join(', ')}`,
    `  convex-run functions: ${LIVE_WINDOW_FUNCTIONS.join(', ')}`,
    `  env-set variables: ${Object.keys(LIVE_WINDOW_ENV_SET).join(', ')}`,
    `  env-remove variables: ${LIVE_WINDOW_ENV_REMOVE.join(', ')}`,
    '  pause, resume: Convex dashboard steps; recorded only.',
  ].join('\n')
}

/** Evaluate; on refusal print and log it. Returns null when refused. */
function decide(
  args: string[] | null,
  env: EnvLike,
  deps: LiveWindowDeps
): { decision: LiveWindowDecision; facts: LiveWindowFacts } | null {
  const facts = deps.facts()
  try {
    return {
      decision: evaluateLiveWindow(args, env, facts, { sha256: deps.sha256 }),
      facts,
    }
  } catch (error) {
    if (!(error instanceof NetworkGuardError)) throw error
    console.error(error.message)
    try {
      deps.log(
        {
          event: 'refused',
          operation: describeLiveWindowArgs(args),
          ...approvalFields(env),
          codes: error.codes,
        },
        facts.now
      )
    } catch (logError) {
      if (logError instanceof NetworkGuardError) console.error(logError.message)
      else throw logError
    }
    return null
  }
}

function log(
  deps: LiveWindowDeps,
  entry: LiveWindowLogEntry,
  now: Date
): boolean {
  try {
    deps.log(entry, now)
    return true
  } catch (error) {
    if (!(error instanceof NetworkGuardError)) throw error
    console.error(error.message)
    return false
  }
}

export function runLiveWindowCli(
  argv: string[],
  env: EnvLike = process.env,
  deps: LiveWindowDeps = defaultDeps(env)
): number {
  const [command, ...args] = argv
  if (command === 'check') {
    const result = decide(args.length > 0 ? args : null, env, deps)
    if (!result) return 1
    const { decision, facts } = result
    if (
      !log(deps, { event: 'check', ...decisionFields(decision) }, facts.now)
    ) {
      return 1
    }
    console.log(
      [
        `Window approval is valid for ${decision.approval.deployment} at ${decision.approval.commit}.`,
        `Window: ${decision.approval.start.toISOString()} to ${decision.approval.end.toISOString()} (${minutesLeft(decision.approval, facts.now)} min left).`,
        decision.request
          ? `Operation allowed: ${decision.request.detail}`
          : allowedSummary(),
        `Log: ${liveWindowLogPath(env)}`,
        'Dry mode: nothing was sent to any network.',
      ].join('\n')
    )
    return 0
  }

  if (command !== 'run' || args.length === 0) {
    console.error(USAGE)
    return 2
  }

  const result = decide(args, env, deps)
  if (!result) return 1
  const { decision, facts } = result
  const request = decision.request
  if (!request) return 1
  if (
    !log(deps, { event: 'allowed', ...decisionFields(decision) }, facts.now)
  ) {
    return 1
  }
  console.warn(liveWindowWarning(decision, facts.now))

  if (!request.convexArgs) {
    console.log(
      `${request.operation} is a Convex dashboard step (Settings). Do it there now; this tool sends nothing.`
    )
    log(
      deps,
      { event: 'dashboard', ...decisionFields(decision) },
      deps.facts().now
    )
    return 0
  }

  try {
    return runInBuild(args, env, decision, deps)
  } finally {
    deps.close()
  }
}

/**
 * Build the run's code from the approved commit, check the window again (the
 * build takes time), and run the operation there.
 */
function runInBuild(
  args: string[],
  env: EnvLike,
  decision: LiveWindowDecision,
  deps: LiveWindowDeps
): number {
  const request = decision.request
  if (!request?.convexArgs) return 1
  let tree: string
  try {
    tree = deps.build(decision).tree
  } catch (error) {
    if (!(error instanceof NetworkGuardError)) throw error
    console.error(`${error.message}\nNothing was run.`)
    log(
      deps,
      {
        event: 'finished',
        ...decisionFields(decision),
        codes: error.codes,
        exitCode: 1,
      },
      deps.facts().now
    )
    return 1
  }
  if (
    !log(
      deps,
      { event: 'built', ...decisionFields(decision), tree },
      deps.facts().now
    )
  ) {
    return 1
  }
  if (!decide(args, env, deps)) return 1

  if (request.operation === 'deploy') {
    const dryRun = deps.spawn(['deploy', '--dry-run'], true)
    const targets = convexUrlsInOutput(dryRun.output)
    const deployment = decision.approval.deployment
    if (
      dryRun.status !== 0 ||
      targets.length !== 1 ||
      targets[0] !== deployment
    ) {
      console.error(
        `The dry run did not name ${deployment} as its only target (found: ${targets.join(', ') || 'none'}, exit ${dryRun.status}). Nothing was pushed.`
      )
      log(
        deps,
        {
          event: 'finished',
          ...decisionFields(decision),
          codes: ['DRY_RUN_TARGET'],
          exitCode: 1,
        },
        deps.facts().now
      )
      return 1
    }
    // Check the window again: the dry run takes time.
    const again = decide(args, env, deps)
    if (!again) return 1
  }

  if (request.operation === 'import') {
    return runImport(decision, deps)
  }

  const run = deps.spawn(request.convexArgs, false)
  let exported: string | undefined
  if (request.operation === 'export' && run.status === 0 && request.file) {
    try {
      exported = deps.sha256(request.file)
      console.log(`Export SHA-256: ${exported}`)
    } catch {
      console.error('The export finished, but its file cannot be read.')
    }
  }
  log(
    deps,
    {
      event: 'finished',
      ...decisionFields(decision),
      exitCode: run.status,
      ...(exported ? { sha256: exported } : {}),
    },
    deps.facts().now
  )
  return run.status ?? 1
}

/**
 * Import a private copy of the approved restore archive, after checking that
 * the copy still has the approved SHA-256. The original can change after the
 * check; the copy cannot.
 */
function runImport(decision: LiveWindowDecision, deps: LiveWindowDeps): number {
  const request = decision.request
  const expected = request?.sha256
  if (!request?.file || !expected) return 1
  let staged: { path: string; cleanup: () => void }
  try {
    staged = deps.stage(request.file)
  } catch {
    console.error('The restore archive cannot be copied. Nothing was imported.')
    return 1
  }
  try {
    const copied = deps.sha256(staged.path)
    if (copied !== expected) {
      console.error(
        `The restore archive changed after the check (SHA-256 ${copied}). Nothing was imported.`
      )
      log(
        deps,
        {
          event: 'finished',
          ...decisionFields(decision),
          codes: ['LIVE_WINDOW_RESTORE'],
          exitCode: 1,
        },
        deps.facts().now
      )
      return 1
    }
    const run = deps.spawn(
      ['import', '--replace-all', '-y', staged.path],
      false
    )
    log(
      deps,
      { event: 'finished', ...decisionFields(decision), exitCode: run.status },
      deps.facts().now
    )
    return run.status ?? 1
  } finally {
    staged.cleanup()
  }
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (scriptPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runLiveWindowCli(process.argv.slice(2))
}
