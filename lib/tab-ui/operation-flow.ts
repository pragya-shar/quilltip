/**
 * One wallet-signed tab operation (open, top-up, new key, revoke, close,
 * withdraw, collect), end to end on the client: prepare in Convex where the
 * operation has a prepare, check the prepared values against the client's
 * own configuration, then build, simulate, sign and send
 * (06-app-integration.md, section 6.1), and poll for the UI only.
 *
 * Tab operations have no server record. The indexed tab state confirms each
 * one (`phaseFromTabOperation` in lib/payments/ui-state.ts); this function
 * never reports confirmation.
 */
import type { PollResult, TxOutcome, TxStep } from '@/lib/stellar/v2/tx'
import { convexErrorCode } from './tip-flow'
import type { OperationContext, TabCall, TabCallRequest } from './types'

/** Every user transaction gets `maxTime = now + 300 s` (spec 6.1, step 1). */
export const OPERATION_TTL_SECONDS = 300

export type OperationStep = 'preparing' | TxStep

export type OperationResult =
  /** Convex refused before anything was built. Nothing was signed. */
  | { kind: 'refused'; code: string; message: string | null }
  /** Convex could not be reached. Nothing was signed. */
  | { kind: 'unreachable' }
  /** The prepared values do not match this client's configuration. */
  | { kind: 'mismatch'; field: 'network' | 'contract' | 'address' }
  /** `sendContractCall` stopped before sending: show it, nothing moved. */
  | { kind: 'not-sent'; outcome: Exclude<TxOutcome, { status: 'sent' }> }
  /** Sent. `poll` is the UI-only result; the indexed state confirms. */
  | { kind: 'sent'; hash: string; maxTime: number; poll: PollResult }

export type OperationDeps = {
  /** The Convex prepare, or null for `claim`, which has none. */
  prepare: (() => Promise<OperationContext>) | null
  call: TabCall
  /** This client's configuration; the prepare must match it. */
  expected: {
    networkPassphrase: string
    tabContractId: string
    /** The signer: the connected, verified address. */
    address: string
  }
  send(
    request: TabCallRequest,
    onStep: (step: TxStep) => void
  ): Promise<TxOutcome>
  poll(hash: string, maxTime: number): Promise<PollResult>
  nowSeconds(): number
  onStep?(step: OperationStep): void
  /** Called once the transaction was accepted for sending. */
  onSent?(hash: string, maxTime: number): void
}

export async function runTabOperation(
  deps: OperationDeps
): Promise<OperationResult> {
  deps.onStep?.('preparing')
  if (deps.prepare) {
    let context: OperationContext
    try {
      context = await deps.prepare()
    } catch (error) {
      const refusal = convexErrorCode(error)
      return refusal ? { kind: 'refused', ...refusal } : { kind: 'unreachable' }
    }
    if (context.networkPassphrase !== deps.expected.networkPassphrase) {
      return { kind: 'mismatch', field: 'network' }
    }
    if (context.tabContractId !== deps.expected.tabContractId) {
      return { kind: 'mismatch', field: 'contract' }
    }
    if (context.readerAddress !== deps.expected.address) {
      return { kind: 'mismatch', field: 'address' }
    }
  }
  const maxTime = deps.nowSeconds() + OPERATION_TTL_SECONDS
  const outcome = await deps.send(
    {
      call: deps.call,
      source: deps.expected.address,
      tabContractId: deps.expected.tabContractId,
      networkPassphrase: deps.expected.networkPassphrase,
      maxTime,
    },
    (step) => deps.onStep?.(step)
  )
  if (outcome.status !== 'sent') return { kind: 'not-sent', outcome }
  deps.onSent?.(outcome.hash, maxTime)
  const poll = await deps.poll(outcome.hash, maxTime)
  return { kind: 'sent', hash: outcome.hash, maxTime, poll }
}
