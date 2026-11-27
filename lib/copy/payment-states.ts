/**
 * Copy for the shared payment kit (components/payments). The state matrix in
 * docs/design-system/payment-states.md quotes these strings; a unit test keeps
 * the two in step. Sentence case, no exclamation marks. "Nothing was sent"
 * appears only where the client knows no transaction left the wallet, and
 * copy speaks about money only from server-verified chain data.
 */
import { TIPS_UNAVAILABLE_COPY } from './tips-unavailable'
import type { WalletErrorKind } from '@/lib/stellar/v2/wallet-errors'
import type {
  PaymentFlow,
  PaymentPhase,
  WalletGateKind,
} from '@/lib/payments/ui-state'

/**
 * The kit is testnet-only while the network guard refuses mainnet, so the
 * copy names Stellar testnet directly. A mainnet launch is a reviewed copy
 * change, not a flag.
 */
export const TESTNET_LABEL = 'Stellar testnet'
export const TESTNET_LABEL_DETAIL = 'Practice funds only'

/** The cents quote beside an amount: what the same XLM would be worth. */
export function quoteCopy(usd: string | 'under-a-cent'): string {
  return usd === 'under-a-cent'
    ? 'Under $0.01 in real XLM'
    : `About ${usd} in real XLM`
}

export const ESTIMATE = {
  prefix: 'About',
  caption: 'Final amount shown before you approve',
} as const

export type CopyBlock = { title: string; detail: string }

// Wallet gate ----------------------------------------------------------------

export type GateCopy = CopyBlock & { action: string | null }

/** Titles, details and actions per gate state. */
export function gateCopy(
  kind: Exclude<WalletGateKind, 'ready'>,
  options: { walletNetwork?: string; address?: string; ended?: boolean } = {}
): GateCopy {
  switch (kind) {
    case 'checking':
      return {
        title: 'Checking your wallet',
        detail: 'This takes a moment.',
        action: null,
      }
    case 'signed-out':
      return {
        title: 'Sign in to continue',
        detail: 'Tips and tabs belong to your QuillTip account.',
        action: 'Sign in',
      }
    case 'no-wallet':
      return {
        title: 'No Stellar wallet found',
        detail:
          'Install a Stellar wallet such as Varial (formerly Freighter) or xBull in this browser, then try again.',
        action: 'Set up wallet',
      }
    case 'disconnected':
      if (options.ended) {
        return {
          title: 'Your wallet disconnected',
          detail:
            'Your wallet ended the connection. Connect again to continue. Nothing was sent.',
          action: 'Connect again',
        }
      }
      return {
        title: 'Connect your wallet',
        detail: 'Connecting shares your address. It does not send a payment.',
        action: 'Connect wallet',
      }
    case 'locked':
      return {
        title: 'Your wallet is locked',
        detail: 'Unlock your wallet, then connect again.',
        action: 'Connect again',
      }
    case 'wrong-network': {
      const have = options.walletNetwork ?? 'another network'
      return {
        title: 'Switch your wallet to Testnet',
        detail: `Your wallet is on ${have}. Switch it to Testnet, then check again. Nothing was sent.`,
        action: 'Check again',
      }
    }
    case 'unverified':
      return {
        title: 'Confirm this wallet is yours',
        detail: `Sign a short message in your wallet to link ${options.address ?? 'it'} to your account. It sends nothing and costs nothing.`,
        action: 'Confirm wallet',
      }
  }
}

/** Shown on the gate button while the wallet prompt is open. */
export const GATE_BUSY = 'Waiting for your wallet…'

// Flows ------------------------------------------------------------------------

