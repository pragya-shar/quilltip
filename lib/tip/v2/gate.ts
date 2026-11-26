/**
 * The wallet gate for a v2 tip (docs/design-system/payment-states.md,
 * "Wallet gate"), from the account, the wallet adapter and
 * `tipsV2.getTipEligibility`. The first thing in the way wins, in the order
 * a reader fixes them: sign in, connect, unlock, switch network, confirm
 * the wallet is theirs.
 */
import type { WalletGateState } from '@/lib/payments/ui-state'
import { walletNetworkLabel } from '@/lib/payments/failures'
import type { WalletErrorKind } from '@/lib/stellar/v2/wallet-errors'

export type GateInput = {
  authLoading: boolean
  isAuthenticated: boolean
  wallet: {
    isLoading: boolean
    isConnected: boolean
    publicKey: string | null
    networkPassphrase: string | null
    /** False when the wallet cannot report its network. */
    networkReported: boolean
    errorKind: WalletErrorKind | null
  }
  /** The network passphrase QuillTip uses. */
  expectedPassphrase: string
  /** `getTipEligibility`, or undefined while it loads. */
  eligibility:
    | { reason: string | null; tipperAddress: string | null }
    | undefined
}

export function tipGateState(input: GateInput): WalletGateState {
  if (input.authLoading) return { kind: 'checking' }
  if (!input.isAuthenticated) return { kind: 'signed-out' }
  const w = input.wallet
  if (w.isLoading) return { kind: 'checking' }
  if (w.errorKind === 'no-wallet') return { kind: 'no-wallet' }
  if (w.errorKind === 'locked') return { kind: 'locked' }
  // Connecting refused the wallet's network; its passphrase is not kept.
  if (w.errorKind === 'wrong-network' && !w.isConnected) {
    return { kind: 'wrong-network' }
  }
  if (!w.isConnected || !w.publicKey) return { kind: 'disconnected' }
  if (w.networkReported && w.networkPassphrase !== input.expectedPassphrase) {
    return {
      kind: 'wrong-network',
      walletNetwork: walletNetworkLabel(w.networkPassphrase ?? undefined),
    }
  }
  const eligibility = input.eligibility
  if (!eligibility) return { kind: 'checking' }
  if (
    eligibility.reason === 'NO_WALLET' ||
    eligibility.reason === 'ADDRESS_UNVERIFIED' ||
    (eligibility.tipperAddress !== null &&
      eligibility.tipperAddress !== w.publicKey)
  ) {
    // The connected wallet is not the account's verified address: confirming
    // it links this wallet (tips are sent from the linked address only).
    return { kind: 'unverified', address: w.publicKey }
  }
  return { kind: 'ready' }
}
