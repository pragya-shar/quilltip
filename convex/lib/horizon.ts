/**
 * Pure Horizon verification client. Takes an injected fetch so it can be unit
 * tested without network access, and so the calling action decides its own
 * retry policy.
 *
 * Verifies, end-to-end, that a Stellar transaction is a legitimate invocation
 * of the tipping contract with the expected tipper, author, and amount:
 *   1. Tx exists on Horizon.
 *   2. Network reports it as successful.
 *   3. Source account matches the tipper's stored Stellar pubkey.
 *   4. A ledger number is present (tx was included, not just queued).
 *   5. First operation is an invoke_host_function calling the configured
 *      tipping contract with one of the allowed tip functions.
 *   6. The on-chain tipper, author, and amount arguments match what the tip
 *      record claims. This is what prevents a user from submitting someone
 *      else's tx, or paying themselves 0.01 XLM and claiming a $100 tip.
 */

import { Address, xdr, scValToNative } from '@stellar/stellar-sdk'

export type HorizonVerifyReason =
  | 'unsuccessful'
  | 'source_mismatch'
  | 'not_in_ledger'
  | 'malformed_response'
  | 'not_soroban'
  | 'contract_mismatch'
  | 'function_mismatch'
  | 'tipper_mismatch'
  | 'author_mismatch'
  | 'amount_mismatch'

export type HorizonVerifyResult =
  | { ok: true; ledger: number; onChainStroops: bigint | null }
  | { ok: false; kind: 'permanent'; reason: HorizonVerifyReason }
  | {
      ok: false
      kind: 'transient'
      reason: 'not_found' | 'network_error' | 'server_error'
    }

export type TipInvocationExpectations = {
  contractId: string
  allowedFunctions: readonly string[]
  authorAddress: string
  minStroops: bigint
}

type MinimalFetch = (
  input: string,
  init?: { headers?: Record<string, string> }
) => Promise<MinimalResponse>

type MinimalResponse = {
  status: number
  ok: boolean
  json: () => Promise<unknown>
}

export async function verifyTipTransaction(
  fetchImpl: MinimalFetch,
  args: {
    txId: string
    expectedSource: string
    horizonUrl: string
    invocation?: TipInvocationExpectations
  }
): Promise<HorizonVerifyResult> {
  const base = args.horizonUrl.replace(/\/$/, '')
  const url = `${base}/transactions/${encodeURIComponent(args.txId)}`

  let response: MinimalResponse
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
    })
  } catch {
    return { ok: false, kind: 'transient', reason: 'network_error' }
  }

  if (response.status === 404) {
    return { ok: false, kind: 'transient', reason: 'not_found' }
  }
  if (response.status >= 500) {
    return { ok: false, kind: 'transient', reason: 'server_error' }
  }
  if (!response.ok) {
    return { ok: false, kind: 'permanent', reason: 'malformed_response' }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, kind: 'permanent', reason: 'malformed_response' }
  }

  if (!isHorizonTxResponse(body)) {
    return { ok: false, kind: 'permanent', reason: 'malformed_response' }
  }
  if (!body.successful) {
    return { ok: false, kind: 'permanent', reason: 'unsuccessful' }
  }
  if (body.source_account !== args.expectedSource) {
    return { ok: false, kind: 'permanent', reason: 'source_mismatch' }
  }
  if (typeof body.ledger !== 'number') {
    return { ok: false, kind: 'permanent', reason: 'not_in_ledger' }
  }

  if (!args.invocation) {
    return { ok: true, ledger: body.ledger, onChainStroops: null }
  }

  if (typeof body.envelope_xdr !== 'string') {
    return { ok: false, kind: 'permanent', reason: 'malformed_response' }
  }

  const invocationResult = verifyInvocation(body.envelope_xdr, {
    expectedSource: args.expectedSource,
    invocation: args.invocation,
  })
  if (invocationResult.kind !== 'ok') {
    return { ok: false, kind: 'permanent', reason: invocationResult.reason }
  }

  return {
    ok: true,
    ledger: body.ledger,
    onChainStroops: invocationResult.onChainStroops,
  }
}

type InvocationOk = { kind: 'ok'; onChainStroops: bigint }
type InvocationFail = { kind: 'fail'; reason: HorizonVerifyReason }