/** Title and detail when the server (or indexed tab state) confirms. */
export const FLOW_COPY: Record<PaymentFlow, CopyBlock> = {
  'direct-tip': {
    title: 'Tip confirmed',
    detail: 'Your tip is recorded on Stellar testnet.',
  },
  'highlight-tip': {
    title: 'Highlight tip confirmed',
    detail: 'Your tip for this passage is recorded on Stellar testnet.',
  },
  'tip-basket': {
    title: 'Tips confirmed',
    detail: 'Every tip in your basket is recorded on Stellar testnet.',
  },
  'tab-open': {
    title: 'Your tab is open',
    detail: 'Tip from it on this device without a wallet prompt.',
  },
  'tab-top-up': {
    title: 'Top-up confirmed',
    detail: 'Your tab balance is updated.',
  },
  'tab-tip': {
    title: 'Tip settled',
    detail: 'Your tip is paid out on Stellar testnet.',
  },
  'tab-new-key': {
    title: 'Quick tips are on for this device',
    detail: 'This browser can tip from your tab without a wallet prompt.',
  },
  'tab-revoke-key': {
    title: 'Quick tips are off for this device',
    detail:
      'This browser can no longer tip from your tab. Tips you already sent still settle.',
  },
  'tab-close': {
    title: 'Withdrawal started',
    detail:
      'Your balance unlocks after about 3 days. Tips you already sent settle first.',
  },
  'tab-withdraw': {
    title: 'Withdrawal complete',
    detail: 'Your tab balance is back in your wallet.',
  },
  collect: {
    title: 'Earnings collected',
    detail: 'They are in your wallet now.',
  },
  'settle-own': {
    title: 'Voucher settled',
    detail: 'These tips are paid. Collect them to move them to your wallet.',
  },
  'nft-mint': {
    title: 'Article NFT minted',
    detail: 'The NFT is in your wallet on Stellar testnet.',
  },
  'nft-transfer': {
    title: 'NFT transferred',
    detail: 'The new owner holds it now.',
  },
}

/** Close-tab confirmed, when the unlock ledger is known. */
export function tabCloseConfirmed(date: string): CopyBlock {
  return {
    title: FLOW_COPY['tab-close'].title,
    detail: `Your balance unlocks around ${date}. Tips you already sent settle first.`,
  }
}

/** Basket confirmed when some tips went to an updated payout address. */
export function basketConfirmed(redirected: number): CopyBlock {
  if (redirected <= 0) return FLOW_COPY['tip-basket']
  return {
    title: FLOW_COPY['tip-basket'].title,
    detail:
      redirected === 1
        ? 'Your tips are recorded on Stellar testnet. One went to the article’s updated payout address.'
        : `Your tips are recorded on Stellar testnet. ${redirected} went to their articles’ updated payout addresses.`,
  }
}

/** "1 XLM to Ada Lovelace" under a result title. */
export function summaryLine(amount: string, to?: string): string {
  return to ? `${amount} to ${to}` : amount
}

// Progress ---------------------------------------------------------------------

/** Visually hidden heading that takes focus while a payment runs. */
export const PROGRESS_HEADING = 'Payment progress'

/** Short label for each step in the step list. */
export const STEP_LABEL = {
  simulating: 'Prepare',
  signing: 'Approve in wallet',
  sending: 'Send',
  checking: 'Confirm',
} as const

/** Where a result appears when the user closes the progress view. */
export const DEFAULT_RESULT_PLACE = 'your tip history'

/** The sentence shown and announced while a step runs. */
export const STEP_COPY = {
  simulating: 'Checking the details…',
  signing: 'Approve the request in your wallet. It shows the network fee.',
  sending: 'Sending…',
  checking: (place: string = DEFAULT_RESULT_PLACE) =>
    `Waiting for confirmation. You can close this. The result shows in ${place}.`,
} as const

export const SIGNING_HELP = 'Don’t see the request? Open your wallet extension.'
export const CANCEL_LABEL = 'Cancel'

/** `PREPARED` after a reload, or an unknown status. */
export const RESUMING_COPY =
  'Checking whether this payment went through. This can take up to 5 minutes.'

/** A tab tip has no wallet step; this is its only running state. */
export const TAB_TIP_SENDING = 'Sending your tip…'

export const CHECKING_SLOW: CopyBlock = {
  title: 'Still checking',
  detail:
    'Stellar testnet is slow right now. If the payment went through, it shows here, and it cannot be charged twice.',
}

type ResultPhase = Exclude<
  PaymentPhase,
  'simulating' | 'signing' | 'sending' | 'checking' | 'resuming'
