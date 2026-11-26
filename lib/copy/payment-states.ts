/**
 * Copy for the shared payment kit (components/payments). The state matrix in
 * docs/design-system/payment-states.md quotes these strings; a unit test keeps
 * the two in step. Sentence case, no exclamation marks, and every failure
 * says whether anything was paid.
 */
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
export const TESTNET_LABEL_DETAIL = 'Practice funds, no real value'
/** Follows a cents quote, next to the testnet label. */
export const TESTNET_QUOTE_NOTE = 'no real value'

export type CopyBlock = { title: string; detail: string }

// Wallet gate ----------------------------------------------------------------

export type GateCopy = CopyBlock & { action: string | null }

/**
 * Titles and actions per gate state. `no-wallet`, `locked` and
 * `wrong-network` reuse the wallet adapter's own copy
 * (lib/stellar/v2/wallet-errors.ts) so a failed connect and the gate say the
 * same thing.
 */
export function gateCopy(
  kind: Exclude<WalletGateKind, 'ready'>,
  options: { walletNetwork?: string; address?: string } = {}
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
      return {
        title: 'Connect your wallet',
        detail: 'Connecting shares your address. It does not send a payment.',
        action: 'Connect wallet',
      }
    case 'locked':
      return {
        title: 'Your wallet is locked',
        detail:
          'Unlock your wallet, allow QuillTip to connect, then try again.',
        action: 'Try again',
      }
    case 'wrong-network': {
      const have = options.walletNetwork ?? 'another network'
      return {
        title: 'Switch your wallet to Testnet',
        detail: `Your wallet is on ${have}. QuillTip uses Testnet. Change the network in your wallet, then check again. Nothing was signed.`,
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

// Flows ------------------------------------------------------------------------

type FlowCopy = {
  /** Title and detail when the server confirms. */
  confirmed: CopyBlock
}

export const FLOW_COPY: Record<PaymentFlow, FlowCopy> = {
  'direct-tip': {
    confirmed: {
      title: 'Tip confirmed',
      detail: 'Your tip is recorded on Stellar testnet.',
    },
  },
  'highlight-tip': {
    confirmed: {
      title: 'Highlight tip confirmed',
      detail: 'Your tip for this passage is recorded on Stellar testnet.',
    },
  },
  'tip-basket': {
    confirmed: {
      title: 'Tips confirmed',
      detail: 'Every tip in your basket is recorded on Stellar testnet.',
    },
  },
  'tab-open': {
    confirmed: {
      title: 'Your tab is open',
      detail: 'Tip from it on this device without a wallet prompt.',
    },
  },
  'tab-top-up': {
    confirmed: {
      title: 'Top-up confirmed',
      detail: 'Your tab balance is updated.',
    },
  },
  'tab-tip': {
    confirmed: {
      title: 'Tip settled',
      detail: 'Your tip is paid out on Stellar testnet.',
    },
  },
  'tab-new-key': {
    confirmed: {
      title: 'Quick tips are on for this device',
      detail: 'This browser can tip from your tab without a wallet prompt.',
    },
  },
  'tab-close': {
    confirmed: {
      title: 'Withdrawal started',
      detail:
        'Your balance unlocks after the waiting period. Tips you already sent settle first.',
    },
  },
  'tab-withdraw': {
    confirmed: {
      title: 'Withdrawal complete',
      detail: 'Your tab balance is back in your wallet.',
    },
  },
  collect: {
    confirmed: {
      title: 'Earnings collected',
      detail: 'They are in your wallet now.',
    },
  },
  'settle-own': {
    confirmed: {
      title: 'Voucher settled',
      detail: 'These tips are paid. Collect them to move them to your wallet.',
    },
  },
  'nft-mint': {
    confirmed: {
      title: 'Article NFT minted',
      detail: 'The NFT is in your wallet on Stellar testnet.',
    },
  },
  'nft-transfer': {
    confirmed: {
      title: 'NFT transferred',
      detail: 'The new owner holds it now.',
    },
  },
}

// Progress ---------------------------------------------------------------------

/** Short label for each step in the step list. */
export const STEP_LABEL = {
  simulating: 'Check',
  signing: 'Approve in wallet',
  sending: 'Send',
  checking: 'Confirm',
} as const

/** The sentence shown and announced while a step runs. */
export const STEP_COPY = {
  simulating: 'Checking the details with Stellar testnet…',
  signing: 'Approve the request in your wallet. It shows the network fee.',
  sending: 'Sending to Stellar testnet…',
  checking:
    'Waiting for Stellar testnet to confirm. You can close this; it finishes without you.',
} as const

/** A tab tip has no wallet step; this is its only running state. */
export const TAB_TIP_SENDING = 'Sending your tip…'

export const CHECKING_SLOW: CopyBlock = {
  title: 'Still checking',
  detail:
    'Stellar testnet is slow to answer. If the payment went through, it shows here. You will not be charged twice.',
}

export const RESULT_COPY: Record<
  Exclude<PaymentPhase, 'simulating' | 'signing' | 'sending' | 'checking'>,
  CopyBlock
> = {
  confirmed: FLOW_COPY['direct-tip'].confirmed,
  'sent-to-registered': {
    title: 'Tip sent to the article’s registered payout address',
    detail:
      'Stellar testnet paid the address registered for this article, which differs from the one shown when you started. The tip is complete, so there is nothing to retry.',
  },
  'under-review': {
    title: 'Finished, but under review',
    detail:
      'The transaction completed on Stellar testnet, but not as QuillTip expected. We are checking it. Do not send it again.',
  },
  failed: {
    title: 'Not sent',
    detail: 'Nothing was paid.',
  },
  expired: {
    title: 'This request timed out',
    detail:
      'It was not sent in time, so nothing was paid. Try again to start a new request.',
  },
  accepted: {
    title: 'Tip sent from your tab',
    detail: 'It settles on Stellar testnet soon. No wallet prompt needed.',
  },
  settled: FLOW_COPY['tab-tip'].confirmed,
  shortfall: {
    title: 'Waiting for the tab balance',
    detail:
      'This tip is recorded, but the tab ran short. It settles after the next top-up.',
  },
  unpaid: {
    title: 'Not paid',
    detail: 'The tab closed before this tip settled.',
  },
  'void-reset': {
    title: 'Cleared by a testnet reset',
    detail:
      'Stellar testnet was reset before this tip settled. No real money was involved.',
  },
}

export const RETRY_LABEL = 'Try again'
export const VIEW_TRANSACTION = 'View the transaction'

// Status labels for history rows ----------------------------------------------

export const STATUS_LABEL: Record<PaymentPhase, string> = {
  simulating: 'Confirming',
  signing: 'Confirming',
  sending: 'Confirming',
  checking: 'Confirming',
  confirmed: 'Confirmed',
  'sent-to-registered': 'Sent to registered address',
  'under-review': 'Under review',
  failed: 'Not sent',
  expired: 'Timed out',
  accepted: 'Settling',
  settled: 'Settled',
  shortfall: 'Waiting for balance',
  unpaid: 'Not paid',
  'void-reset': 'Cleared by reset',
}

// Notices ----------------------------------------------------------------------

export const NOTICE_COPY = {
  paused: {
    title: 'Payments are paused',
    detail:
      'QuillTip paused this action for maintenance. Tips already sent still settle, and you can still collect or withdraw.',
  },
  insufficientWallet: (needed?: string, available?: string): CopyBlock => ({
    title: 'Not enough XLM in your wallet',
    detail:
      needed && available
        ? `This needs ${needed} plus a small network fee. Your wallet has ${available}.`
        : 'Add test XLM to your wallet or choose a smaller amount. The network fee is small but not zero.',
  }),
  insufficientTab: (available?: string): CopyBlock => ({
    title: 'Not enough in your tab',
    detail: available
      ? `Your tab has ${available} free after tips still settling. Top up or choose a smaller tip.`
      : 'Top up your tab or choose a smaller tip.',
  }),
  sessionKeyMissing: {
    title: 'This device’s quick-tip key is gone',
    detail:
      'Your browser cleared it. Your balance is safe, and tips you already sent still settle. Set up quick tips again to keep tipping from your tab.',
  },
  sessionKeyExpired: {
    title: 'Quick tips on this device have expired',
    detail:
      'Your balance is safe, and tips you already sent still settle. Renew to keep tipping without a wallet prompt.',
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
  tipsUnavailable: {
    unregistered: 'Tips aren’t on for this article yet.',
    pending: 'Tips for this article turn on in a moment.',
    payout_outdated: 'Tips are paused while the writer updates their wallet.',
    splits:
      'Quick tips don’t work for this article because it shares tips with co-authors. Tip from your wallet instead.',
  },
  withdrawalPending: (unlockDate?: string): CopyBlock => ({
    title: unlockDate
      ? `Your withdrawal unlocks on ${unlockDate}`
      : 'Your withdrawal is waiting to unlock',
    detail:
      'Your tab is closing. Tips you already sent settle first, and quick tips are off. A deposit before then cancels the withdrawal.',
  }),
  withdrawalReady: {
    title: 'Your balance is ready to withdraw',
    detail: 'The waiting period is over. Withdraw to move it to your wallet.',
  },
  networkBusy: {
    title: 'Stellar testnet is busy',
    detail: 'Nothing changed. Try again in a minute.',
  },
} as const

export const NOTICE_ACTION = {
  insufficientWallet: 'Choose a smaller amount',
  insufficientTab: 'Top up',
  sessionKey: 'Set up quick tips',
  sessionKeyExpired: 'Renew quick tips',
  settleOwn: 'Settle it yourself',
  splits: 'Tip from wallet',
  withdraw: 'Withdraw',
} as const
