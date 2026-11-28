/**
 * Operator approval for one scheduled maintenance window on the live Convex
 * deployment (the payments v2 cutover, docs/operations/payments-v2-cutover.md).
 *
 * The network guard refuses every deploy-kind action on a live deployment.
 * This module is the one narrow exception. `scripts/live-window.ts` uses it to
 * run a fixed list of window operations, and only when all of these hold:
 *
 * - LIVE_WINDOW_APPROVAL_ENV is set in the shell (never in a `.env` file or a
 *   committed file) to `<deployment>@<release commit>@<UTC start>+<hours>h`;
 * - the deployment is a live deployment and the only Convex target, selected
 *   by a development deploy key for that deployment;
 * - the checkout is at the release commit, with no changes and no untracked
 *   files, and the command runs from that checkout;
 * - the window has started and has not ended (at most LIVE_WINDOW_MAX_HOURS);
 * - the operation and its arguments are on the lists below;
 * - the Stellar checks pass for TESTNET (mainnet is refused as always).
 *
 * Every evaluation appends a line to a local log outside the repository.
 */
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

import {
  LIVE_CONVEX_DEPLOYMENTS,
  LIVE_WINDOW_APPROVAL_ENV,
  NetworkGuardError,
  assertTestnetOnly,
  parseConvexDeploymentRef,
  type NetworkGuardRefusal,
  type NetworkGuardResult,
} from '../../convex/lib/networkGuard'
import { TESTNET_PASSPHRASE } from '../../convex/lib/stellarNetwork'
import {
  assertScriptConvexDeployAllowed,
  convexInputs,
  stellarInputs,
} from './network-guard'

export { LIVE_WINDOW_APPROVAL_ENV }

type EnvLike = Record<string, string | undefined>

/** Path of the local log. Defaults to LIVE_WINDOW_DEFAULT_LOG. */
export const LIVE_WINDOW_LOG_ENV = 'QUILLTIP_LIVE_WINDOW_LOG'
export const LIVE_WINDOW_DEFAULT_LOG = path.join('.quilltip', 'live-window.log')

/**
 * Binding for a replace-all import (runbook section 6.2): the reviewed restore
 * archive, by deployment and SHA-256, `<deployment>@sha256:<64 hex>`. The
 * restore file is rebuilt from the stage 0 snapshot and the second export, so
 * its digest is recorded after review, not taken from either export.
 */
export const LIVE_WINDOW_RESTORE_ENV = 'QUILLTIP_LIVE_WINDOW_RESTORE'
export const LIVE_WINDOW_RESTORE_FORMAT = '<deployment>@sha256:<64 hex digits>'
const RESTORE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)@sha256:([0-9a-f]{64})$/

/** SHA-256 of a file, read in chunks. */
export function sha256File(file: string): string {
  const hash = createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(1 << 20)
    let read = 0
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

/**
 * Copy a restore archive into a new private directory, so the file that is
 * hashed is the file that is imported. `cleanup` removes the copy.
 */
export function stageRestoreCopy(file: string): {
  path: string
  cleanup: () => void
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quilltip-restore-'))
  fs.chmodSync(dir, 0o700)
  const copy = path.join(dir, 'restore.zip')
  fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(copy, 0o600)
  return {
    path: copy,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

/** Longest window an approval may name, in hours. */
export const LIVE_WINDOW_MAX_HOURS = 4

/** Value format, for messages and documentation. */
export const LIVE_WINDOW_FORMAT =
  '<deployment>@<40-character commit>@<YYYY-MM-DDTHH:MMZ>+<hours>h'

const APPROVAL_PATTERN =
  /^([a-z0-9]+(?:-[a-z0-9]+)*)@([0-9a-f]{40})@(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})Z\+([1-9]\d?)h$/

export type LiveWindowApproval = {
  deployment: string
  commit: string
  start: Date
  end: Date
  hours: number
}

function refusal(
  code: NetworkGuardRefusal['code'],
  message: string
): NetworkGuardRefusal {
  return { code, message }
}

/**
 * Parse the approval value. The value is matched exactly: no trimming, no
 * upper case, no short commit, a real UTC date and 1 to LIVE_WINDOW_MAX_HOURS
 * hours.
 */
export function parseLiveWindowApproval(
  value: string | undefined
): { approval: LiveWindowApproval } | { refusal: NetworkGuardRefusal } {
  const malformed = refusal(
    'LIVE_WINDOW_INVALID',
    `${LIVE_WINDOW_APPROVAL_ENV} is not in the format ${LIVE_WINDOW_FORMAT} (at most ${LIVE_WINDOW_MAX_HOURS} hours).`
  )
  const match = value ? APPROVAL_PATTERN.exec(value) : null
  if (!match) return { refusal: malformed }
  const [, deployment, commit, y, mo, d, h, mi, hoursText] =
    match as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  const hours = Number(hoursText)
  const startMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi)
  )
  const start = new Date(startMs)
  const roundTrip = start.toISOString().slice(0, 16)
  if (roundTrip !== `${y}-${mo}-${d}T${h}:${mi}`) return { refusal: malformed }
  if (!Number.isInteger(hours) || hours < 1 || hours > LIVE_WINDOW_MAX_HOURS) {
    return { refusal: malformed }
  }
  return {
    approval: {
      deployment,
      commit,
      start,
      end: new Date(startMs + hours * 3_600_000),
      hours,
    },
  }
}

