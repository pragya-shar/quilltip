/**
 * One seam for adding money to the balance, whoever approves it: a Stellar
 * wallet or a passkey account. Agreed between the Add money work (wallet
 * route) and the passkey route; both build the same contract calls
 * (`Tab.open_session`, `deposit`, `register_key`, `revoke_key`) and share
 * every state after the approval.
 *
 * Only two things differ by signer:
 * - `payload`: a wallet signs the whole transaction envelope (`tx`); a
 *   passkey account signs only its Soroban auth entries (`auth`), because a
 *   contract address cannot be a transaction source.
 * - `fee.paidBy`: a wallet pays its own network fee; for a passkey account
 *   Quilltip's fee sponsor pays it (`convex/sponsor.ts`).
 */

export type SignerKind = 'wallet' | 'passkey'

export type BalanceCall =
  | 'open_session'
  | 'deposit'
  | 'register_key'
  | 'revoke_key'

/** The ledger clock read when the call was prepared, for the consent's date. */
export type LedgerClock = { sequence: number; closedAt: number }

export type AuthEntryToSign = {
  /** Base64 XDR of a `SorobanAuthorizationEntry`. */
  b64: string
  /** Invocations the entry authorizes (root plus nested): one context rule id each. */
  contexts: number
  /** The last ledger at which the signature is accepted. */
  expiration: number
}

/** A balance call prepared and simulated, before anyone approves it. */
export type PreparedBalanceCall = {
  requestId: string
  call: BalanceCall
  /** The balance contract. */
  contractId: string
  /** The deposit, in stroops; "0" when nothing is deposited. */
  amount: string
  /** The device approval it registers, if any. */
  key: { publicKey: string; validUntil: number; spendLimit: string } | null
  clock: LedgerClock
  /** The network fee in stroops, and who pays it. */
  fee: { stroops: string; paidBy: 'wallet' | 'quilltip' }
  /** Unix seconds: after this the request is refused. */
  maxTime: number
  payload:
    | { kind: 'tx'; xdr: string; hash: string }
    | { kind: 'auth'; entries: AuthEntryToSign[] }
}

export type SignedBalanceCall =
  | { requestId: string; kind: 'tx'; signedXdr: string }
  | { requestId: string; kind: 'auth'; signedEntries: string[] }

export interface BalanceSigner {
  kind: SignerKind
  /** G… for a wallet, C… for a passkey account. */
  address: string
  /**
   * Asks the person to approve exactly this call. Called from the tap
   * handler with nothing awaited before the system prompt.
   */
  approve(req: PreparedBalanceCall): Promise<SignedBalanceCall>
}
