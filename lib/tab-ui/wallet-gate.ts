import { walletNetworkLabel } from '@/lib/payments/failures'
import type { WalletGateState } from '@/lib/payments/ui-state'

/** What the tab page knows about the account and the wallet. */
export type TabWalletInput = {
  /** The account is still loading. */
  authLoading: boolean
  signedIn: boolean
  /** The account's linked address when it is verified on this network. */
  verified: string | null
  /** Quilltip's network passphrase, or null when it is not configured. */
  passphrase: string | null
  wallet: {
    isLoading: boolean
    isInstalled: boolean
    isConnected: boolean
    errorKind: string | null
    publicKey: string | null
    networkReported: boolean
    networkPassphrase: string | null
  }
}

/**
 * The wallet gate for tab operations (open, add funds, close, withdraw,
 * collect). They are signed by the verified linked address. When the wallet
 * is on another account the gate asks to switch to the linked address and
 * never offers to link the other one: that would hide a tab held under the
 * linked address (#582). Without a verified address the link step stays.
 */
export function tabWalletGate(input: TabWalletInput): WalletGateState {
  const { wallet, verified } = input
  if (input.authLoading) return { kind: 'checking' }
  if (!input.signedIn) return { kind: 'signed-out' }
  if (wallet.isLoading) return { kind: 'checking' }
  if (wallet.errorKind === 'locked') return { kind: 'locked' }
  if (!wallet.isConnected && !wallet.isInstalled) return { kind: 'no-wallet' }
  if (!wallet.isConnected) return { kind: 'disconnected' }
  if (wallet.networkReported && wallet.networkPassphrase !== input.passphrase)
    return {
      kind: 'wrong-network',
      walletNetwork: walletNetworkLabel(wallet.networkPassphrase ?? undefined),
    }
  if (verified && wallet.publicKey && wallet.publicKey !== verified)
    return {
      kind: 'other-account',
      linked: verified,
      address: wallet.publicKey,
    }
  if (!verified || wallet.publicKey !== verified)
    return {
      kind: 'unverified',
      ...(wallet.publicKey ? { address: wallet.publicKey } : {}),
    }
  return { kind: 'ready' }
}