// ---------------------------------------------------------------------------
// Window operations
// ---------------------------------------------------------------------------

/** Operation names the window accepts. Everything else is refused. */
export const LIVE_WINDOW_OPERATIONS = [
  'deploy-dry-run',
  'deploy',
  'export',
  'import',
  'env-set',
  'env-remove',
  'convex-run',
  'pause',
  'resume',
] as const

export type LiveWindowOperation = (typeof LIVE_WINDOW_OPERATIONS)[number]

/** One argument check: null when the value is allowed, else the reason. */
type ArgCheck = (value: unknown) => string | null

type FunctionShape = {
  /** Arguments the function may take, each with a value check. */
  args: Readonly<Record<string, ArgCheck>>
  /** Arguments that must be present. */
  required?: readonly string[]
  /** Extra rule across arguments, for example a note with every apply. */
  rule?: (args: Readonly<Record<string, unknown>>) => string | null
}

const isBoolean: ArgCheck = (v) =>
  typeof v === 'boolean' ? null : 'must be true or false'

const isCursor: ArgCheck = (v) =>
  v === null || (typeof v === 'string' && /^[\x21-\x7e]{1,2048}$/.test(v))
    ? null
    : 'must be a page cursor or null'

function oneOf(...values: readonly string[]): ArgCheck {
  return (v) =>
    typeof v === 'string' && values.includes(v)
      ? null
      : `must be one of ${values.join(', ')}`
}

function integer(min: number, max: number): ArgCheck {
  return (v) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max
      ? null
      : `must be an integer from ${min} to ${max}`
}

/** A Convex document ID (lower-case letters and digits). */
const isDocumentId: ArgCheck = (v) =>
  typeof v === 'string' && /^[a-z0-9]{16,64}$/.test(v)
    ? null
    : 'must be a document ID'

const isNote: ArgCheck = (v) =>
  typeof v === 'string' && /^[\x20-\x7e]{1,500}$/.test(v)
    ? null
    : 'must be a printable note of up to 500 characters'

const isEventList: ArgCheck = (v) =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= 1000 &&
  v.every((e) => e !== null && typeof e === 'object' && !Array.isArray(e))
    ? null
    : 'must be a list of 1 to 1000 event objects'

const NO_ARGS: FunctionShape = { args: {} }

/**
 * The Convex functions the cutover runbook runs on the live deployment, each
 * with the argument names and values it may take. The list is closed: any
 * other function, argument name or value shape is refused. The backend
 * validators check the arguments again.
 */
export const LIVE_WINDOW_FUNCTION_SHAPES: Readonly<
  Record<string, FunctionShape>
> = {
  // Stage 1: v1 maintenance jobs.
  'legacyTipCleanup:run': {
    args: {
      table: oneOf('tips', 'highlightTips'),
      apply: isBoolean,
      cursor: isCursor,
    },
    required: ['table'],
  },
  'authorEarningsBackfill:run': {
    args: { dryRun: isBoolean },
    required: ['dryRun'],
  },
  // Stage 1 check and stage 3.
  'chain/config:getChainConfig': NO_ARGS,
  'chain/config:refreshChainConfig': NO_ARGS,
  // Stage 3 and section 7.2: events that waited for a variable.
  'chain/indexer:redispatch': { args: { limit: integer(1, 500) } },
  // Stage 4 and the restore.
  'chain/backfill:setContractVersionV1': {
    args: {
      table: oneOf('tips', 'highlightTips', 'articleNFTs'),
      apply: isBoolean,
      cursor: isCursor,
    },
    required: ['table'],
  },
  'chain/tabClaims:seedClaimRecords': {
    args: { apply: isBoolean, cursor: isCursor },
  },
  'chain/tabClaims:recomputeCollected': {
    args: {
      apply: isBoolean,
      note: isNote,
      userId: isDocumentId,
      cursor: isCursor,
    },
    // An applied correction carries the incident note (section 6.2).
    rule: (a) =>
      a.apply === true && a.note === undefined ? 'apply needs a note' : null,
  },
  // Stage 5 drain (dashboard in the runbook; recorded here when run).
  'reconcileTips:recoverStuckPendingArticleTips': NO_ARGS,
  'reconcileTips:recoverStuckPendingHighlightTips': NO_ARGS,
  // Stage 5A: writers' lifetime totals.
  'earningsTotalsBackfill:dryRun': {
    args: { cursor: isCursor, limit: integer(1, 50) },
  },
  'earningsTotalsBackfill:progress': NO_ARGS,
  'earningsTotalsBackfill:retryFailed': { args: { id: isDocumentId } },
  'earningsTotalsBackfill:reset': {
    args: { mode: oneOf('restart', 'remove') },
    required: ['mode'],
  },
  // Section 6.2 rebuild of chain events.
  'chain/indexer:replayFrom': {
    args: { fromLedger: integer(1, 2 ** 32 - 1), gapBackfilled: isBoolean },
    required: ['fromLedger'],
  },
  'chain/indexer:ingestBackfill': {
    args: { events: isEventList },
    required: ['events'],
  },
}

/** Internal backfills, maintenance and check functions the cutover runs. */
export const LIVE_WINDOW_FUNCTIONS: readonly string[] = Object.keys(
  LIVE_WINDOW_FUNCTION_SHAPES
)

/**
 * Check JSON arguments against a function's shape. Returns the reason for a
 * refusal, without echoing any value.
 */
