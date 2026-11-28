/**
 * Runs a read-only operation on the live Convex deployment, outside a
 * maintenance window (docs/operations/chain-runbook.md, "Read-only operations
 * on the live deployment").
 *
 *   bun scripts/live-read.ts check [<function> [json]]   # dry mode, no network
 *   bun scripts/live-read.ts run <function> [json]
 *
 * Run it with Bun directly, not through `bun run`: `bun run` puts the
 * checkout's node_modules/.bin first in PATH.
 *
 * The functions and their argument shapes are in scripts/lib/live-read.ts.
 * `check` evaluates the approval (and the operation, if given) from local
 * state only. `run` evaluates again, prints a warning and writes the log
 * line, builds the Convex CLI from the checkout's HEAD commit
 * (scripts/lib/live-window-build.ts: export by object id, frozen install
 * without scripts, system Node, an environment with the deploy key only),
 * checks again, and runs `convex run <function> <json>` there, with the
 * arguments rebuilt from the checked values. It never pushes code.
 */
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

import {
  LIVE_READ_FUNCTIONS,
  LIVE_READ_FUNCTION_NAMES,
  describeLiveReadArgs,
  envFilesWithLiveAccess,
  evaluateLiveRead,
  liveReadBuildRoot,
  liveReadWarning,
  pruneOtherCaches,
  type LiveReadDecision,
  type LiveReadFacts,
} from './lib/live-read'
import {
  appendLiveWindowLog,
  liveWindowLogPath,
  readLiveWindowFacts,
  type LiveWindowLogEntry,
} from './lib/live-window'
import { prepareWindowBuild, type WindowBuild } from './lib/live-window-build'
import { NetworkGuardError } from './lib/network-guard'

type EnvLike = Record<string, string | undefined>

export type LiveReadDeps = {
  facts: () => LiveReadFacts
  /** Build the CLI from `commit`. Throws NetworkGuardError when it cannot. */
  build: (commit: string) => { tree: string }
  /** Run the Convex CLI in the build. */
  spawn: (convexArgs: string[]) => { status: number | null }
  /** Remove the build. */
  close: () => void
  /** Append one log line; throws NetworkGuardError when it cannot. */
  log: (entry: LiveWindowLogEntry, now: Date) => void
}

/** Read the local facts: the checkout, the clock and the `.env*` files. */
export function readLiveReadFacts(env: EnvLike): LiveReadFacts {
  const base = readLiveWindowFacts(env)
  return {
    now: base.now,
    head: base.head,
    dirty: base.dirty,
    ...(base.dirtyPaths ? { dirtyPaths: base.dirtyPaths } : {}),
    checkoutRoot: base.checkoutRoot,
    cwdRoot: base.cwdRoot,
    envFileHits: envFilesWithLiveAccess([base.checkoutRoot, process.cwd()]),
  }
}

function defaultDeps(env: EnvLike): LiveReadDeps {
  let build: WindowBuild | null = null
  return {
    facts: () => readLiveReadFacts(env),
    build: (commit) => {
      const root = liveReadBuildRoot()
      pruneOtherCaches(root, commit)
      build = prepareWindowBuild({
        commit,
        repoRoot: readLiveWindowFacts(env).checkoutRoot,
        deployKey: env.CONVEX_DEPLOY_KEY?.trim() ?? '',
        bun: process.execPath,
        bunVersion: process.versions.bun,
        term: env.TERM,
        root,
      })
      return { tree: build.tree }
    },
    spawn: (convexArgs) => {
      if (!build) {
        console.error('No build. Nothing was run.')
        return { status: 1 }
      }
      const command = build.command(convexArgs)
      const result = spawnSync(command.file, command.args, {
        cwd: command.cwd,
        env: command.env as NodeJS.ProcessEnv,
        stdio: 'inherit',
      })
      return { status: result.status }
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
  }
}

const USAGE = `Usage:
  bun scripts/live-read.ts check [<function> [json]]
  bun scripts/live-read.ts run <function> [json]`

function decisionFields(decision: LiveReadDecision) {
  return {
    operation: decision.request?.detail ?? 'read check',
    deployment: decision.deployment,
    commit: decision.commit,
  }
}

function allowedSummary(): string {
  return [
    'Read-only operations:',
    ...LIVE_READ_FUNCTION_NAMES.map((fn) => {
      const entry = LIVE_READ_FUNCTIONS[fn]
      const args = Object.keys(entry?.args ?? {})
      return `  ${fn} ${args.length ? `{${args.map((a) => `"${a}"`).join(', ')}}` : '(no arguments)'}`
    }),
  ].join('\n')
}

function log(deps: LiveReadDeps, entry: LiveWindowLogEntry, now: Date) {
  try {
    deps.log(entry, now)
    return true
  } catch (error) {
    if (!(error instanceof NetworkGuardError)) throw error
    console.error(error.message)
    return false
  }
}

/** Evaluate; on refusal print and log it. Returns null when refused. */
function decide(
  args: string[] | null,
  env: EnvLike,
  deps: LiveReadDeps
): { decision: LiveReadDecision; facts: LiveReadFacts } | null {
  const facts = deps.facts()
  try {
    return { decision: evaluateLiveRead(args, env, facts), facts }
  } catch (error) {
    if (!(error instanceof NetworkGuardError)) throw error
    console.error(error.message)
    log(
      deps,
      {
        event: 'refused',
        operation: describeLiveReadArgs(args),
        codes: error.codes,
      },
      facts.now
    )
    return null
  }
}

export function runLiveReadCli(
  argv: string[],
  env: EnvLike = process.env,
  deps: LiveReadDeps = defaultDeps(env)
): number {
  const [command, ...args] = argv
  if (command === 'check') {
    const result = decide(args.length > 0 ? args : null, env, deps)
    if (!result) return 1
    const { decision, facts } = result
    if (!log(deps, { event: 'check', ...decisionFields(decision) }, facts.now))
      return 1
    console.log(
      [
        `Read-only approval is valid for ${decision.deployment}; runs are built from ${decision.commit}.`,
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
  if (!result?.decision.request) return 1
  const { decision, facts } = result
  const request = decision.request
  if (!request) return 1
  if (!log(deps, { event: 'allowed', ...decisionFields(decision) }, facts.now))
    return 1
  console.warn(liveReadWarning(decision))

  try {
    let tree: string
    try {
      tree = deps.build(decision.commit).tree
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
    // Check again after the build: the shell, the checkout or HEAD may have
    // changed meanwhile. The run uses the build of the first decision's
    // commit, so HEAD must still be that commit.
    const again = decide(args, env, deps)
    if (!again) return 1
    if (
      again.decision.commit !== decision.commit ||
      again.decision.request?.argsJson !== request.argsJson
    ) {
      console.error('HEAD changed during the build. Nothing was run.')
      log(
        deps,
        {
          event: 'finished',
          ...decisionFields(decision),
          codes: ['LIVE_READ_CHECKOUT'],
          exitCode: 1,
        },
        deps.facts().now
      )
      return 1
    }
    const run = deps.spawn(request.convexArgs)
    log(
      deps,
      { event: 'finished', ...decisionFields(decision), exitCode: run.status },
      deps.facts().now
    )
    return run.status ?? 1
  } finally {
    deps.close()
  }
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (scriptPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runLiveReadCli(process.argv.slice(2))
}