function verifyInvocation(
  envelopeXdr: string,
  args: {
    expectedSource: string
    invocation: TipInvocationExpectations
  }
): InvocationOk | InvocationFail {
  let tx: xdr.Transaction
  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(envelopeXdr, 'base64')
    const inner = extractInnerTransaction(envelope)
    if (!inner) return { kind: 'fail', reason: 'malformed_response' }
    tx = inner
  } catch {
    return { kind: 'fail', reason: 'malformed_response' }
  }

  const ops = tx.operations()
  if (ops.length === 0) return { kind: 'fail', reason: 'not_soroban' }

  const op = ops[0]
  if (!op) return { kind: 'fail', reason: 'not_soroban' }
  const opBody = op.body()
  if (opBody.switch() !== xdr.OperationType.invokeHostFunction()) {
    return { kind: 'fail', reason: 'not_soroban' }
  }

  const hf = opBody.invokeHostFunctionOp().hostFunction()
  if (hf.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    return { kind: 'fail', reason: 'not_soroban' }
  }

  const ic = hf.invokeContract()
  const addr = ic.contractAddress()
  if (addr.switch() !== xdr.ScAddressType.scAddressTypeContract()) {
    return { kind: 'fail', reason: 'contract_mismatch' }
  }

  let contractId: string
  try {
    contractId = Address.fromScAddress(addr).toString()
  } catch {
    return { kind: 'fail', reason: 'malformed_response' }
  }
  if (contractId !== args.invocation.contractId) {
    return { kind: 'fail', reason: 'contract_mismatch' }
  }

  const fnName = ic.functionName().toString()
  if (!args.invocation.allowedFunctions.includes(fnName)) {
    return { kind: 'fail', reason: 'function_mismatch' }
  }

  const fnArgs = ic.args()
  const isHighlightFn =
    fnName === 'tip_highlight_direct' || fnName === 'tip_highlight_with_arweave'
  const tipperIdx = 0
  const authorIdx = isHighlightFn ? 3 : 2
  const amountIdx = isHighlightFn ? 4 : 3

  if (fnArgs.length <= amountIdx) {
    return { kind: 'fail', reason: 'malformed_response' }
  }

  const tipperArg = fnArgs[tipperIdx]
  const authorArg = fnArgs[authorIdx]
  const amountArg = fnArgs[amountIdx]
  if (!tipperArg || !authorArg || !amountArg) {
    return { kind: 'fail', reason: 'malformed_response' }
  }

  let nativeTipper: unknown
  let nativeAuthor: unknown
  let nativeAmount: unknown
  try {
    nativeTipper = scValToNative(tipperArg)
    nativeAuthor = scValToNative(authorArg)
    nativeAmount = scValToNative(amountArg)
  } catch {
    return { kind: 'fail', reason: 'malformed_response' }
  }

  if (typeof nativeTipper !== 'string' || typeof nativeAuthor !== 'string') {
    return { kind: 'fail', reason: 'malformed_response' }
  }
  if (typeof nativeAmount !== 'bigint') {
    return { kind: 'fail', reason: 'malformed_response' }
  }

  if (nativeTipper !== args.expectedSource) {
    return { kind: 'fail', reason: 'tipper_mismatch' }
  }
  if (nativeAuthor !== args.invocation.authorAddress) {
    return { kind: 'fail', reason: 'author_mismatch' }
  }
  if (nativeAmount < args.invocation.minStroops) {
    return { kind: 'fail', reason: 'amount_mismatch' }
  }

  return { kind: 'ok', onChainStroops: nativeAmount }
}

function extractInnerTransaction(
  envelope: xdr.TransactionEnvelope
): xdr.Transaction | null {
  const kind = envelope.switch()
  if (kind === xdr.EnvelopeType.envelopeTypeTx()) {
    return envelope.v1().tx()
  }
  if (kind === xdr.EnvelopeType.envelopeTypeTxFeeBump()) {
    const inner = envelope.feeBump().tx().innerTx()
    if (inner.switch() === xdr.EnvelopeType.envelopeTypeTx()) {
      return inner.v1().tx()
    }
  }
  return null
}

type HorizonTxResponse = {
  successful: boolean
  source_account: string
  ledger: number
  envelope_xdr?: string
}

function isHorizonTxResponse(value: unknown): value is HorizonTxResponse {
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  return (
    typeof o.successful === 'boolean' && typeof o.source_account === 'string'
  )
}