export function functionArgsRefusal(
  fn: string,
  args: Readonly<Record<string, unknown>>
): string | null {
  const shape = LIVE_WINDOW_FUNCTION_SHAPES[fn]
  if (!shape) return 'that function is not allowed'
  for (const name of Object.keys(args)) {
    const check = Object.hasOwn(shape.args, name) ? shape.args[name] : undefined
    if (!check) {
      const allowed = Object.keys(shape.args)
      return `argument ${/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(name) ? `"${name}"` : '<name>'} is not allowed for ${fn} (allowed: ${allowed.length ? allowed.join(', ') : 'none'})`
    }
    const reason = check(args[name])
    if (reason) return `argument "${name}" of ${fn} ${reason}`
  }
  for (const name of shape.required ?? []) {
    if (!Object.hasOwn(args, name)) {
      return `${fn} needs the argument "${name}"`
    }
  }
  return shape.rule?.(args) ?? null
}

const CONTRACT_ID = /^C[A-Z2-7]{55}$/
const POSITIVE_INTEGER = /^[1-9]\d{0,18}$/
const BOOLEAN = /^(true|false)$/

function httpsTestnetUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'is not a URL'
  }
  if (url.protocol !== 'https:') return 'must be an https URL'
  try {
    assertTestnetOnly({
      operation: 'live window env value',
      requireOptIn: false,
      checkConvex: false,
      stellarNetworks: ['TESTNET'],
      stellarUrls: [value],
    })
  } catch (error) {
    if (error instanceof NetworkGuardError) {
      return `is refused by the network guard (${error.codes.join(', ')})`
    }
    throw error
  }
  return null
}

function matches(pattern: RegExp, description: string) {
  return (value: string) => (pattern.test(value) ? null : description)
}

/**
 * Non-secret variables of runbook section 3.1 that the window may set, with a
 * check of each value. Secrets (TAB_ACCEPTOR_SECRET, TAB_SETTLER_SECRET,
 * ARWEAVE_WALLET_KEY) stay in the dashboard, and ARWEAVE_ENABLED is not
 * changed in the window. STELLAR_NETWORK (already TESTNET, checked only) and
 * HORIZON_URL (unchanged) are not set by the runbook, so they are not listed.
 */
export const LIVE_WINDOW_ENV_SET: Readonly<
  Record<string, (value: string) => string | null>
> = {
  NETWORK_PASSPHRASE: (v) =>
    v === TESTNET_PASSPHRASE ? null : `must be "${TESTNET_PASSPHRASE}"`,
  STELLAR_RPC_URL: httpsTestnetUrl,
  CHAIN_V2_ENABLED: matches(BOOLEAN, 'must be true or false'),
  CHAIN_V1_PREPARES_ENABLED: matches(BOOLEAN, 'must be true or false'),
  SETTLEMENT_ENABLED: matches(BOOLEAN, 'must be true or false'),
  CHAIN_EPOCH: matches(
    /^testnet-[a-z0-9-]{1,40}$/,
    'must start with "testnet-"'
  ),
  CORE_CONTRACT_ID: matches(CONTRACT_ID, 'must be a contract address'),
  TAB_CONTRACT_ID: matches(CONTRACT_ID, 'must be a contract address'),
  NFT_CONTRACT_ID: matches(CONTRACT_ID, 'must be a contract address'),
  TOKEN_CONTRACT_ID: matches(CONTRACT_ID, 'must be a contract address'),
  INDEXER_START_LEDGER: matches(POSITIVE_INTEGER, 'must be a ledger number'),
  TAB_DAILY_LIMIT: matches(POSITIVE_INTEGER, 'must be a positive integer'),
  TAB_TIP_MAX: matches(POSITIVE_INTEGER, 'must be a positive integer'),
  OPS_USER_IDS: matches(
    /^[a-z0-9]{1,64}(,[a-z0-9]{1,64}){0,49}$/,
    'must be comma-separated Convex user IDs'
  ),
  EARNINGS_TOTALS_REBUILD_ENABLED: matches(BOOLEAN, 'must be true or false'),
  INTERNAL_ACCOUNT_EMAIL_DOMAINS: matches(
    /^[a-z0-9.-]{1,253}(,[a-z0-9.-]{1,253}){0,49}$/,
    'must be comma-separated lower-case domains'
  ),
}

/** Variables the window may remove (runbook stage 3 rollback). */
export const LIVE_WINDOW_ENV_REMOVE: readonly string[] = [
  'CORE_CONTRACT_ID',
  'TAB_CONTRACT_ID',
  'NFT_CONTRACT_ID',
  'TOKEN_CONTRACT_ID',
  'INDEXER_START_LEDGER',
]

