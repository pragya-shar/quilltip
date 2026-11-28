/**
 * A wallet's error, from the existing mapping (`classifyWalletError` and
 * `walletErrorMessage` in lib/stellar/v2/wallet-errors.ts), as the step
 * failure the sheets show. Declining, closing the window, closing the
 * picker and not answering in time are the reader's choice: `cancelled`.
 */
import { walletEntry } from '@/lib/stellar/wallet-catalog'
import {
  SIGNED_FOR_ANOTHER_NETWORK,
  networkLabel,
  walletErrorMessage,
  type WalletError,
} from '@/lib/stellar/v2/wallet-errors'
import type { StepFailure } from './services'

export function stepFailureFromWallet(
  error: WalletError,
  expectedAddress?: string
): StepFailure {
  const wallet = walletEntry(error.walletId)?.name ?? 'Your wallet'
  switch (error.kind) {
    case 'rejected':
    case 'cancelled':
    case 'timeout':
      return { kind: 'cancelled' }
    case 'popup-blocked':
      return { kind: 'popup-blocked', wallet }
    case 'locked':
      return { kind: 'locked', wallet }
    case 'wrong-network':
      return error.message === SIGNED_FOR_ANOTHER_NETWORK
        ? { kind: 'wrong-network', when: 'after', network: null }
        : {
            kind: 'wrong-network',
            when: 'before',
            network: error.walletPassphrase
              ? capitalise(networkLabel(error.walletPassphrase))
              : null,
          }
    case 'unsupported':
      return { kind: 'unsupported', wallet }
    case 'wrong-account':
      return {
        kind: 'wrong-account',
        expected: error.expectedAddress ?? expectedAddress ?? '',
        actual: error.walletAddress ?? null,
      }
    default:
      return {
        kind: 'wallet-failed',
        message:
          walletErrorMessage(error)?.detail ??
          'Your wallet reported a problem.',
      }
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
