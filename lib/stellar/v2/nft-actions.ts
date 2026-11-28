/**
 * Runs a prepared article NFT mint or transfer on the client
 * (docs/architecture/v2/05-flows-and-admin.md, section 5.10):
 * local checks → connect → build, simulate and sign (wallet) → send →
 * record the hash (Convex). Convex verification and the indexer decide the
 * outcome; the UI follows `nftsV2.getNftSubmissionStatus`. This function
 * never reports confirmation or ownership.
 *
 * Prepare runs before this, in the flow: a transfer shows the server's
 * prepared recipient for the user to confirm before anything is signed.
 *
 * Every failure before the transaction is sent is recorded on the
 * submission (`recordSendFailed`), so the record turns `FAILED` and the
 * server allows a new request at once.
 */
import {
  checkPreparedNftCall,
  nftContractCall,
  NftCallError,
  type NftCallExpectation,
  type PreparedNftCall,
} from './nft-calls'
import type { KnownContracts } from './errors'
import {
  sendContractCall,
  type RpcLike,
  type TxOutcome,
  type TxStep,
} from './tx'
import { WalletError, isWalletError } from './wallet-errors'

export type NftRecordReason =
  | 'simulation_failed'
  | 'send_error'
  | 'wallet_rejected'

export type NftRunPhase = 'connecting' | TxStep | 'recording'

export type NftRunResult =
  /** The local check refused the prepared call. Nothing was signed. */
  | { status: 'check_failed'; check: NftCallError['check']; message: string }
  /**
   * The wallet is on another account than the one that must sign (the
   * linked address). Found before any signature: nothing was signed.
   */
  | { status: 'wrong_account'; expected: string; connected: string }
  | TxOutcome

export type NftRunDeps = {
  prepared: PreparedNftCall
  expected: NftCallExpectation
  server: RpcLike
  /** This deployment's contracts, to decode a simulation error by its origin. */
  contracts?: KnownContracts
  /**
   * Makes the wallet ready to sign as `signer` and returns its address, or
   * null when the user closed the picker. Throws a `WalletError`.
   */
  connect: (signer: string) => Promise<string | null>
  sign: (xdr: string, signer: string) => Promise<string>
  recordSubmitted: (submissionId: string, txHash: string) => Promise<void>
  recordFailed: (
    submissionId: string,
    reason: NftRecordReason,
    detail?: string
  ) => Promise<void>
  onPhase?: (phase: NftRunPhase) => void
}

/**
 * What to send to `recordSendFailed` for a result, or null for `sent`.
 * The same mapping as the payment kit (`viewFromTxOutcome`): `detail` is a
 * short code, never wallet text.
 */
export function recordFor(
  result: NftRunResult
): { reason: NftRecordReason; detail?: string } | null {
  switch (result.status) {
    case 'sent':
      return null
    case 'check_failed':
      return { reason: 'wallet_rejected', detail: 'client_check' }
    case 'wrong_account':
      return { reason: 'wallet_rejected', detail: 'wrong_account' }
    case 'wallet_failed':
      return { reason: 'wallet_rejected', detail: result.error.kind }
    case 'simulation_failed':
      return {
        reason: 'simulation_failed',
        ...(result.error.name ? { detail: result.error.name } : {}),
      }
    case 'send_error':
      return {
        reason: 'send_error',
        ...(result.error.name ? { detail: result.error.name } : {}),
      }
    case 'not_sent':
      return { reason: 'send_error', detail: 'TRY_AGAIN_LATER' }
  }
}

export async function runNftCall(deps: NftRunDeps): Promise<NftRunResult> {
  const { prepared } = deps
  const finish = async (result: NftRunResult): Promise<NftRunResult> => {
    const record = recordFor(result)
    if (result.status === 'sent') {
      deps.onPhase?.('recording')
      try {
        await deps.recordSubmitted(prepared.submissionId, result.hash)
      } catch {
        // The indexer still confirms it from the event (rule (b)).
      }
    } else if (record) {
      // Best effort: an unrecorded failure expires after the time bound.
      await deps
        .recordFailed(prepared.submissionId, record.reason, record.detail)
        .catch(() => {})
    }
    return result
  }

  try {
    checkPreparedNftCall(prepared, deps.expected)
  } catch (error) {
    if (error instanceof NftCallError) {
      return finish({
        status: 'check_failed',
        check: error.check,
        message: error.message,
      })
    }
    throw error
  }

  deps.onPhase?.('connecting')
  let address: string | null
  try {
    address = await deps.connect(prepared.signer)
  } catch (error) {
    if (isWalletError(error)) {
      return finish({ status: 'wallet_failed', error })
    }
    return finish({
      status: 'wallet_failed',
      error: new WalletError('failed', 'connect_failed'),
    })
  }
  if (!address) {
    return finish({
      status: 'wallet_failed',
      error: new WalletError('cancelled', 'picker_closed'),
    })
  }
  if (address !== prepared.signer) {
    return finish({
      status: 'wrong_account',
      expected: prepared.signer,
      connected: address,
    })
  }

  const outcome = await sendContractCall(
    {
      server: deps.server,
      contracts: deps.contracts,
      sign: (xdr) => deps.sign(xdr, prepared.signer),
      onStep: deps.onPhase,
    },
    nftContractCall(prepared)
  )
  return finish(outcome)
}
