/**
 * Read-only operations on the live Convex deployment, outside a maintenance
 * window (docs/operations/chain-runbook.md, "Read-only operations on the live
 * deployment").
 *
 * The network guard accepts an operational run on the live deployment when
 * QUILLTIP_LIVE_BACKEND_OPERATIONAL_APPROVAL names it, but it reads only the
 * kind of work and the target, never the function or its arguments. A Convex
 * deploy key can run any function, so `convex run` with that approval is not
 * limited to reads. This module is the limit: `scripts/live-read.ts` runs
 * only the functions listed in LIVE_READ_FUNCTIONS, each with a fixed
 * argument shape, and only when all of these hold:
 *
 * - the operational approval is set in the shell (never in a `.env` file) to
 *   exactly a built-in live deployment name;
 * - that deployment is the only Convex target, selected by a development
 *   deploy key for it, and no other Convex CLI target variable is set;
 * - the maintenance-window approval is not set (the shared guard refuses it);
 * - the checkout is clean, and the command runs from it;
 * - the Stellar checks pass for TESTNET (mainnet is refused as always).
 *
 * What makes an entry read-only is the list itself, reviewed against the
 * code: each entry records the Convex function type and why it writes
 * nothing with exactly the listed arguments. A query is read-only by the
 * Convex runtime; an action is read-only only by its code, so each action
 * entry names what it calls (`scripts/network/live-read.test.ts` checks the
 * source of each listed function against its entry).
 *
 * Every run is built like a window run (scripts/lib/live-window-build.ts):
 * the Convex CLI comes from a verified export of the checkout's HEAD commit
 * and a frozen install, runs with system Node and an environment that holds
 * only the deploy key, and receives arguments this module builds. The
 * checkout's `node_modules` never runs with the key.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  LIVE_BACKEND_APPROVAL_ENV,
  LIVE_CONVEX_DEPLOYMENTS,
  NetworkGuardError,
  parseConvexDeploymentRef,
  type NetworkGuardRefusal,
  type NetworkGuardResult,
} from '../../convex/lib/networkGuard'
import { isAccountAddress, type ArgCheck } from './live-window'
import { assertScriptTestnetOnly } from './network-guard'

export { LIVE_BACKEND_APPROVAL_ENV }

type EnvLike = Record<string, string | undefined>

/** The Convex function type, as declared in the function's module. */
export type ConvexFunctionType =
  | 'query'
  | 'internalQuery'
  | 'action'
  | 'internalAction'

export type ReadOnlyFunction = {
  type: ConvexFunctionType
  /** Arguments the function may take here, each with a value check. */
  args: Readonly<Record<string, ArgCheck>>
  /** Arguments that must be present. */
  required: readonly string[]
  /**
   * Actions only: the functions the handler may call, as written in the
   * source (`internal.<module>.<name>`). Anything else (another call,
   * `runAction`, `scheduler`, `fetch`) fails the source check.
   */
  calls?: readonly string[]
  /** Why the function writes nothing with these arguments. */
  readOnly: string
}

/**
 * The closed list of read-only operations. Any other function, argument name
 * or value shape is refused. The backend validators check the arguments
 * again.
 */
export const LIVE_READ_FUNCTIONS: Readonly<Record<string, ReadOnlyFunction>> = {
  // Chain runbook, "Stale settlement reserves", step 2: the daily dry run.
  'chain/tabReconcile:run': {
    type: 'internalAction',
    args: { reader: isAccountAddress },
    required: ['reader'],
    calls: [
      'internal.chain.tabReconcile.snapshot',
      'internal.chain.indexer.readCursor',
      'internal.chain.tabReconcile.reconcile',
    ],
    readOnly:
      'Without `apply` the action passes `apply: false` to the reconcile mutation, which returns before any write. `apply` and `note` are not accepted here; an apply is a window operation. The chain read is an RPC simulation, never a submitted transaction.',
  },
  // Cutover stage 1 and stage 3 check.
  'chain/config:getChainConfig': {
    type: 'query',
    args: {},
    required: [],
    readOnly: 'A public query: Convex refuses writes in a query.',
  },
  // Cutover stage 5A and section 9: writers' lifetime totals.
  'earningsTotalsBackfill:progress': {
    type: 'internalQuery',
    args: {},
    required: [],
    readOnly: 'An internal query: Convex refuses writes in a query.',
  },
  // Cutover stage 1, step 4: article images by host.
  'articleImageHosts:countImageHosts': {
    type: 'internalAction',
    args: {},
    required: [],
    calls: [
      'internal.articleImageHosts.imageHostPage',
      'internal.articleImageHosts.avatarHostPage',
    ],
    readOnly:
      'The action only pages through two internal queries and counts; it calls no mutation, action or scheduler.',
  },
}

