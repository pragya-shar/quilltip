/**
 * Transaction lifecycle helpers (docs/architecture/v2/06-app-integration.md,
 * section 6.1): build, simulate, sign, send and poll. Each step returns a
 * typed outcome; RPC and the wallet are injected, so tests run offline.
 *
 * The client never decides confirmation. Polling only drives the UI; Convex
 * verifies the transaction and the indexer confirms it.
 */
import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  type Transaction,
  type xdr,
} from '@stellar/stellar-sdk'
import { bytesToHex } from '../bytes'
import { isWalletError, type WalletError } from './wallet-errors'
import { describeContractFailure, type V2ErrorInfo } from './errors'

export type RpcLike = Pick<
  rpc.Server,
  'getAccount' | 'prepareTransaction' | 'sendTransaction' | 'getTransaction'
>

export type ContractCall = {
  contractId: string
  method: string
  args: xdr.ScVal[]
  /** The signer's address; also the transaction source. */
  source: string
  /** Upper time bound, unix seconds. */
  maxTime: number
  networkPassphrase: string
}

export type TxDeps = {
  server: RpcLike
  /** Signs an envelope; throws a `WalletError` on refusal or timeout. */
  sign: (xdr: string) => Promise<string>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Called as each step starts, for progress copy. */
  onStep?: (step: TxStep) => void
}

export type TxStep = 'simulating' | 'signing' | 'sending'

export type TxOutcome =
  | { status: 'simulation_failed'; error: V2ErrorInfo; detail: string }
  | { status: 'wallet_failed'; error: WalletError }
  | { status: 'send_error'; error: V2ErrorInfo; detail: string }
  /** `sendTransaction` accepted it; the hash is recorded next. */
  | { status: 'sent'; hash: string }
  /** Every resend got TRY_AGAIN_LATER until the time bound. */
  | { status: 'not_sent'; detail: string }

export const RESEND_DELAY_MS = 2_000
export const MAX_RESENDS = 5
export const POLL_INTERVAL_MS = 2_000
/** The client polls until `maxTime + 30 s` at the latest. */
export const POLL_GRACE_SECONDS = 30

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Builds the invocation with fee `BASE_FEE` and time bounds `[0, maxTime]`. */
export async function buildCall(
  server: RpcLike,
  call: ContractCall
): Promise<Transaction> {
  const account = await server.getAccount(call.source)
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: call.networkPassphrase,
    timebounds: { minTime: 0, maxTime: call.maxTime },
  })
    .addOperation(new Contract(call.contractId).call(call.method, ...call.args))
    .build()
}

/**
 * Build, simulate, sign and send. Stops at the first failure; a simulation
 * failure is decoded to a contract error and nothing is submitted.
 */
export async function sendContractCall(
  deps: TxDeps,
  call: ContractCall
): Promise<TxOutcome> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? defaultSleep

  let prepared: Transaction
  deps.onStep?.('simulating')
  try {
    const tx = await buildCall(deps.server, call)
    prepared = (await deps.server.prepareTransaction(tx)) as Transaction
  } catch (error) {
    const detail = message(error)
    return {
      status: 'simulation_failed',
      error: describeContractFailure(detail),
      detail,
    }
  }

  let signedXdr: string
  deps.onStep?.('signing')
  try {
    signedXdr = await deps.sign(prepared.toXDR())
  } catch (error) {
    if (isWalletError(error)) return { status: 'wallet_failed', error }
    throw error
  }

  const signed = TransactionBuilder.fromXDR(
    signedXdr,
    call.networkPassphrase
  ) as Transaction
  const hash = bytesToHex(signed.hash())
  deps.onStep?.('sending')

  for (let attempt = 0; ; attempt++) {
    let result: rpc.Api.SendTransactionResponse
    try {
      result = await deps.server.sendTransaction(signed)
    } catch {
      // The envelope may have reached the network; report it as sent so the
      // hash is recorded and verification decides.
      return { status: 'sent', hash }
    }
    if (result.status === 'PENDING' || result.status === 'DUPLICATE') {
      return { status: 'sent', hash: result.hash || hash }
    }
    if (result.status === 'ERROR') {
      const resultName = result.errorResult?.result.type ?? 'ERROR'
      return {
        status: 'send_error',
        error: describeContractFailure(resultName),
        detail: resultName,
      }
    }
    // TRY_AGAIN_LATER: resend the same envelope, never after maxTime.
    if (
      attempt >= MAX_RESENDS ||
      now() + RESEND_DELAY_MS > call.maxTime * 1000
    ) {
      return { status: 'not_sent', detail: 'TRY_AGAIN_LATER' }
    }
    await sleep(RESEND_DELAY_MS)
  }
}

export type PollResult = 'SUCCESS' | 'FAILED' | 'TIMEOUT'

/** UI-only polling of `getTransaction` until a result or `maxTime + 30 s`. */
export async function pollTransaction(
  deps: Pick<TxDeps, 'server' | 'now' | 'sleep'>,
  hash: string,
  maxTime: number,
  signal?: AbortSignal
): Promise<PollResult> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? defaultSleep
  const deadline = (maxTime + POLL_GRACE_SECONDS) * 1000
  while (now() <= deadline && !signal?.aborted) {
    try {
      const res = await deps.server.getTransaction(hash)
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return 'SUCCESS'
      if (res.status === rpc.Api.GetTransactionStatus.FAILED) return 'FAILED'
    } catch {
      // Transient RPC errors: keep polling until the deadline.
    }
    await sleep(POLL_INTERVAL_MS)
  }
  return 'TIMEOUT'
}