export type LiveWindowRequest = {
  operation: LiveWindowOperation
  /** Convex CLI arguments, or null for a dashboard step (pause, resume). */
  convexArgs: string[] | null
  /** Log-safe description: no credential, no secret value. */
  detail: string
  /** export and import: the archive path. */
  file?: string
  /** import: the approved SHA-256 the archive matched. */
  sha256?: string
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

/**
 * Check the operation and its arguments, and build the Convex CLI arguments.
 * The caller never passes CLI flags through, so no flag can select another
 * deployment.
 */
export function parseLiveWindowRequest(
  args: readonly string[],
  checkoutRoot: string,
  fileExists: (file: string) => boolean = fs.existsSync
): { request: LiveWindowRequest } | { refusals: NetworkGuardRefusal[] } {
  const [name, ...rest] = args
  const refuse = (message: string) => ({
    refusals: [refusal('LIVE_WINDOW_OPERATION', message)],
  })
  if (!name || !(LIVE_WINDOW_OPERATIONS as readonly string[]).includes(name)) {
    return refuse(
      `That is not a window operation. Allowed: ${LIVE_WINDOW_OPERATIONS.join(', ')}.`
    )
  }
  const operation = name as LiveWindowOperation
  const arity = (count: number) =>
    rest.length === count
      ? null
      : refuse(
          `${operation} takes ${count} argument${count === 1 ? '' : 's'}; got ${rest.length}.`
        )

  switch (operation) {
    case 'deploy-dry-run':
    case 'deploy':
    case 'pause':
    case 'resume': {
      const bad = arity(0)
      if (bad) return bad
      const convexArgs =
        operation === 'deploy-dry-run'
          ? ['deploy', '--dry-run']
          : operation === 'deploy'
            ? ['deploy']
            : null
      return { request: { operation, convexArgs, detail: operation } }
    }
    case 'export':
    case 'import': {
      const bad = arity(1)
      if (bad) return bad
      // Resolve symbolic links in the folder, so a link cannot place the
      // archive inside the repository.
      const requested = path.resolve(rest[0] as string)
      const file = path.join(
        realpath(path.dirname(requested)),
        path.basename(requested)
      )
      if (!file.endsWith('.zip')) {
        return refuse(`${operation} needs a .zip file.`)
      }
      if (isInside(checkoutRoot, file)) {
        return refuse(
          `${operation} files hold deployment data and must be outside the repository.`
        )
      }
      if (operation === 'export' && fileExists(file)) {
        return refuse('export never overwrites an existing file.')
      }
      if (operation === 'import' && !fileExists(file)) {
        return refuse('import needs an existing restore file.')
      }
      const convexArgs =
        operation === 'export'
          ? ['export', '--include-file-storage', '--path', file]
          : ['import', '--replace-all', '-y', file]
      return {
        request: {
          operation,
          convexArgs,
          detail: `${operation} ${file}`,
          file,
        },
      }
    }
    case 'env-set': {
      const bad = arity(2)
      if (bad) return bad
      const [variable, value] = rest as [string, string]
      const check = LIVE_WINDOW_ENV_SET[variable]
      if (!check) {
        return refuse(
          `env-set is not allowed for "${safeVariableName(variable)}". Allowed: ${Object.keys(LIVE_WINDOW_ENV_SET).join(', ')}. Set secrets in the Convex dashboard.`
        )
      }
      const problem = check(value)
      if (problem) return refuse(`${variable} ${problem}.`)
      return {
        request: {
          operation,
          convexArgs: ['env', 'set', variable, value],
          detail: `env-set ${variable}=${value}`,
        },
      }
    }
    case 'env-remove': {
      const bad = arity(1)
      if (bad) return bad
      const variable = rest[0] as string
      if (!LIVE_WINDOW_ENV_REMOVE.includes(variable)) {
        return refuse(
          `env-remove is not allowed for "${safeVariableName(variable)}". Allowed: ${LIVE_WINDOW_ENV_REMOVE.join(', ')}.`
        )
      }
      return {
        request: {
          operation,
          convexArgs: ['env', 'remove', variable],
          detail: `env-remove ${variable}`,
        },
      }
    }
    case 'convex-run': {
      if (rest.length < 1 || rest.length > 2) {
        return refuse(
          'convex-run takes a function name and optional JSON args.'
        )
      }
      const [fn, json] = rest as [string, string | undefined]
      if (!LIVE_WINDOW_FUNCTIONS.includes(fn)) {
        return refuse(
          `convex-run is not allowed for that function. Allowed: ${LIVE_WINDOW_FUNCTIONS.join(', ')}.`
        )
      }
      let argsJson = '{}'
      if (json !== undefined) {
        let parsed: unknown
        try {
          parsed = JSON.parse(json)
        } catch {
          return refuse('convex-run args are not valid JSON.')
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return refuse('convex-run args must be a JSON object.')
        }
        argsJson = JSON.stringify(parsed)
      }
      const shapeRefusal = functionArgsRefusal(
        fn,
        JSON.parse(argsJson) as Record<string, unknown>
      )
      if (shapeRefusal) return refuse(`convex-run: ${shapeRefusal}.`)
      return {
        request: {
          operation,
          convexArgs: ['run', fn, argsJson],
          detail: `convex-run ${fn} ${argsJson}`,
        },
      }
    }
  }
}

/** The variable name when it looks like one; never echo a value. */
function safeVariableName(name: string | undefined): string {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(name ?? '')
    ? (name as string)
    : '<variable>'
}

/**
 * Log-safe label for requested arguments, refused or not: the operation name
 * and the variable or function name, never a value, path or JSON argument.
 */
export function describeLiveWindowArgs(args: readonly string[] | null): string {
  if (!args || args.length === 0) return 'check'
  const [name, target] = args
  if (!(LIVE_WINDOW_OPERATIONS as readonly string[]).includes(name ?? '')) {
    return '<unknown operation>'
  }
  if (name === 'env-set' || name === 'env-remove') {
    return `${name} ${safeVariableName(target)}`
  }
  if (name === 'convex-run') {
    return `${name} ${LIVE_WINDOW_FUNCTIONS.includes(target ?? '') ? target : '<function>'}`
  }
  return name as string
}

// ---------------------------------------------------------------------------
// Local facts: checkout, clock, files
// ---------------------------------------------------------------------------

export type LiveWindowFacts = {
  now: Date
  /** Full HEAD commit of the checkout, or null when unknown. */
  head: string | null
  /** True when the checkout has changes or untracked files; null if unknown. */
  dirty: boolean | null
  /** Up to 10 paths that differ from HEAD or are untracked. */
  dirtyPaths?: string[]
  /** The checkout that holds this guard (and the code that is pushed). */
  checkoutRoot: string
  /** Top level of the checkout the command runs from, or null. */
  cwdRoot: string | null
  /** `.env*` files (by name) that assign the approval variable. */
  envFileHits: string[]
  /** Tracked files that contain the approval value or assign one. */
  committedHits: string[]
}

const ASSIGNMENT = new RegExp(
  `^\\s*(export\\s+)?${LIVE_WINDOW_APPROVAL_ENV}\\s*[=:]`,
  'm'
)
/** A committed assignment with a real-looking value (not a placeholder). */
const COMMITTED_ASSIGNMENT = `${LIVE_WINDOW_APPROVAL_ENV}=["']?[a-z0-9-]+@[0-9a-f]{40}`

/**
 * The environment for git: the caller's environment without GIT_* variables,
 * so GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE or GIT_CONFIG_* cannot point the
 * checks at another repository or change how git reads this one.
 */
function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
  ) as NodeJS.ProcessEnv
}