export const LIVE_READ_FUNCTION_NAMES: readonly string[] =
  Object.keys(LIVE_READ_FUNCTIONS)

/** Convex CLI target variables that must be unset (the key selects it). */
export const LIVE_READ_OTHER_TARGETS = [
  'CONVEX_DEPLOYMENT',
  'CONVEX_DEPLOYMENT_TOKEN',
  'CONVEX_SELF_HOSTED_URL',
  'CONVEX_SELF_HOSTED_ADMIN_KEY',
  'CONVEX_PROVISION_HOST',
  'CONVEX_OVERRIDE_ACCESS_TOKEN',
] as const

/** Variables that load code into Bun or Node before any check can run. */
const CODE_LOADING_ENV = ['NODE_OPTIONS', 'NODE_PATH', 'BUN_OPTIONS'] as const

export type LiveReadRequest = {
  fn: string
  /** The arguments as sent: built here from the checked values. */
  argsJson: string
  /** Convex CLI arguments. `run` without `--push`: nothing is deployed. */
  convexArgs: string[]
  /** Log-safe description: function and arguments, no credential. */
  detail: string
}

function refusal(
  code: NetworkGuardRefusal['code'],
  message: string
): NetworkGuardRefusal {
  return { code, message }
}

/**
 * Check a function name and its JSON arguments, and build the Convex CLI
 * arguments. The arguments sent are rebuilt from the checked values in the
 * order of the list, never forwarded as typed.
 */
export function parseLiveReadRequest(
  args: readonly string[]
): { request: LiveReadRequest } | { refusals: NetworkGuardRefusal[] } {
  const refuse = (message: string) => ({
    refusals: [refusal('LIVE_READ_OPERATION', message)],
  })
  if (args.length < 1 || args.length > 2) {
    return refuse('Give a function name and optional JSON args.')
  }
  const [fn, json] = args as [string, string | undefined]
  const entry = Object.hasOwn(LIVE_READ_FUNCTIONS, fn)
    ? LIVE_READ_FUNCTIONS[fn]
    : undefined
  if (!entry) {
    return refuse(
      `That is not a read-only operation. Allowed: ${LIVE_READ_FUNCTION_NAMES.join(', ')}.`
    )
  }
  let parsed: unknown = {}
  if (json !== undefined) {
    try {
      parsed = JSON.parse(json)
    } catch {
      return refuse('The args are not valid JSON.')
    }
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    return refuse('The args must be a JSON object.')
  }
  const given = parsed as Record<string, unknown>
  const allowed = Object.keys(entry.args)
  for (const name of Object.keys(given)) {
    const check = Object.hasOwn(entry.args, name) ? entry.args[name] : undefined
    if (!check) {
      return refuse(
        `Argument ${/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(name) ? `"${name}"` : '<name>'} is not allowed for ${fn} (allowed: ${allowed.length ? allowed.join(', ') : 'none'}).`
      )
    }
    const reason = check(given[name])
    if (reason) return refuse(`Argument "${name}" of ${fn} ${reason}.`)
  }
  for (const name of entry.required) {
    if (!Object.hasOwn(given, name)) {
      return refuse(`${fn} needs the argument "${name}".`)
    }
  }
  const canonical: Record<string, unknown> = {}
  for (const name of allowed) {
    if (Object.hasOwn(given, name)) canonical[name] = given[name]
  }
  const argsJson = JSON.stringify(canonical)
  return {
    request: {
      fn,
      argsJson,
      convexArgs: ['run', fn, argsJson],
      detail: `read ${fn} ${argsJson}`,
    },
  }
}

/**
 * Log-safe label for requested arguments, refused or not: the function name
 * when it is listed, never the JSON arguments.
 */
export function describeLiveReadArgs(args: readonly string[] | null): string {
  if (!args || args.length === 0) return 'read check'
  const fn = args[0] ?? ''
  return `read ${LIVE_READ_FUNCTION_NAMES.includes(fn) ? fn : '<function>'}`
}

