/**
 * Guarded access to the Stellar network for the v2 deployment tool.
 *
 * - Every CLI call goes through scripts/lib/stellar-cli.ts with the
 *   Stellar-only guard, so the network, RPC URL and passphrase are always
 *   explicit and mainnet is always refused.
 * - Before every submission, `confirmNetwork` asks the RPC server for its
 *   passphrase and refuses unless it is the guarded one (testnet, or the local
 *   standalone network). A testnet-looking URL that serves another network
 *   is caught here.
 */
import { spawnSync } from 'child_process'
import { xdr } from '@stellar/stellar-sdk'

import { NetworkGuardError } from '../../lib/network-guard'
import { buildStellarCliCommand, runStellarCli } from '../../lib/stellar-cli'
import { resolveScriptStellarOnlyNetwork } from '../../lib/network-guard'

export const OPERATION = 'deploy-v2-testnet'

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
export const LOCAL_PASSPHRASE = 'Standalone Network ; February 2017'
const MAINNET_PASSPHRASE =
  'Public Global Stellar Network ; September 2015'.toLowerCase()

type EnvLike = Record<string, string | undefined>

export type DeployNetwork = {
  network: 'TESTNET' | 'LOCAL'
  passphrase: string
  rpcUrl: string
  /** stellar.expert segment, or null on a local network. */
  explorer: 'testnet' | null
}

/** Runs the Stellar-only guard and returns the network to use. */
export function resolveDeployNetwork(
  env: EnvLike = process.env
): DeployNetwork {
  const resolved = resolveScriptStellarOnlyNetwork(OPERATION, env)
  const network = resolved.guard.network
  const expected = network === 'LOCAL' ? LOCAL_PASSPHRASE : TESTNET_PASSPHRASE
  if (resolved.passphrase !== expected) {
    throw new NetworkGuardError(OPERATION, [
      {
        code: 'UNKNOWN_PASSPHRASE',
        message: `The resolved passphrase is not "${expected}".`,
      },
    ])
  }
  return {
    network,
    passphrase: resolved.passphrase,
    rpcUrl: resolved.rpcUrl,
    explorer: network === 'TESTNET' ? 'testnet' : null,
  }
}

type RpcFetch = (url: string, init: RequestInit) => Promise<Response>

