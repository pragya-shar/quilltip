/**
 * Proves the connected wallet controls its address, then links it to the
 * signed-in account (convex/walletLink.ts).
 *
 * 1. Ask the server for a challenge bound to the account, address, network
 *    and this site's origin.
 * 2. Sign the challenge message (SEP-53). Wallets that cannot sign messages
 *    (`unsupported`), or whose message signature the server does not accept,
 *    sign the challenge transaction instead. That transaction has sequence
 *    number 0 and is never submitted: it cannot move funds.
 * 3. Send the proof to the server, which verifies it and links the address.
 */

import { WalletError, isWalletError } from './wallet-errors'

export type WalletChallenge = {
  challengeId: string
  message: string
  transactionXdr: string
  networkPassphrase: string
  expiresAt: number
}

export type WalletProof =
  | { kind: 'message'; signature: string }
  | { kind: 'transaction'; signedXdr: string }

export type VerifyResult =
  | { ok: true; address: string; verifiedAt: number }
  | { ok: false; reason: string }

/** The adapter surface this needs (see `lib/stellar/v2/wallet.ts`). */
export type OwnershipWallet = {
  getConnection(): { address: string } | null
  signMessage(message: string): Promise<{ signedMessage: string }>
  signTransaction(xdr: string): Promise<{ signedTxXdr: string }>
}

export type OwnershipDeps = {
  wallet: OwnershipWallet
  createChallenge(args: {
    address: string
    origin: string
  }): Promise<WalletChallenge>
  verifyChallenge(args: {
    challengeId: string
    origin: string
    proof: WalletProof
  }): Promise<VerifyResult>
  origin: string
  /** Called when the wallet is about to be asked to sign (for status copy). */
  onStep?: (step: 'challenge' | 'sign' | 'verify', method: ProofMethod) => void
}

export type ProofMethod = 'message' | 'transaction'

/** A refused proof, with the server's reason. */
export class WalletOwnershipError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`Wallet ownership was not verified: ${reason}`)
    this.name = 'WalletOwnershipError'
    this.reason = reason
  }
}

export type OwnershipResult = {
  address: string
  verifiedAt: number
  method: ProofMethod
}

async function attempt(
  deps: OwnershipDeps,
  address: string,
  method: ProofMethod
): Promise<VerifyResult> {
  deps.onStep?.('challenge', method)
  const challenge = await deps.createChallenge({
    address,
    origin: deps.origin,
  })
  deps.onStep?.('sign', method)
  let proof: WalletProof
  if (method === 'message') {
    const { signedMessage } = await deps.wallet.signMessage(challenge.message)
    proof = { kind: 'message', signature: signedMessage }
  } else {
    const { signedTxXdr } = await deps.wallet.signTransaction(
      challenge.transactionXdr
    )
    proof = { kind: 'transaction', signedXdr: signedTxXdr }
  }
  deps.onStep?.('verify', method)
  return deps.verifyChallenge({
    challengeId: challenge.challengeId,
    origin: deps.origin,
    proof,
  })
}

/**
 * Proves control of the connected address and links it. Throws a
 * `WalletError` for wallet failures and a `WalletOwnershipError` when the
 * server refuses the proof.
 */
export async function proveWalletOwnership(
  deps: OwnershipDeps
): Promise<OwnershipResult> {
  const connection = deps.wallet.getConnection()
  if (!connection) throw new WalletError('locked', 'Connect a wallet first')
  const { address } = connection

  let method: ProofMethod = 'message'
  let result: VerifyResult
  try {
    result = await attempt(deps, address, 'message')
  } catch (error) {
    if (!isWalletError(error, 'unsupported')) throw error
    method = 'transaction'
    result = await attempt(deps, address, 'transaction')
  }
  // Some wallets sign messages in a format other than SEP-53.
  if (
    !result.ok &&
    method === 'message' &&
    result.reason === 'SIGNATURE_INVALID'
  ) {
    method = 'transaction'
    result = await attempt(deps, address, 'transaction')
  }
  if (!result.ok) throw new WalletOwnershipError(result.reason)
  return { address: result.address, verifiedAt: result.verifiedAt, method }
}

/** Copy for a refused proof. */
export function ownershipErrorMessage(reason: string): {
  title: string
  detail: string
} {
  switch (reason) {
    case 'CHALLENGE_EXPIRED':
      return {
        title: 'The request expired',
        detail: 'Verification requests last five minutes. Try again.',
      }
    case 'ADDRESS_IN_USE':
      return {
        title: 'This address is verified on another account',
        detail:
          'Each Stellar address can be verified on one QuillTip account. Remove it there first, or use another wallet.',
      }
    case 'ORIGIN_NOT_ALLOWED':
    case 'ORIGIN_MISMATCH':
      return {
        title: 'This page cannot verify wallets',
        detail: 'Open QuillTip at its usual address and try again.',
      }
    case 'RATE_LIMITED':
      return {
        title: 'Too many verification requests',
        detail: 'Wait ten minutes, then try again.',
      }
    case 'NETWORK_MISMATCH':
      return {
        title: 'QuillTip changed networks',
        detail: 'Reload the page and try again.',
      }
    case 'SIGNATURE_INVALID':
    case 'TRANSACTION_CHANGED':
      return {
        title: 'Your wallet’s signature did not match',
        detail:
          'Make sure the wallet is on the account you connected, then try again. Nothing was linked.',
      }
    default:
      return {
        title: 'Your wallet was not verified',
        detail: 'Try again. Nothing was linked.',
      }
  }
}
