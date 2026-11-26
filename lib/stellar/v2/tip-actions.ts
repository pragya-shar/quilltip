/**
 * Runs one v2 tip end to end on the client
 * (docs/architecture/v2/05-flows-and-admin.md, sections 5.2 to 5.4;
 * 06-app-integration.md, section 6.1):
 * prepare (Convex) → local checks → build, simulate and sign (wallet) →
 * send → record the hash or the failure (Convex).
 *
 * This function never reports a tip as confirmed. After `sent`, the caller
 * follows `tipsV2.getTipStatus` until the server reports a final state. A
 * retry is a new call with a new `requestId`, and only after the server
 * says `canRetry`.
 */
import type { PreparedTip } from '@/convex/tipsV2'
import {
  viewFromTxOutcome,
  type TxOutcomeView,
} from '@/lib/payments/failures'
import type { V2ClientConfig } from './config'
import {
  TipCallError,
  checkPreparedTip,
  tipContractCall,
  type RequestedTipItem,
} from './tip-calls'
import { sendContractCall, type RpcLike, type TxStep } from './tx'
import { isWalletError, type WalletError } from './wallet-errors'

export type TipRunDeps = {
  config: Pick<
    V2ClientConfig,
    'passphrase' | 'coreContractId' | 'tokenContractId'
  >
  server: RpcLike
  /** What the reader asked for, in the order sent to prepare. */
  request: readonly RequestedTipItem[]
  /** `tipsV2.prepare*` with the given `requestId`. */
  prepare: (requestId: string) => Promise<PreparedTip>
  requestId: string
  /**
   * Makes the wallet ready to sign as `address` and returns the connected
   * address, or null when the reader closed the picker.
   */
  connect: (address: string) => Promise<string | null>
  sign: (xdr: string, address: string) => Promise<string>
  recordSubmitted: (submissionId: string, txHash: string) => Promise<void>
  recordSendFailed: (
    submissionId: string,
    reason: 'simulation_failed' | 'send_error' | 'wallet_rejected',
    detail?: string
  ) => Promise<void>
  /** The record exists; the flow keeps its ID so a reload can resume. */
  onPrepared?: (prepared: PreparedTip) => void
  onStep?: (step: TxStep) => void
  /** The envelope was accepted; called before the hash is recorded. */
  onSent?: (submissionId: string, txHash: string) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export type TipRunResult =
  /** Prepare threw; nothing was created. `error` is the thrown value. */
  | { kind: 'prepare_failed'; error: unknown }
  /**
   * A record exists but the client stopped before sending it. `view` says
   * what to show; the failure has been recorded where the server allows it.
   */
  | {
      kind: 'stopped'
      prepared: PreparedTip
      view: TxOutcomeView
    }
  /** The local checks refused the prepared values; recorded as refused. */
  | { kind: 'check_failed'; prepared: PreparedTip; message: string }
  /** The connected wallet is not the tipper's linked address. */
  | {
      kind: 'wrong_account'
      prepared: PreparedTip
      expected: string
      actual: string
    }
  /**
   * The record was already past `PREPARED` (a replayed `requestId`), or the
   * transaction may have landed: follow the record, do not send again.
   */
  | { kind: 'tracking'; prepared: PreparedTip }
  | {
      kind: 'sent'
      prepared: PreparedTip
      txHash: string
      /** False when `recordSubmitted` failed; the indexer still confirms it. */
      recorded: boolean
    }

/** Core `DuplicateClientRef`: this reference already paid; never mark FAILED. */
const DUPLICATE_REF = 'DuplicateClientRef'

async function prepareOnce(deps: TipRunDeps): Promise<PreparedTip> {
  try {
    return await deps.prepare(deps.requestId)
  } catch (error) {
    // A server refusal is final. A lost response is retried once with the
    // same requestId: the server returns the same record (section 6.1).
    if ((error as { name?: string })?.name === 'ConvexError') throw error
    const sleep =
      deps.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    await sleep(1_000)
    return deps.prepare(deps.requestId)
  }
}

export async function runTip(deps: TipRunDeps): Promise<TipRunResult> {
  let prepared: PreparedTip
  try {
    prepared = await prepareOnce(deps)
  } catch (error) {
    return { kind: 'prepare_failed', error }
  }
  deps.onPrepared?.(prepared)
  const submissionId = prepared.submissionId as string

  // A replayed requestId may return a record that was already sent or has
  // a result. Follow it; never sign it a second time.
  if (prepared.status !== 'PREPARED') return { kind: 'tracking', prepared }

  const recordFailure = async (
    reason: 'simulation_failed' | 'send_error' | 'wallet_rejected',
    detail?: string
  ) => {
    // Best effort: an unrecorded failure expires after the time bound.
    await deps
      .recordSendFailed(submissionId, reason, detail)
      .catch(() => undefined)
  }

  try {
    checkPreparedTip(prepared, {
      networkPassphrase: deps.config.passphrase,
      coreContractId: deps.config.coreContractId,
      tokenContractId: deps.config.tokenContractId,
      items: deps.request,
      now: (deps.now ?? Date.now)(),
    })
  } catch (error) {
    const message =
      error instanceof TipCallError ? error.message : 'Nothing was signed.'
    await recordFailure('wallet_rejected', 'client_check')
    return { kind: 'check_failed', prepared, message }
  }

  let address: string | null
  try {
    address = await deps.connect(prepared.tipperAddress)
  } catch (error) {
    if (!isWalletError(error)) throw error
    return stopped(prepared, error, recordFailure)
  }
  if (!address) {
    await recordFailure('wallet_rejected', 'cancelled')
    return {
      kind: 'stopped',
      prepared,
      view: { show: { kind: 'cancelled' }, record: null },
    }
  }
  if (address !== prepared.tipperAddress) {
    await recordFailure('wallet_rejected', 'wrong_account')
    return {
      kind: 'wrong_account',
      prepared,
      expected: prepared.tipperAddress,
      actual: address,
    }
  }

  const call = tipContractCall(prepared)
  const outcome = await sendContractCall(
    {
      server: deps.server,
      sign: (xdr) => deps.sign(xdr, prepared.tipperAddress),
      onStep: deps.onStep,
      now: deps.now,
      sleep: deps.sleep,
      contracts: {
        core: deps.config.coreContractId,
        token: deps.config.tokenContractId,
      },
    },
    call
  )

  if (outcome.status === 'sent') {
    deps.onSent?.(submissionId, outcome.hash)
    let recorded = true
    try {
      await deps.recordSubmitted(submissionId, outcome.hash)
    } catch {
      // The indexer still links the event by client_ref (rule (b)), and a
      // reload records the stored hash again.
      recorded = false
    }
    return { kind: 'sent', prepared, txHash: outcome.hash, recorded }
  }

  if (
    outcome.status === 'simulation_failed' &&
    outcome.error.contract === 'core' &&
    outcome.error.name === DUPLICATE_REF
  ) {
    // This client_ref already paid on chain: an earlier send landed.
    return { kind: 'tracking', prepared }
  }

  const view = viewFromTxOutcome(outcome, {
    batch: prepared.items.length > 1,
  })
  if (view.record) await recordFailure(view.record.reason, view.record.detail)
  return { kind: 'stopped', prepared, view }
}

async function stopped(
  prepared: PreparedTip,
  error: WalletError,
  recordFailure: (
    reason: 'wallet_rejected',
    detail?: string
  ) => Promise<void>
): Promise<TipRunResult> {
  const view = viewFromTxOutcome({ status: 'wallet_failed', error })
  await recordFailure('wallet_rejected', error.kind)
  return { kind: 'stopped', prepared, view }
}