>

export const RESULT_COPY: Record<
  Exclude<ResultPhase, 'confirmed' | 'settled' | 'unpaid' | 'rejected'>,
  CopyBlock
> = {
  'sent-to-registered': {
    title: 'Tip sent to the article’s registered payout address',
    detail:
      'Stellar testnet paid the address registered for this article, which differs from the one shown when you started. The tip is complete, so there is nothing to retry.',
  },
  'under-review': {
    title: 'Sent, but under review',
    detail:
      'The payment went through on Stellar testnet, but the details did not match what QuillTip expected. Your XLM may have moved, so do not send it again. We are checking it.',
  },
  /** A `FAILED` record with no client failure to show (for example after a reload). */
  failed: {
    title: 'Not completed',
    detail: 'QuillTip recorded no payment for this request.',
  },
  declined: {
    title: 'Request declined in your wallet',
    detail: 'Nothing was signed or sent.',
  },
  expired: {
    title: 'This request timed out',
    detail:
      'Stellar testnet did not include it in time, so nothing was paid. Try again to start a new request.',
  },
  accepted: {
    title: 'Tip sent from your tab',
    detail:
      'It settles on Stellar testnet within about 6 hours. Your tab balance already counts it.',
  },
  shortfall: {
    title: 'Waiting for the tab balance',
    detail:
      'This tip is recorded, but the tab ran short. It settles after the next top-up.',
  },
  'void-reset': {
    title: 'Cleared by a testnet reset',
    detail:
      'Stellar testnet was reset before this tip settled. No real money was involved.',
  },
}

/** Tab tip results that read differently for the reader and the writer. */
export const TAB_TIP_RESULT = {
  unpaid: {
    reader: {
      title: 'Not paid',
      detail:
        'This tip was not settled before its quick-tip key ran out, so it was not paid. The amount is back in your tab balance.',
    },
    writer: {
      title: 'Not paid',
      detail: 'This tip was not settled in time, so it will not be paid.',
    },
  },
  rejected: {
    reader: {
      title: 'Not settled',
      detail:
        'QuillTip could not settle this tip, so it was not paid and your tab was not charged for it. We are checking it.',
    },
    writer: {
      title: 'Not settled',
      detail:
        'QuillTip could not settle this tip, so it was not paid to you. We are checking it.',
    },
  },
} as const

/**
 * A tab operation that failed or timed out, known only from the client's
 * own RPC polling: no claim about money, the tab state is the source.
 */
export const TAB_OPERATION_RESULT = {
  failed: {
    title: 'Not completed',
    detail:
      'Stellar testnet reported this transaction as failed. Your tab shows its current balance.',
  },
  expired: {
    title: 'This request timed out',
    detail:
      'Stellar testnet did not confirm it in time. Check your tab before you try again.',
  },
} as const

export const RETRY_LABEL = 'Try again'
export const DONE_LABEL = 'Done'
export const VIEW_TRANSACTION = 'View the transaction'
export const REFERENCE_LABEL = 'Reference'
export const HELP_LABEL = 'Get help'

// Failures ---------------------------------------------------------------------

export const FAILURE_COPY = {
  /** The client knows the transaction never left: simulation or send refused it. */
  notSent: { title: 'Not sent', detail: 'Nothing was sent.' },
  notSentBusy: {
    title: 'Stellar testnet is busy',
    detail: 'Stellar testnet did not accept it. Try again in a minute.',
  },
} as const

/**
 * Wallet failures while signing. Titles are fixed; wallet text is never
 * shown. Every wallet error kind except `cancelled` has an entry, so a new
 * kind does not compile until it has copy.
 */
