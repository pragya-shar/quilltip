/**
 * Wallet failure kinds and the copy readers see for each. Kept separate from
 * the adapter so components can import it without loading the Wallets Kit.
 */

export type WalletErrorKind =
  /** No wallet extension or connector is available in this browser. */
  | 'no-wallet'
  /** The wallet is locked, or this site has not been given access. */
  | 'locked'
  /** The wallet is on a different Stellar network from Quilltip. */
  | 'wrong-network'
  /** The reader declined the request in the wallet. */
  | 'rejected'
  /** The wallet did not answer in time. */
  | 'timeout'
  /** The reader closed the wallet picker without choosing. */
  | 'cancelled'
  /** The wallet cannot be used on this page (for example Albedo over http). */
  | 'unsupported'
  /** The wallet signed with a different account from the connected one. */
  | 'wrong-account'
  /** Anything else the wallet reported. */
  | 'failed'

export class WalletError extends Error {
  readonly kind: WalletErrorKind
  readonly walletId?: string
  /** Network passphrase Quilltip uses (wrong-network only). */
  readonly expectedPassphrase?: string
  /** Network passphrase the wallet reported (wrong-network only). */
  readonly walletPassphrase?: string
  /** Code from the wallet (SEP-43: -1 internal, -2 external, -3 invalid, -4 rejected). */
  readonly walletCode?: number

  constructor(
    kind: WalletErrorKind,
    message: string,
    details: {
      walletId?: string
      expectedPassphrase?: string
      walletPassphrase?: string
      walletCode?: number
      cause?: unknown
    } = {}
  ) {
    super(message, { cause: details.cause })
    this.name = 'WalletError'
    this.kind = kind
    this.walletId = details.walletId
    this.expectedPassphrase = details.expectedPassphrase
    this.walletPassphrase = details.walletPassphrase
    this.walletCode = details.walletCode
  }
}

export function isWalletError(
  error: unknown,
  kind?: WalletErrorKind
): error is WalletError {
  return (
    error instanceof WalletError && (kind === undefined || error.kind === kind)
  )
}

export type WalletMessage = { title: string; detail: string }

/** Human name for a passphrase, for the wrong-network copy. */
export function networkLabel(passphrase: string | undefined): string {
  if (!passphrase) return 'another network'
  if (passphrase.startsWith('Test SDF Network')) return 'Testnet'
  if (passphrase.startsWith('Public Global Stellar Network')) return 'Mainnet'
  if (passphrase.startsWith('Test SDF Future Network')) return 'Futurenet'
  if (passphrase.startsWith('Standalone Network')) return 'a local network'
  return 'another network'
}

/**
 * Copy for each failure. Titles say what happened; details say what to do.
 * `cancelled` has no copy: closing the picker is not an error to report.
 */
export function walletErrorMessage(error: WalletError): WalletMessage | null {
  switch (error.kind) {
    case 'no-wallet':
      return {
        title: 'No Stellar wallet found',
        detail:
          'Install a Stellar wallet such as Varial (formerly Freighter) or xBull in this browser, then try again.',
      }
    case 'locked':
      return {
        title: 'Your wallet is locked',
        detail:
          'Unlock your wallet, allow Quilltip to connect, then try again.',
      }
    case 'wrong-network': {
      const want = networkLabel(error.expectedPassphrase)
      const have = networkLabel(error.walletPassphrase)
      return {
        title: `Switch your wallet to ${want}`,
        detail: `Your wallet is on ${have}. Quilltip uses ${want}. Change the network in your wallet, then try again. Nothing was signed.`,
      }
    }
    case 'rejected':
      return {
        title: 'Request declined in your wallet',
        detail:
          'Nothing was signed or sent. Try again and approve the request when you are ready.',
      }
    case 'timeout':
      return {
        title: 'Your wallet did not respond',
        detail:
          'Check for an open wallet window, close it, then try again. Nothing was sent.',
      }
    case 'unsupported':
      return {
        title: 'This wallet cannot be used here',
        detail: error.message,
      }
    case 'wrong-account':
      return {
        title: 'Your wallet signed with another account',
        detail:
          'Switch back to the connected account in your wallet, or reconnect. Nothing was sent.',
      }
    case 'cancelled':
      return null
    default:
      return {
        title: 'Your wallet reported a problem',
        detail: error.message || 'Try again, or reconnect your wallet.',
      }
  }
}

/** What a connect button should do with a failure. */
export type ConnectFailure =
  | { action: 'install' }
  | { action: 'ignore' }
  | { action: 'show'; message: WalletMessage }

export function describeConnectFailure(error: unknown): ConnectFailure {
  if (isWalletError(error)) {
    if (error.kind === 'no-wallet') return { action: 'install' }
    const message = walletErrorMessage(error)
    return message ? { action: 'show', message } : { action: 'ignore' }
  }
  return {
    action: 'show',
    message: {
      title: 'Could not connect your wallet',
      detail:
        error instanceof Error && error.message
          ? error.message
          : 'Try again, or reconnect your wallet.',
    },
  }
}
