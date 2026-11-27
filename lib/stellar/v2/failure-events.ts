/**
 * Contract failures read from diagnostic events, for a transaction that
 * failed on chain. Its result XDR carries only `InvokeHostFunctionTrapped`;
 * the error code and the contract that raised it are in the diagnostic
 * events that `getTransaction` returns. Simulation failures go through
 * `describeContractFailure` with `raisingContract` (errors.ts).
 *
 * The raising contract is the one that emits the first `error` event with a
 * contract code. A contract that only passes the failure up emits later
 * ones: a native XLM shortfall under `Core.tip` shows the Stellar Asset
 * Contract's `#10`, then Core's `#10`, then the host's `host_fn_failed`.
 */
import { xdr } from '@stellar/stellar-sdk'

import {
  INSUFFICIENT_FEE_BALANCE,
  contractErrorMessage,
  contractKindOf,
  type KnownContracts,
  type V2ErrorInfo,
} from './errors'

type JsonEvent = {
  event?: {
    contract_id?: string | null
    body?: { v0?: { topics?: unknown[] } }
  }
}

/** An event as `toJSON()` gives it; base64 XDR strings are parsed first. */
function asJson(event: unknown): JsonEvent | null {
  let value: unknown = event
  if (typeof event === 'string') {
    try {
      value = xdr.DiagnosticEvent.fromXDR(event, 'base64')
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const withJson = value as { toJSON?: () => unknown }
  let json: unknown = value
  if (typeof withJson.toJSON === 'function') {
    try {
      json = withJson.toJSON()
    } catch {
      return null
    }
  }
  return json && typeof json === 'object' ? (json as JsonEvent) : null
}

export type ContractErrorEvent = {
  /** The raising contract's address; null for a host-level event. */
  contractId: string | null
  code: number
}

/**
 * The first diagnostic `error` event with a contract code, from
 * `DiagnosticEvent` objects, their JSON, or base64 XDR strings. The RPC
 * server may return no diagnostic events (`diagnosticEventsXdr` is then
 * undefined); the result is then null.
 */
export function contractErrorEvent(
  events: readonly unknown[] | null | undefined
): ContractErrorEvent | null {
  if (!Array.isArray(events)) return null
  for (const raw of events) {
    const json = asJson(raw)
    const topics = json?.event?.body?.v0?.topics
    if (!Array.isArray(topics) || topics.length < 2) continue
    const [first, second] = topics as Array<Record<string, unknown>>
    if (first?.symbol !== 'error') continue
    const code = (second?.error as { contract?: unknown } | undefined)?.contract
    if (typeof code !== 'number') continue
    return { contractId: json?.event?.contract_id ?? null, code }
  }
  return null
}

const GENERIC: V2ErrorInfo = contractErrorMessage(0, null)

/**
 * A user message for a transaction that failed on chain, from its
 * diagnostic events. Generic when there are no events, no event carries a
 * contract code, or the raising contract is not one of `contracts`.
 */
export function describeTransactionFailure(
  events: readonly unknown[] | null | undefined,
  contracts: KnownContracts
): V2ErrorInfo {
  const found = contractErrorEvent(events)
  if (!found) return { ...GENERIC, code: null }
  return contractErrorMessage(
    found.code,
    contractKindOf(found.contractId, contracts)
  )
}

/** Failures that more XLM in the wallet would fix. */
const NEEDS_XLM: ReadonlySet<string> = new Set([
  'BalanceError',
  'InsufficientAccountReserve',
  INSUFFICIENT_FEE_BALANCE,
])

/**
 * True for the "not enough XLM" state: the token contract's balance or
 * reserve error, or a fee the wallet cannot pay. Core's `#10`
 * (`DuplicateClientRef`) is not one of them.
 */
export function needsMoreXlm(info: V2ErrorInfo): boolean {
  if (info.name === INSUFFICIENT_FEE_BALANCE) return true
  return info.contract === 'token' && NEEDS_XLM.has(info.name ?? '')
}
