/**
 * Pure Horizon verification client. Takes an injected fetch so it can be unit
 * tested without network access, and so the calling action decides its own
 * retry policy.
 *
 * Phase 1 checks (what a server-side verifier can cheaply prove today):
 *   1. The tx exists on Horizon.
 *   2. The network reports it as successful.
 *   3. The source account matches the tipper's stored Stellar pubkey.
 *   4. A ledger number is present (tx was included, not just queued).
 *
 * NOT verified here (deferred to a follow-up):
 *   - Operation type / contract address / function name.
 *   - Transferred amount (requires SCVal decoding of the invoke args).
 *   - Memo content (Soroban source-account auth cannot set a memo).
 */

export type HorizonVerifyResult =
  | { ok: true; ledger: number }
  | {
      ok: false
      kind: 'permanent'
      reason:
        | 'unsuccessful'
        | 'source_mismatch'
        | 'not_in_ledger'
        | 'malformed_response'
    }
  | {
      ok: false
      kind: 'transient'
      reason: 'not_found' | 'network_error' | 'server_error'
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
  args: { txId: string; expectedSource: string; horizonUrl: string }
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
  return { ok: true, ledger: body.ledger }
}

type HorizonTxResponse = {
  successful: boolean
  source_account: string
  ledger: number
}

function isHorizonTxResponse(value: unknown): value is HorizonTxResponse {
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  return (
    typeof o.successful === 'boolean' && typeof o.source_account === 'string'
  )
}