function git(
  root: string,
  args: string[],
  input?: string,
  options: { workTree?: boolean; indexFile?: string } = {}
): string | null {
  try {
    return execFileSync(
      'git',
      [
        // Replace refs (`git replace`) would show another commit's tree for
        // the approved commit.
        '--no-replace-objects',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        '-C',
        root,
        // `core.worktree` in the repository config could point the checks
        // at another folder than the one that is pushed.
        ...(options.workTree ? [`--work-tree=${root}`] : []),
        ...args,
      ],
      {
        encoding: 'utf8',
        env: {
          ...gitEnv(),
          ...(options.indexFile ? { GIT_INDEX_FILE: options.indexFile } : {}),
        },
        input,
        maxBuffer: 64 * 1024 * 1024,
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
      }
    )
  } catch {
    return null
  }
}

/**
 * Untracked paths that cannot change the pushed code: the installed
 * dependencies (installed with `bun install --frozen-lockfile`), Next.js build
 * output, TypeScript build info and Finder metadata. Every other untracked
 * path, ignored or not, makes the checkout dirty.
 *
 * `node_modules` and `.next` are allowed at the top level only. The other
 * names are allowed only as regular files: a folder (or a link to one) named
 * `x.tsbuildinfo` or `.DS_Store` inside `convex/` would be bundled, because
 * the Convex CLI filters entry points by file name, not by folder name.
 */
export function isAllowedUntrackedPath(
  relative: string,
  root: string
): boolean {
  const trimmed = relative.replace(/\/$/, '')
  if (trimmed === 'node_modules' || trimmed === '.next') return true
  const base = path.posix.basename(trimmed)
  const fileName =
    trimmed === 'next-env.d.ts' ||
    base === '.DS_Store' ||
    base.endsWith('.tsbuildinfo')
  if (!fileName || relative.endsWith('/')) return false
  try {
    return fs.lstatSync(path.join(root, trimmed)).isFile()
  } catch {
    return false
  }
}

/**
 * Paths where the checkout differs from HEAD, read from the files themselves:
 * each tracked file is hashed without filters and compared with the HEAD tree,
 * so the index flags `assume-unchanged` and `skip-worktree`, an fsmonitor,
 * clean filters and exclude files cannot hide a change. Untracked paths are
 * listed without any exclude rule, against a fresh index read from HEAD, so a
 * file staged with `git add` but not committed counts as untracked. Replace
 * refs and `core.worktree` are ignored. Returns null when git cannot read it.
 */
export function checkoutChanges(root: string): string[] | null {
  const tree = git(
    root,
    ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'],
    undefined,
    {
      workTree: true,
    }
  )
  const others = untrackedAgainstHead(root)
  if (tree === null || others === null) return null
  const changes: string[] = []
  const regular: { path: string; sha: string }[] = []
  for (const entry of tree.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t')
    const [mode, , sha] = entry.slice(0, tab).split(' ')
    const file = entry.slice(tab + 1)
    if (
      (mode !== '100644' && mode !== '100755') ||
      !sha ||
      file.includes('\n')
    ) {
      changes.push(file)
      continue
    }
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(path.join(root, file))
    } catch {
      changes.push(file)
      continue
    }
    if (!stat.isFile()) changes.push(file)
    else regular.push({ path: file, sha })
  }
  if (regular.length > 0) {
    const hashes = git(
      root,
      ['hash-object', '--no-filters', '--stdin-paths'],
      `${regular.map((r) => r.path).join('\n')}\n`,
      { workTree: true }
    )
    if (hashes === null) return null
    const lines = hashes.split('\n').filter(Boolean)
    if (lines.length !== regular.length) return null
    regular.forEach((r, i) => {
      if (lines[i] !== r.sha) changes.push(r.path)
    })
  }
  for (const file of others.split('\0').filter(Boolean)) {
    if (!isAllowedUntrackedPath(file, root)) changes.push(file)
  }
  return changes.sort()
}

