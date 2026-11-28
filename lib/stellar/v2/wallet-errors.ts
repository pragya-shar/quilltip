/**
 * Wallet failure kinds, the one mapping from each wallet's errors to them
 * (`classifyWalletError`), and the copy readers see for each. Kept separate
 * from the adapter so components can import it without loading the Wallets
 * Kit.
 */

import { walletEntry } from '../wallet-catalog'

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
  /**
   * The wallet cannot do what was asked: it cannot be used on this page (for
   * example Albedo over http), or it cannot sign this kind of request.
   */
  | 'unsupported'
  /** The browser blocked the window a web wallet opens. */
  | 'popup-blocked'
  /** The wallet ended the connection (a WalletConnect session closed or expired). */
  | 'disconnected'
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
  /**
   * wrong-account found before signing: the address that must sign (the
   * linked address) and the account the wallet is on. Nothing was signed.
   */
  readonly expectedAddress?: string
  readonly walletAddress?: string

  constructor(
    kind: WalletErrorKind,
    message: string,
    details: {
      walletId?: string
      expectedPassphrase?: string
      walletPassphrase?: string
      walletCode?: number
      expectedAddress?: string
      walletAddress?: string
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
    this.expectedAddress = details.expectedAddress
    this.walletAddress = details.walletAddress
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

type KitErrorShape = {
  code?: number
  message?: string
  error?: { code?: number; message?: string }
}

/** One known error: a SEP-43 code, a message pattern, or both. */
type ErrorRule = {
  kind: WalletErrorKind
  code?: number
  /** Tested against the lower-cased message. */
  pattern?: RegExp
}

/**
 * Errors each wallet reports, from its kit module and its own API
 * (`docs/wallets.md`). Checked before the shared rules, so a wallet's own
 * wording wins over a generic match.
 */
export const WALLET_ERROR_RULES: Readonly<
  Record<string, readonly ErrorRule[]>
> = {
  varial: [
    // -4 "The user rejected this request."
    { kind: 'rejected', pattern: /user declined|user rejected/ },
    // -1 "The wallet is locked. Unlock Varial and try again."
    { kind: 'locked', pattern: /wallet is locked/ },
    // `getAddress` before access was granted.
    { kind: 'locked', pattern: /not allowed|request access first/ },
    { kind: 'no-wallet', pattern: /varial is not connected/ },
  ],
  xbull: [
    // The web wallet answers a declined request with this message.
    { kind: 'rejected', pattern: /request rejected from the wallet/ },
    // The reader closed the xBull window: its RxJS stream ended empty.
    { kind: 'rejected', pattern: /no elements in sequence/ },
    // The window never opened, so xBull has no window to talk to.
    { kind: 'popup-blocked', pattern: /xbull wallet is not open/ },
  ],
  albedo: [
    // "Action request was rejected by the user." Also sent when the reader
    // closes the Albedo window.
    { kind: 'rejected', code: -4 },
    { kind: 'popup-blocked', pattern: /pop-?up|window.*block/ },
  ],
  rabet: [
    { kind: 'no-wallet', pattern: /rabet is not installed/ },
    // Rabet signs for mainnet or testnet only.
    { kind: 'wrong-network', pattern: /doesn't support the network/ },
  ],
  hana: [{ kind: 'no-wallet', pattern: /hana wallet is not installed/ }],
  scopuly: [
    { kind: 'no-wallet', pattern: /scopuly provider is not available/ },
  ],
  // Quilltip's WalletConnect module and the wallet on the phone. Codes are
  // WalletConnect's (5000 user rejected, 5100 unsupported chains, 5101
  // unsupported methods) and EIP-1193's 4001.
  wallet_connect: [
    // Before the codes: Varial mobile refuses a request for another network
    // with "Please switch to <network> in Varial Settings".
    {
      kind: 'wrong-network',
      pattern: /not on stellar testnet|please switch to/,
    },
    { kind: 'rejected', code: 5000 },
    { kind: 'rejected', code: 4001 },
    { kind: 'wrong-network', code: 5100 },
    { kind: 'unsupported', code: 5101 },
    { kind: 'timeout', pattern: /(proposal|request) expired/ },
    {
      kind: 'disconnected',
      pattern:
        /session ended|no matching key|recently deleted|session topic doesn't exist|user disconnected/,
    },
  ],
  dcent: [
    { kind: 'no-wallet', pattern: /d'cent stellar provider is not available/ },
    // `getAddress` before access was granted.
    { kind: 'locked', pattern: /not allowed, please request access/ },
  ],
}

/** Rules for every wallet, after the wallet's own. */
const SHARED_ERROR_RULES: readonly ErrorRule[] = [
  { kind: 'cancelled', pattern: /closed the modal|modal was closed/ },
  { kind: 'rejected', code: -4 },
  {
    kind: 'rejected',
    pattern: /declin|reject|denied|cancel|refused by the user/,
  },
  { kind: 'timeout', pattern: /timed? ?out/ },
  { kind: 'popup-blocked', pattern: /pop-?up.*block|block.*pop-?up/ },
  { kind: 'locked', pattern: /locked|not allowed|request access|permission/ },
  {
    kind: 'unsupported',
    pattern: /does not support|doesn't support|not supported/,
  },
  {
    kind: 'no-wallet',
    pattern: /is not (connected|available|installed)|not detected/,
  },
]

function matches(rule: ErrorRule, text: string, code: number | undefined) {
  if (rule.code !== undefined && rule.code !== code) return false
  if (rule.pattern && !rule.pattern.test(text)) return false
  return rule.code !== undefined || rule.pattern !== undefined
}

/**
 * Maps a kit or wallet error (SEP-43 shape, Error or string) to a
 * WalletError: the wallet's own rules first, then the shared ones.
 */
export function classifyWalletError(
  error: unknown,
  walletId?: string
): WalletError {
  if (error instanceof WalletError) return error
  const shape = (
    typeof error === 'object' && error !== null ? error : {}
  ) as KitErrorShape
  const rawCode = shape.error?.code ?? shape.code
  const code = typeof rawCode === 'number' ? rawCode : undefined
  const message =
    shape.error?.message ??
    shape.message ??
    (typeof error === 'string' ? error : '')
  const text = message.toLowerCase()
  const rules = [
    ...(walletId ? (WALLET_ERROR_RULES[walletId] ?? []) : []),
    ...SHARED_ERROR_RULES,
  ]
  const rule = rules.find((candidate) => matches(candidate, text, code))
  const kind = rule?.kind ?? 'failed'
  return new WalletError(
    kind,
    kind === 'cancelled'
      ? 'Wallet selection was closed'
      : message || 'Wallet request failed',
    { walletId, walletCode: code, cause: error }
  )
}

export type WalletMessage = { title: string; detail: string }

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'

/**
 * The message of a `wrong-network` error raised after signing: the wallet
 * cannot report its network, and its signature is not valid for Quilltip's.
 */
export const SIGNED_FOR_ANOTHER_NETWORK =
  'The wallet signed for a different Stellar network'

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
 * Copy for each failure. Titles say what happened; details say what to do,
 * and name the wallet when the error says which one it was.
 * `cancelled` has no copy: closing the picker is not an error to report.
 */
/** G…, shortened as the payment UI shows addresses. */
function shortKey(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : address
}

export function walletErrorMessage(error: WalletError): WalletMessage | null {
  const entry = walletEntry(error.walletId)
  const name = entry?.name ?? 'your wallet'
  const Name = entry?.name ?? 'Your wallet'
  switch (error.kind) {
    case 'no-wallet':
      return {
        title: 'No Stellar wallet found',
        detail: entry
          ? `${name} is not installed or not enabled in this browser. Install it, or choose another wallet, then try again.`
          : 'Install a Stellar wallet such as Varial (formerly Freighter) or xBull in this browser, then try again.',
      }
    case 'locked':
      return {
        title: 'Your wallet is locked',
        detail: `Unlock ${name}, allow Quilltip to connect, then try again.`,
      }
    case 'wrong-network': {
      const want = networkLabel(error.expectedPassphrase ?? TESTNET_PASSPHRASE)
      const have = networkLabel(error.walletPassphrase)
      return {
        title: `Switch your wallet to ${want}`,
        detail: `Your wallet is on ${have}. Quilltip uses ${want}. Change the network in ${name}, then try again. ${
          error.message === SIGNED_FOR_ANOTHER_NETWORK
            ? 'Nothing was sent.'
            : 'Nothing was signed.'
        }`,
      }
    }
    case 'rejected':
      return {
        title: 'Request declined in your wallet',
        detail: entry?.opensWindow
          ? `The ${name} window was closed or the request was declined. Nothing was signed or sent. Try again and approve the request when you are ready.`
          : 'Nothing was signed or sent. Try again and approve the request when you are ready.',
      }
    case 'timeout':
      return {
        title: 'Your wallet did not respond',
        detail: entry?.opensWindow
          ? `Look for the ${name} window behind this one, close it, then try again. Nothing was sent.`
          : `${name} may be locked: unlock it, then try again. If a wallet window is open, close it first. Nothing was sent.`,
      }
    case 'popup-blocked':
      return {
        title: 'Your browser blocked the wallet window',
        detail: `${Name} opens in a new window. Allow pop-ups for this site in your browser, then try again. Nothing was signed.`,
      }
    case 'unsupported':
      return {
        title: 'This wallet cannot be used here',
        detail: error.message,
      }
    case 'wrong-account':
      return {
        title: 'Your wallet signed with another account',
        // After the wallet answered, the error names the caller's signer
        // (the linked address) when the caller gave one.
        detail:
          error.expectedAddress && !error.walletAddress
            ? `Switch your wallet to ${shortKey(error.expectedAddress)}, the address linked to your Quilltip account, or reconnect. Nothing was sent.`
            : 'Switch back to the connected account in your wallet, or reconnect. Nothing was sent.',
      }
    case 'disconnected':
      return {
        title: 'Your wallet disconnected',
        detail: `${Name} ended the connection. Connect again, then try again. Nothing was sent.`,
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