export const WALLET_FAILURE_COPY = {
  rejected: RESULT_COPY.declined,
  timeout: {
    title: 'Your wallet did not respond',
    detail:
      'Check for an open wallet window, close it, then try again. Nothing was sent.',
  },
  unsupported: {
    title: 'This wallet cannot be used here',
    detail: 'Choose another wallet in the wallet list. Nothing was sent.',
  },
  'wrong-account': {
    title: 'Your wallet signed with another account',
    detail:
      'Switch back to the connected account in your wallet, or reconnect. Nothing was sent.',
  },
  'popup-blocked': {
    title: 'Your browser blocked the wallet window',
    detail:
      'Allow pop-ups for this site in your browser, then try again. Nothing was sent.',
  },
  disconnected: {
    title: 'Your wallet disconnected',
    detail:
      'Your wallet ended the connection. Connect again, then try again. Nothing was sent.',
  },
  'no-wallet': {
    title: 'No Stellar wallet found',
    detail: 'Install a Stellar wallet, then try again. Nothing was sent.',
  },
  locked: {
    title: 'Your wallet is locked',
    detail: 'Unlock your wallet, then connect again. Nothing was sent.',
  },
  'wrong-network': {
    title: 'Switch your wallet to Testnet',
    detail: 'Switch it to Testnet, then try again. Nothing was sent.',
  },
  failed: {
    title: 'Your wallet reported a problem',
    detail: 'Try again, or reconnect your wallet. Nothing was sent.',
  },
} as const satisfies Record<Exclude<WalletErrorKind, 'cancelled'>, CopyBlock>

/** Convex tab refusals with no notice of their own. The server accepted nothing. */
export const TAB_REFUSAL_COPY = {
  aboveMax: {
    title: 'This tip is above the quick-tip maximum',
    detail: 'Choose a smaller amount, or tip from your wallet.',
  },
  belowMinimum: {
    title: 'This tip is below the minimum',
    detail: 'Choose a larger amount.',
  },
  selfTip: {
    title: 'You can’t tip your own article',
    detail: 'This tip was not accepted.',
  },
  noPrice: {
    title: 'No XLM price right now',
    detail: 'QuillTip can’t convert this amount yet. Try again in a minute.',
  },
  timedOut: {
    title: 'This tip took too long',
    detail: 'This tip was not accepted. Send it again.',
  },
  duplicate: {
    title: 'This tip was already sent',
    detail: 'Your tab already counts it.',
  },
  noWithdrawal: {
    title: 'No withdrawal is waiting',
    detail: 'Close your tab first to start one.',
  },
  unavailable: {
    title: 'Quick tips are unavailable right now',
    detail: 'Tip from your wallet, or try again later.',
  },
  otherAccount: {
    title: 'This wallet’s tab belongs to another account',
    detail: 'Sign in to the account that opened it, or use another wallet.',
  },
  badVoucher: {
    title: 'QuillTip could not accept this tip',
    detail: 'Set up quick tips again on this device.',
  },
  generic: {
    title: 'QuillTip could not accept this',
    detail: 'Try again in a minute.',
  },
} as const

// Status labels for history rows ----------------------------------------------

export const STATUS_LABEL: Record<PaymentPhase, string> = {
  simulating: 'In progress',
  signing: 'In progress',
  sending: 'In progress',
  checking: 'Confirming',
  resuming: 'Checking',
  declined: 'Declined',
  confirmed: 'Confirmed',
  'sent-to-registered': 'Sent to updated address',
  'under-review': 'Under review',
  failed: 'Not completed',
  expired: 'Timed out',
  accepted: 'Settling',
  settled: 'Settled',
  shortfall: 'Waiting for balance',
  unpaid: 'Not paid',
  rejected: 'Not settled',
  'void-reset': 'Cleared by reset',
}

// Notices ----------------------------------------------------------------------