/**
 * Untracked paths relative to the HEAD commit, not to the repository's index:
 * a temporary index is read from HEAD, so staged files and index flags do not
 * matter. No exclude rule applies.
 */
function untrackedAgainstHead(root: string): string | null {
  let dir: string
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quilltip-window-index-'))
  } catch {
    return null
  }
  try {
    const indexFile = path.join(dir, 'index')
    const options = { workTree: true, indexFile }
    if (git(root, ['read-tree', 'HEAD'], undefined, options) === null) {
      return null
    }
    return git(
      root,
      ['ls-files', '--others', '--directory', '-z'],
      undefined,
      options
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function realpath(dir: string): string {
  try {
    return fs.realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

/** `.env*` files in `dirs` that assign the approval variable. */
export function envFilesAssigningApproval(dirs: readonly string[]): string[] {
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
        if (ASSIGNMENT.test(fs.readFileSync(file, 'utf8'))) hits.push(file)
      } catch {
        // Unreadable: Bun cannot load it either.
      }
    }
  }
  return hits
}

/** The repository that holds this file: the code a window run pushes. */
export const GUARD_CHECKOUT_ROOT = fileURLToPath(
  new URL('../..', import.meta.url)
)

/** Read the checkout state, the clock and the files. No network access. */
export function readLiveWindowFacts(
  env: EnvLike,
  options: { checkoutRoot?: string; cwd?: string; now?: Date } = {}
): LiveWindowFacts {
  const checkoutRoot = realpath(options.checkoutRoot ?? GUARD_CHECKOUT_ROOT)
  const cwd = options.cwd ?? process.cwd()
  const head = git(checkoutRoot, ['rev-parse', 'HEAD'])?.trim() || null
  const changes = checkoutChanges(checkoutRoot)
  const cwdTop = git(cwd, ['rev-parse', '--show-toplevel'])?.trim()
  const value = env[LIVE_WINDOW_APPROVAL_ENV]
  const committedHits = new Set<string>()
  const grep = (args: string[]) =>
    (git(checkoutRoot, ['grep', '-l', '-I', ...args]) ?? '')
      .split('\n')
      .filter(Boolean)
  if (value) grep(['-F', '-e', value]).forEach((f) => committedHits.add(f))
  grep(['-E', '-e', COMMITTED_ASSIGNMENT]).forEach((f) => committedHits.add(f))
  return {
    now: options.now ?? new Date(),
    head,
    dirty: changes === null ? null : changes.length > 0,
    ...(changes && changes.length > 0
      ? { dirtyPaths: changes.slice(0, 10) }
      : {}),
    checkoutRoot,
    cwdRoot: cwdTop ? realpath(cwdTop) : null,
    envFileHits: envFilesAssigningApproval([checkoutRoot, cwd]),
    committedHits: [...committedHits].sort(),
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Convex CLI target variables that must be unset in a window run. */
const OTHER_CLI_TARGETS = [
  'CONVEX_DEPLOYMENT',
  'CONVEX_DEPLOYMENT_TOKEN',
  'CONVEX_SELF_HOSTED_URL',
  'CONVEX_SELF_HOSTED_ADMIN_KEY',
  // Send the CLI's requests (and the deploy key) to another control plane,
  // or authenticate with another identity.
  'CONVEX_PROVISION_HOST',
  'CONVEX_OVERRIDE_ACCESS_TOKEN',
] as const

/**
 * Variables that load or resolve extra code in the Convex CLI (a Node
 * program) or in Bun, so the pushed bundle could differ from the approved
 * commit.
 */
const CODE_LOADING_ENV = ['NODE_OPTIONS', 'NODE_PATH', 'BUN_OPTIONS'] as const

function approvalRefusals(
  approval: LiveWindowApproval,
  facts: LiveWindowFacts
): NetworkGuardRefusal[] {
  const refusals: NetworkGuardRefusal[] = []
  // Only the built-in live list. QUILLTIP_PRODUCTION_CONVEX_DEPLOYMENTS adds
  // protection to more deployments; it must never open one to the window.
  if (!LIVE_CONVEX_DEPLOYMENTS.includes(approval.deployment)) {
    refusals.push(
      refusal(
        'LIVE_WINDOW_INVALID',
        `The approval names "${approval.deployment}", which is not a live deployment.`
      )
    )
  }
  const now = facts.now.getTime()
  if (now < approval.start.getTime()) {
    refusals.push(
      refusal(
        'LIVE_WINDOW_NOT_STARTED',
        `The window starts at ${approval.start.toISOString()}.`
      )
    )
  }
  if (now >= approval.end.getTime()) {
    refusals.push(
      refusal(
        'LIVE_WINDOW_EXPIRED',
        `The window ended at ${approval.end.toISOString()}.`
      )
    )
  }
  if (facts.head !== approval.commit) {
    refusals.push(
      refusal(
        'LIVE_WINDOW_COMMIT',
        `The checkout is at ${facts.head ?? 'an unknown commit'}, not the approved release commit ${approval.commit}.`
      )
    )
  }
  if (facts.dirty !== false) {
    refusals.push(
      refusal(
        'LIVE_WINDOW_DIRTY',
        facts.dirty === null
          ? 'The checkout state cannot be read.'
          : `The checkout has changes or untracked files${facts.dirtyPaths?.length ? ` (${facts.dirtyPaths.join(', ')})` : ''}. Use a clean checkout of the release commit.`
      )
    )
  }
  if (facts.cwdRoot !== facts.checkoutRoot) {
    refusals.push(
      refusal(
        'LIVE_WINDOW_DIRTY',
        `Run the command from the release checkout (${facts.checkoutRoot}).`
      )
    )
  }
  return refusals
}

function credentialRefusals(
  approval: LiveWindowApproval,
  env: EnvLike
): NetworkGuardRefusal[] {
  const refusals: NetworkGuardRefusal[] = []
  for (const name of OTHER_CLI_TARGETS) {
    if (env[name]?.trim()) {
      refusals.push(
        refusal(
          'LIVE_WINDOW_OTHER_TARGET',
          `${name} is set. A window run selects the deployment with CONVEX_DEPLOY_KEY only; unset ${name}.`
        )
      )
    }
  }
  for (const name of CODE_LOADING_ENV) {
    if (env[name]?.trim()) {
      refusals.push(
        refusal(
          'LIVE_WINDOW_DIRTY',
          `${name} is set. It can load code that is not in the release commit into the Convex CLI; unset ${name}.`
        )
      )
    }
  }
  const key = env.CONVEX_DEPLOY_KEY?.trim() ?? ''
  if (!key) {
    refusals.push(
      refusal(
        'LIVE_WINDOW_CREDENTIAL',
        `CONVEX_DEPLOY_KEY is not set. Use a development deploy key for ${approval.deployment}.`
      )
    )
  } else if (key.includes('|')) {
    const ref = parseConvexDeploymentRef(key)
    if (ref.type !== 'dev' || ref.name !== approval.deployment) {
      // Print the type and name only, never the key.
      refusals.push(
        refusal(
          'LIVE_WINDOW_CREDENTIAL',
          `CONVEX_DEPLOY_KEY is a "${ref.type ?? 'unknown'}" key for "${ref.name}". The window needs a development deploy key for ${approval.deployment}.`
        )
      )
    }
  }
  return refusals
}

export type LiveWindowDecision = {
  approval: LiveWindowApproval
  request: LiveWindowRequest | null
  guard: NetworkGuardResult
}

/**
 * Evaluate the window approval and, when `args` is given, the operation.
 * Throws NetworkGuardError with every refusal. `args` null is the dry check
 * of the approval alone.
 */
export type LiveWindowFiles = {
  exists?: (file: string) => boolean
  sha256?: (file: string) => string
}

/** Check an import against LIVE_WINDOW_RESTORE_ENV; returns the digest. */
function restoreRefusals(
  file: string,
  approval: LiveWindowApproval,
  env: EnvLike,
  digestOf: (file: string) => string
): { refusals: NetworkGuardRefusal[]; sha256?: string } {
  const value = env[LIVE_WINDOW_RESTORE_ENV]
  const refuse = (message: string) => ({
    refusals: [refusal('LIVE_WINDOW_RESTORE', message)],
  })
  if (!value) {
    return refuse(
      `import needs ${LIVE_WINDOW_RESTORE_ENV}=${LIVE_WINDOW_RESTORE_FORMAT} for the reviewed restore archive.`
    )
  }
  const match = RESTORE_PATTERN.exec(value)
  if (!match) {
    return refuse(
      `${LIVE_WINDOW_RESTORE_ENV} is not in the format ${LIVE_WINDOW_RESTORE_FORMAT}.`
    )
  }
  const [, deployment, expected] = match as unknown as [string, string, string]
  if (deployment !== approval.deployment) {
    return refuse(
      `${LIVE_WINDOW_RESTORE_ENV} names "${deployment}", not the window deployment ${approval.deployment}.`
    )
  }
  let actual: string
  try {
    actual = digestOf(file)
  } catch {
    return refuse('The restore archive cannot be read.')
  }
  if (actual !== expected) {
    return refuse(
      `The restore archive has SHA-256 ${actual}, not the approved ${expected}. Check that this is the reviewed file.`
    )
  }
  return { refusals: [], sha256: actual }
}

export function evaluateLiveWindow(
  args: readonly string[] | null,
  env: EnvLike,
  facts: LiveWindowFacts,
  files: LiveWindowFiles = {}
): LiveWindowDecision {
  const operation = `live window: ${describeLiveWindowArgs(args)}`
  const value = env[LIVE_WINDOW_APPROVAL_ENV]
  if (!value) {
    // No approval: the deploy guard refuses a live target exactly as before.
    assertScriptConvexDeployAllowed(operation, env)
    throw new NetworkGuardError(operation, [
      refusal(
        'LIVE_WINDOW_INVALID',
        `${LIVE_WINDOW_APPROVAL_ENV} is not set. This tool runs only in an approved maintenance window.`
      ),
    ])
  }

  const refusals: NetworkGuardRefusal[] = []
  if (facts.envFileHits.length > 0) {
    refusals.push(
      refusal(
        'LIVE_WINDOW_IN_FILE',
        `${LIVE_WINDOW_APPROVAL_ENV} is assigned in ${facts.envFileHits.join(', ')}. Set it in the shell only and remove it from the file.`
      )
    )
  }
  if (facts.committedHits.length > 0) {
    refusals.push(
      refusal(
        'LIVE_WINDOW_IN_FILE',
        `A committed file holds an approval value: ${facts.committedHits.join(', ')}.`
      )
    )
  }

  const parsed = parseLiveWindowApproval(value)
  if ('refusal' in parsed) {
    throw new NetworkGuardError(operation, [...refusals, parsed.refusal])
  }
  const { approval } = parsed
  refusals.push(...approvalRefusals(approval, facts))
  refusals.push(...credentialRefusals(approval, env))

  let request: LiveWindowRequest | null = null
  if (args) {
    const result = parseLiveWindowRequest(
      args,
      facts.checkoutRoot,
      files.exists
    )
    if ('refusals' in result) refusals.push(...result.refusals)
    else request = result.request
  }
  if (request?.operation === 'import' && request.file) {
    const restore = restoreRefusals(
      request.file,
      approval,
      env,
      files.sha256 ?? sha256File
    )
    refusals.push(...restore.refusals)
    if (restore.sha256) {
      request = {
        ...request,
        sha256: restore.sha256,
        detail: `${request.detail} sha256:${restore.sha256}`,
      }
    }
  }

  // Control 1 and control 2 as for any deploy-kind run, with the Stellar
  // checks on, so mainnet values in the shell are refused here too.
  let guard: NetworkGuardResult | null = null
  try {
    guard = assertTestnetOnly({
      operation,
      kind: 'deploy',
      ...convexInputs(env),
      ...stellarInputs(env),
      liveWindowDeployment: approval.deployment,
    })
  } catch (error) {
    if (!(error instanceof NetworkGuardError)) throw error
    refusals.push(...error.refusals)
  }
  if (
    guard &&
    (!guard.liveWindowApproved ||
      guard.convexDeployments.join(',') !== approval.deployment)
  ) {
    refusals.push(
      refusal(
        'LIVE_WINDOW_OTHER_TARGET',
        `The only Convex target must be ${approval.deployment}.`
      )
    )
  }
  if (refusals.length > 0 || !guard) {
    throw new NetworkGuardError(operation, refusals)
  }
  return { approval, request, guard }
}

// ---------------------------------------------------------------------------
// Warning and log
// ---------------------------------------------------------------------------

export function minutesLeft(approval: LiveWindowApproval, now: Date): number {
  return Math.max(
    0,
    Math.floor((approval.end.getTime() - now.getTime()) / 60_000)
  )
}

/** The warning printed before every window operation. */
export function liveWindowWarning(
  decision: LiveWindowDecision,
  now: Date
): string {
  const { approval, request } = decision
  return [
    '',
    '!!! LIVE DEPLOYMENT: APPROVED MAINTENANCE WINDOW !!!',
    `  Deployment: ${approval.deployment} (live)`,
    `  Commit:     ${approval.commit}`,
    `  Operation:  ${request?.detail ?? 'check'}`,
    `  Expires:    ${approval.end.toISOString()} (${minutesLeft(approval, now)} min left)`,
    '',
  ].join('\n')
}

export type LiveWindowLogEntry = {
  event: 'check' | 'allowed' | 'refused' | 'finished' | 'dashboard'
  operation: string
  deployment?: string
  commit?: string
  windowEnd?: string
  codes?: string[]
  exitCode?: number | null
  /** SHA-256 of the archive an export wrote or an import read. */
  sha256?: string
}

export function liveWindowLogPath(env: EnvLike, home = os.homedir()): string {
  const configured = env[LIVE_WINDOW_LOG_ENV]?.trim()
  return path.resolve(configured || path.join(home, LIVE_WINDOW_DEFAULT_LOG))
}

/** One JSON line. Built from named fields only, so no env value leaks in. */
export function formatLiveWindowLogLine(
  entry: LiveWindowLogEntry,
  now: Date
): string {
  return `${JSON.stringify({
    time: now.toISOString(),
    event: entry.event,
    operation: entry.operation,
    deployment: entry.deployment ?? null,
    commit: entry.commit ?? null,
    windowEnd: entry.windowEnd ?? null,
    codes: entry.codes ?? [],
    exitCode: entry.exitCode ?? null,
    sha256: entry.sha256 ?? null,
  })}\n`
}

/**
 * Append to the local log. Refuses a log path inside the checkout (it would
 * be committed) and fails closed when the line cannot be written.
 */
export function appendLiveWindowLog(
  entry: LiveWindowLogEntry,
  env: EnvLike,
  checkoutRoot: string,
  now: Date = new Date()
): string {
  const file = liveWindowLogPath(env)
  const resolvedRoot = realpath(checkoutRoot)
  const resolvedDir = realpath(path.dirname(file))
  if (isInside(resolvedRoot, path.join(resolvedDir, path.basename(file)))) {
    throw new NetworkGuardError('live window log', [
      refusal(
        'LIVE_WINDOW_LOG',
        `${LIVE_WINDOW_LOG_ENV} points inside the repository. Use a path outside it.`
      ),
    ])
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.appendFileSync(file, formatLiveWindowLogLine(entry, now), {
      mode: 0o600,
    })
  } catch {
    throw new NetworkGuardError('live window log', [
      refusal('LIVE_WINDOW_LOG', `Cannot write the window log at ${file}.`),
    ])
  }
  return file
}

/** Every deployment URL in Convex CLI output. */
export function convexUrlsInOutput(output: string): string[] {
  return [
    ...new Set(
      [...output.matchAll(/https:\/\/([a-z0-9-]+)\.convex\.cloud/g)].map(
        (m) => m[1] as string
      )
    ),
  ]
}