// ---------------------------------------------------------------------------
// Local facts
// ---------------------------------------------------------------------------

export type LiveReadFacts = {
  now: Date
  /** Full HEAD commit of the checkout: the commit each run is built from. */
  head: string | null
  /** True when the checkout has changes or untracked files; null if unknown. */
  dirty: boolean | null
  dirtyPaths?: string[]
  /** The checkout that holds this tool. */
  checkoutRoot: string
  /** Top level of the checkout the command runs from, or null. */
  cwdRoot: string | null
  /** `.env*` files (by path) that assign the operational approval. */
  envFileHits: string[]
}

const APPROVAL_ASSIGNMENT = new RegExp(
  `^\\s*(export\\s+)?${LIVE_BACKEND_APPROVAL_ENV}\\s*[=:]`,
  'm'
)

function realpath(dir: string): string {
  try {
    return fs.realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

/** `.env*` files in `dirs` that assign the operational approval. */
export function envFilesAssigningOperationalApproval(
  dirs: readonly string[]
): string[] {
  const hits: string[] = []
  for (const dir of new Set(dirs.map(realpath))) {
    let names: string[] = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names.filter((n) => n.startsWith('.env')).sort()) {
      const file = path.join(dir, name)
      try {
        if (!fs.statSync(file).isFile()) continue
        if (APPROVAL_ASSIGNMENT.test(fs.readFileSync(file, 'utf8'))) {
          hits.push(file)
        }
      } catch {
        // Unreadable: Bun cannot load it either.
      }
    }
  }
  return hits
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type LiveReadDecision = {
  deployment: string
  commit: string
  request: LiveReadRequest | null
  guard: NetworkGuardResult
}

function checkoutRefusals(facts: LiveReadFacts): NetworkGuardRefusal[] {
  const refusals: NetworkGuardRefusal[] = []
  if (!facts.head || !/^[0-9a-f]{40}$/.test(facts.head)) {
    refusals.push(
      refusal('LIVE_READ_CHECKOUT', 'The checkout commit cannot be read.')
    )
  }
  if (facts.dirty !== false) {
    refusals.push(
      refusal(
        'LIVE_READ_CHECKOUT',
        facts.dirty === null
          ? 'The checkout state cannot be read.'
          : `The checkout has changes or untracked files${facts.dirtyPaths?.length ? ` (${facts.dirtyPaths.join(', ')})` : ''}. Use a clean checkout.`
      )
    )
  }
  if (facts.cwdRoot !== facts.checkoutRoot) {
    refusals.push(
      refusal(
        'LIVE_READ_CHECKOUT',
        `Run the command from the checkout that holds the tool (${facts.checkoutRoot}).`
      )
    )
  }
  return refusals
}

function targetRefusals(env: EnvLike, approval: string): NetworkGuardRefusal[] {
  const refusals: NetworkGuardRefusal[] = []
  for (const name of LIVE_READ_OTHER_TARGETS) {
    if (env[name]?.trim()) {
      refusals.push(
        refusal(
          'LIVE_READ_OTHER_TARGET',
          `${name} is set. A read-only run selects the deployment with CONVEX_DEPLOY_KEY only; unset ${name}.`
        )
      )
    }
  }
  for (const name of CODE_LOADING_ENV) {
    if (env[name]?.trim()) {
      refusals.push(
        refusal(
          'LIVE_READ_CHECKOUT',
          `${name} is set. It can load code into this tool or the Convex CLI; unset ${name}.`
        )
      )
    }
  }
  const key = env.CONVEX_DEPLOY_KEY?.trim() ?? ''
  if (!key) {
    refusals.push(
      refusal(
        'LIVE_READ_CREDENTIAL',
        `CONVEX_DEPLOY_KEY is not set. Use a development deploy key for ${approval || 'the live deployment'}.`
      )
    )
  } else if (key.includes('|')) {
    const ref = parseConvexDeploymentRef(key)
    // The name is compared only with a valid approval; a missing or wrong
    // approval is refused on its own.
    const validApproval = LIVE_CONVEX_DEPLOYMENTS.includes(approval)
    if (ref.type !== 'dev' || (validApproval && ref.name !== approval)) {
      // Print the type and name only, never the key.
      refusals.push(
        refusal(
          'LIVE_READ_CREDENTIAL',
          `CONVEX_DEPLOY_KEY is a "${ref.type ?? 'unknown'}" key for "${ref.name}". A read-only run needs a development deploy key for ${approval || 'the live deployment'}.`
        )
      )
    }
  }
  // A key without "type:name|" is refused by the shared guard below.
  return refusals
}

/**
 * Evaluate a read-only run and, when `args` is given, the operation. Throws
 * NetworkGuardError with every refusal. `args` null is the dry check of the
 * approval alone.
 */
export function evaluateLiveRead(
  args: readonly string[] | null,
  env: EnvLike,
  facts: LiveReadFacts
): LiveReadDecision {
  const operation = `live ${describeLiveReadArgs(args)}`
  const refusals: NetworkGuardRefusal[] = []
  const approval = env[LIVE_BACKEND_APPROVAL_ENV] ?? ''

  // The shared operational guard first: opt-in, TESTNET, no mainnet value,
  // the live target only with the approval, and never with the window
  // approval set. Without any approval it refuses the live target exactly as
  // every other operational tool does.
  let guard: NetworkGuardResult | null = null
  try {
    guard = assertScriptTestnetOnly(operation, env)
  } catch (error) {
    if (!(error instanceof NetworkGuardError)) throw error
    refusals.push(...error.refusals)
  }

  // Exactly a built-in live name: no trimming, no case folding, and never a
  // name from the extra production list or the allowlist.
  if (!LIVE_CONVEX_DEPLOYMENTS.includes(approval)) {
    refusals.push(
      refusal(
        'LIVE_READ_INVALID',
        approval
          ? `${LIVE_BACKEND_APPROVAL_ENV} must be exactly a live deployment name (${LIVE_CONVEX_DEPLOYMENTS.join(', ')}).`
          : `${LIVE_BACKEND_APPROVAL_ENV} is not set. This tool runs read-only operations on the live deployment only, with the owner's approval.`
      )
    )
  }
  if (facts.envFileHits.length > 0) {
    refusals.push(
      refusal(
        'LIVE_READ_IN_FILE',
        `${LIVE_BACKEND_APPROVAL_ENV} is assigned in ${facts.envFileHits.join(', ')}. Set it in the shell for the run only and remove it from the file.`
      )
    )
  }
  refusals.push(...targetRefusals(env, approval))
  refusals.push(...checkoutRefusals(facts))

  if (
    guard &&
    (!guard.liveBackendApproved ||
      guard.liveWindowApproved ||
      guard.convexDeployments.length !== 1 ||
      guard.convexDeployments[0] !== approval)
  ) {
    refusals.push(
      refusal(
        'LIVE_READ_OTHER_TARGET',
        `The only Convex target must be the approved live deployment${approval ? ` ${approval}` : ''}.`
      )
    )
  }

  let request: LiveReadRequest | null = null
  if (args) {
    const parsed = parseLiveReadRequest(args)
    if ('refusals' in parsed) refusals.push(...parsed.refusals)
    else request = parsed.request
  }

  if (refusals.length > 0 || !guard || !facts.head) {
    throw new NetworkGuardError(operation, refusals)
  }
  return { deployment: approval, commit: facts.head, request, guard }
}

/** Where read-only builds and their package cache live (not the window's). */
export function liveReadBuildRoot(home = os.homedir()): string {
  return path.join(home, '.quilltip', 'live-read', 'builds')
}

/**
 * Remove the package caches of other commits from the read-only build root,
 * so a cache is never reused after the commit changes and the folder does not
 * grow by a cache per commit. Only this tool writes there.
 */
export function pruneOtherCaches(root: string, commit: string): void {
  let names: string[]
  try {
    names = fs.readdirSync(root)
  } catch {
    return
  }
  for (const name of names) {
    if (/^cache-[0-9a-f]{40}$/.test(name) && name !== `cache-${commit}`) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true })
    }
  }
}

/** The warning printed before every read-only run. */
export function liveReadWarning(decision: LiveReadDecision): string {
  return [
    '',
    '!!! LIVE DEPLOYMENT: READ-ONLY OPERATION !!!',
    `  Deployment: ${decision.deployment} (live)`,
    `  Built from: ${decision.commit}`,
    `  Operation:  ${decision.request?.detail ?? 'check'}`,
    '',
  ].join('\n')
}