async function rpc<T>(
  net: DeployNetwork,
  method: string,
  params: unknown,
  fetcher: RpcFetch = fetch
): Promise<T> {
  const response = await fetcher(net.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = (await response.json()) as {
    result?: T
    error?: { message: string }
  }
  if (body.error || body.result === undefined) {
    throw new Error(
      `${method} failed: ${body.error?.message ?? response.status}`
    )
  }
  return body.result
}

/**
 * Asks the RPC server which network it serves. Refuses the mainnet
 * passphrase in any spelling, and any passphrase other than the guarded one.
 */
export async function confirmNetwork(
  net: DeployNetwork,
  fetcher: RpcFetch = fetch
): Promise<void> {
  const { passphrase } = await rpc<{ passphrase: string }>(
    net,
    'getNetwork',
    {},
    fetcher
  )
  const loose = passphrase.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (loose.toLowerCase() === MAINNET_PASSPHRASE) {
    throw new NetworkGuardError(OPERATION, [
      {
        code: 'MAINNET_PASSPHRASE',
        message: `${net.rpcUrl} serves Stellar mainnet. Nothing was submitted.`,
      },
    ])
  }
  if (passphrase !== net.passphrase) {
    throw new NetworkGuardError(OPERATION, [
      {
        code: 'UNKNOWN_PASSPHRASE',
        message: `${net.rpcUrl} serves "${passphrase}", not "${net.passphrase}". Nothing was submitted.`,
      },
    ])
  }
}

export async function latestLedger(net: DeployNetwork): Promise<number> {
  const result = await rpc<{ sequence: number }>(net, 'getLatestLedger', {})
  return result.sequence
}

export type TxRecord = {
  hash: string
  ledger: number
  /** Fee charged, in stroops. */
  feeCharged: string
}

/** Status, ledger and charged fee of a submitted transaction. */
export async function transactionRecord(
  net: DeployNetwork,
  hash: string
): Promise<TxRecord> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const tx = await rpc<{
      status: string
      ledger?: number
      resultXdr?: string
    }>(net, 'getTransaction', { hash })
    if (tx.status === 'SUCCESS' && tx.resultXdr && tx.ledger) {
      const result = xdr.TransactionResult.fromXDR(tx.resultXdr, 'base64')
      return {
        hash,
        ledger: tx.ledger,
        feeCharged: String(result.feeCharged),
      }
    }
    if (tx.status === 'FAILED') throw new Error(`Transaction ${hash} failed`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Transaction ${hash} was not found`)
}

export type CliResult = { stdout: string; txHash: string | null }

/** Arguments the CLI needs to find identities in the set's key directory. */
export type CliContext = { net: DeployNetwork; configDir: string; env: EnvLike }

const SIGNING_LINE = /Signing transaction: ([0-9a-f]{64})/

/** Builds the guarded command without running it (tests and dry runs). */
export function cliCommand(ctx: CliContext, args: string[]) {
  return buildStellarCliCommand(
    OPERATION,
    withConfigDir(args, ctx.configDir),
    ctx.env,
    'stellar-only'
  )
}

function withConfigDir(args: string[], configDir: string): string[] {
  const end = args.indexOf('--')
  const options = end === -1 ? args : args.slice(0, end)
  const rest = end === -1 ? [] : args.slice(end)
  return [...options, '--config-dir', configDir, ...rest]
}

/**
 * Runs a guarded CLI command. Output is returned, never printed, so a command
 * that shows a secret (`keys show`) cannot leak it into logs.
 */
export function cli(ctx: CliContext, args: string[]): CliResult {
  const result = runStellarCli(OPERATION, withConfigDir(args, ctx.configDir), {
    env: ctx.env,
    scope: 'stellar-only',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').split('\n').slice(-6).join('\n')
    throw new Error(`stellar ${args.slice(0, 2).join(' ')} failed:\n${stderr}`)
  }
  const txHash = (result.stderr ?? '').match(SIGNING_LINE)?.[1] ?? null
  return { stdout: (result.stdout ?? '').trim(), txHash }
}

/** Key subcommands that read the local key store and never use a network. */
const OFFLINE_KEY_COMMANDS = new Set(['address', 'show'])

/**
 * Runs `stellar keys address|show` against the set's config directory. These
 * subcommands take no network flags and contact no server. Output is returned,
 * never printed.
 */
export function cliOffline(ctx: CliContext, args: string[]): string {
  if (args[0] !== 'keys' || !OFFLINE_KEY_COMMANDS.has(args[1] ?? '')) {
    throw new Error(
      `stellar ${args.slice(0, 2).join(' ')} is not an offline key command`
    )
  }
  const result = spawnSync(
    'stellar',
    [...args, '--config-dir', ctx.configDir],
    {
      encoding: 'utf8',
      env: { ...ctx.env, NO_COLOR: '1' } as unknown as NodeJS.ProcessEnv,
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`stellar ${args.slice(0, 2).join(' ')} failed`)
  return (result.stdout ?? '').trim()
}

/**
 * Submits a transaction through the CLI after confirming the RPC network, and
 * returns its record.
 */
export async function submit(
  ctx: CliContext,
  args: string[]
): Promise<CliResult & { tx: TxRecord }> {
  await confirmNetwork(ctx.net)
  const result = cli(ctx, args)
  if (!result.txHash) {
    throw new Error(
      `stellar ${args.slice(0, 2).join(' ')} reported no transaction`
    )
  }
  return { ...result, tx: await transactionRecord(ctx.net, result.txHash) }
}

/**
 * Like `submit`, for commands the CLI may finish without a transaction
 * (`contract upload` of a Wasm that is already installed). Returns `tx: null`
 * in that case.
 */
export async function submitIfNeeded(
  ctx: CliContext,
  args: string[]
): Promise<CliResult & { tx: TxRecord | null }> {
  await confirmNetwork(ctx.net)
  const result = cli(ctx, args)
  return {
    ...result,
    tx: result.txHash ? await transactionRecord(ctx.net, result.txHash) : null,
  }
}

/** Simulates a contract call (no submission) and parses its JSON result. */
export function view<T = unknown>(
  ctx: CliContext,
  contractId: string,
  source: string,
  fn: string,
  args: string[] = []
): T {
  const { stdout } = cli(ctx, [
    'contract',
    'invoke',
    '--id',
    contractId,
    '--source',
    source,
    '--send=no',
    '--',
    fn,
    ...args,
  ])
  return (stdout === '' ? null : JSON.parse(stdout)) as T
}

export function explorerTx(net: DeployNetwork, hash: string): string | null {
  return net.explorer
    ? `https://stellar.expert/explorer/${net.explorer}/tx/${hash}`
    : null
}

export function explorerContract(
  net: DeployNetwork,
  id: string
): string | null {
  return net.explorer
    ? `https://stellar.expert/explorer/${net.explorer}/contract/${id}`
    : null
}