export const NOTICE_COPY = {
  paused: {
    reader: {
      title: 'Payments are paused',
      detail:
        'QuillTip has paused new payments on Stellar testnet. Tips you already sent still settle, and you can still withdraw your tab.',
    },
    writer: {
      title: 'Payments are paused',
      detail:
        'QuillTip has paused new payments on Stellar testnet. Tips already sent still settle, and you can still collect.',
    },
  },
  insufficientWallet: (needed?: string, available?: string): CopyBlock => ({
    title: 'Not enough XLM in your wallet',
    detail:
      needed && available
        ? `This needs ${needed} plus a small network fee. Your wallet can spend ${available}.`
        : 'Add test XLM to your wallet or choose a smaller amount. The network fee is small but not zero.',
  }),
  insufficientTab: (available?: string): CopyBlock => ({
    title: 'Not enough in your tab',
    detail: available
      ? `Your tab has ${available} free after tips still settling. Top up or choose a smaller tip.`
      : 'Top up your tab or choose a smaller tip.',
  }),
  sessionKeyNone: {
    title: 'Quick tips aren’t set up on this device',
    detail:
      'Your tab is open. Set up quick tips here to tip without a wallet prompt. It takes one wallet approval.',
  },
  sessionKeyMissing: {
    title: 'This device’s quick-tip key is gone',
    detail:
      'Your browser cleared it. Your balance is safe, and tips you already sent still settle. Set up quick tips again to keep tipping from your tab.',
  },
  sessionKeyExpired: {
    title: 'Quick tips on this device have expired',
    detail:
      'Your balance is safe, and tips you already sent still settle. Renewing takes one wallet approval.',
  },
  keyLimit: {
    title: 'This device reached its quick-tip limit',
    detail: 'Set up quick tips again to raise it, or tip from your wallet.',
  },
  dailyLimit: {
    title: 'Daily quick-tip limit reached',
    detail: 'Tip from your wallet, or try again tomorrow.',
  },
  tabNone: {
    title: 'You don’t have an open tab',
    detail:
      'Open a tab to tip without a wallet prompt, or tip from your wallet.',
  },
  tabClosing: {
    title: 'Your tab is closing',
    detail:
      'Quick tips are off until you add funds or the withdrawal finishes. Tip from your wallet instead.',
  },
  settlementDelayedReader: {
    title: 'Settlement is taking longer than usual',
    detail: 'Your tips are recorded and will settle. Nothing is lost.',
  },
  settlementDelayedWriter: {
    title: 'Settlement is taking longer than usual',
    detail:
      'These tips are recorded and will settle. You can also settle them yourself with your saved voucher.',
  },
  /** Shared with components/tipping/TipsUnavailableNote. */
  tipsUnavailable: TIPS_UNAVAILABLE_COPY,
  basketItemUnavailable: {
    title: 'An article in your basket can’t take tips right now',
    detail: 'Remove it to send the rest. Nothing was sent.',
  },
  withdrawalPending: (unlockDate?: string): CopyBlock => ({
    title: unlockDate
      ? `Your balance unlocks around ${unlockDate}`
      : 'Your withdrawal is waiting to unlock',
    detail:
      'Your tab is closing. Tips you already sent settle first, and quick tips are off. Adding funds before then cancels the withdrawal.',
  }),
  withdrawalReady: {
    title: 'Your balance is ready to withdraw',
    detail: 'The waiting period is over. Withdraw to move it to your wallet.',
  },
  closeTabWarning: {
    title: 'Before you close your tab',
    detail:
      'Closing locks your tab balance for about 3 days. Tips you already sent settle first. Adding funds before then cancels it.',
  },
  nftThreshold: (tipped: string, threshold: string): CopyBlock => ({
    title: `${tipped} of ${threshold} tipped`,
    detail: `Minting unlocks at ${threshold}.`,
  }),
  networkBusy: FAILURE_COPY.notSentBusy,
} as const

export const NOTICE_ACTION = {
  insufficientWallet: 'Choose a smaller amount',
  insufficientTab: 'Top up',
  sessionKey: 'Set up quick tips',
  sessionKeyExpired: 'Renew quick tips',
  settleOwn: 'Settle it yourself',
  tipFromWallet: 'Tip from wallet',
  withdraw: 'Withdraw',
  openTab: 'Open a tab',
  removeItem: 'Remove it',
} as const

// Session key row --------------------------------------------------------------

export const SESSION_KEY_COPY = {
  label: 'Quick tips on this device',
  expires: (date: string) => `Expires around ${date}`,
  expired: 'Expired',
  revoked: 'Revoked',
  used: (used: string, limit: string) => `${used} of ${limit} used`,
  revoke: 'Revoke',
  renew: 'Renew quick tips',
} as const
