/**
 * Copy owned by the tab screens (issue #449). State copy shared by every
 * payment flow lives in lib/copy/payment-states.ts (the kit); this file holds
 * only what the tab and collect surfaces add. Amounts arrive formatted.
 */

export const TAB_PAGE = {
  title: 'Tab',
  intro:
    'Prepay once, then tip from this device without a wallet prompt. Your tab lives on Stellar testnet.',
  loading: 'Loading your tab…',
  unavailableTitle: 'Tabs are not available on this site yet',
  unavailableDetail:
    'This QuillTip deployment has not turned on tips on Stellar. Nothing was sent.',
  gateHeading: 'Before you open a tab',
} as const

export const TAB_BALANCE = {
  heading: 'Balance',
  free: 'Free to tip',
  freeNote: 'What quick tips can use now.',
  settling: 'Settling',
  settlingNote: 'Tips sent, not settled on chain yet.',
  confirmed: 'Tab balance',
  confirmedNote: 'Held for you in the Tab contract.',
} as const

export const TAB_EMPTY = {
  title: 'You don’t have a tab yet',
  detail:
    'A tab is a prepaid balance for tips. You approve one deposit in your wallet, and this device can then tip without asking again. You can close it and take back what is left at any time.',
  closedTitle: 'Your tab is closed',
  closedDetail:
    'Your balance went back to your wallet. Open a tab again to tip without a wallet prompt.',
} as const

export const TAB_ACTIONS = {
  open: 'Open a tab',
  topUp: 'Top up',
  cancel: 'Cancel',
  setUpKey: 'Set up quick tips',
  renew: 'Renew quick tips',
  revoke: 'Revoke',
  closeTab: 'Close tab',
  confirmClose: 'Close tab and start the wait',
  keepOpen: 'Keep my tab open',
  manage: 'Manage your tab',
} as const

export const TAB_FUND_FORM = {
  openHeading: 'Open a tab',
  topUpHeading: 'Top up your tab',
  amountLabel: 'Amount in XLM',
  presetsLabel: 'Suggested amounts',
  range: (min: string, max: string) => `Between ${min} and ${max}.`,
  rangeMin: (min: string) => `At least ${min}.`,
  spendable: (spendable: string, balance: string, reserve: string) =>
    `Your wallet can spend ${spendable}. Stellar keeps ${reserve} of its ${balance} balance in reserve, and the network fee comes on top.`,
  spendableUnknown:
    'Your wallet keeps a small reserve on Stellar, and the network fee comes on top.',
  after: (balance: string) => `Your tab will hold ${balance}.`,
  keyNote:
    'Opening also sets up quick tips on this device for 7 days, in the same wallet approval.',
  submitOpen: (amount: string) => `Open tab with ${amount}`,
  submitTopUp: (amount: string) => `Add ${amount}`,
  cancelsWithdrawal:
    'Adding funds cancels your withdrawal. Your tab opens again.',
  errors: {
    empty: 'Enter an amount.',
    invalid: 'Enter an amount in XLM, with up to 7 decimals.',
    belowMinimum: (min: string) => `The smallest deposit is ${min}.`,
    aboveCap: (room: string) => `Your tab can take at most ${room} more.`,
    aboveSpendable: (spendable: string) =>
      `Your wallet can spend ${spendable}. Choose a smaller amount or add test XLM to your wallet.`,
  },
  cancelledWithdrawal: 'Your withdrawal was cancelled because you added funds.',
} as const

export const TAB_KEYS = {
  heading: 'Quick tips on this device',
  intro:
    'A quick-tip key lives in this browser and signs tips from your tab. It can spend only up to its limit, and only until it expires.',
  thisDevice: 'This device',
  otherDevice: 'Another device or browser',
  extractable:
    'This browser cannot lock the key away, so it is stored readable. Keep its limit small.',
  renewSoon: (date: string) =>
    `Quick tips here stop around ${date}. Renew to keep tipping without a wallet prompt.`,
  pendingTitle: 'Setting up quick tips',
  pendingDetail:
    'This browser made a key, but its registration is not confirmed. Finish it with one wallet approval, or try again later.',
  pendingAction: 'Finish setting up',
  stoppedTitle: 'Quick tips are stopped on this device',
  stoppedDetail:
    'This device’s tab history did not match QuillTip’s, so it stopped using its key. Your balance is safe and tips you already sent still settle. Set up quick tips again to keep tipping.',
  storageTitle: 'This browser can’t keep a quick-tip key',
  storageDetail:
    'Its storage is blocked, which some private windows do. Tip from your wallet, or use a normal window.',
  revokedTitle: 'Quick tips are off for this device',
  revokedDetail:
    'You revoked its key. Tips you already sent still settle. Set up quick tips again to keep tipping from your tab.',
  otherDeviceDetail:
    'Your tab has a quick-tip key on another device or browser. Set up quick tips here too, with one wallet approval.',
  limit: (limit: string, until: string) =>
    `Up to ${limit} until around ${until}.`,
  none: 'No quick-tip keys yet.',
} as const

export const TAB_HISTORY = {
  heading: 'Recent tab tips',
  empty: 'Tips you send from your tab show here, with when they settle.',
  highlight: 'Highlight',
  to: (name: string) => `To ${name}`,
  readMore: 'Read more',
  accepted: 'Settles within about 6 hours',
  viewSettlement: 'View the settlement',
} as const

export const TAB_CLOSE = {
  heading: 'Close your tab',
  intro:
    'Closing starts a waiting period of about 3 days. Tips you already sent settle first; then you withdraw what is left.',
  confirmTitle: 'Close your tab?',
  confirmDetail: (date: string | null) =>
    date
      ? `Your balance stays locked until around ${date} (an estimate from Stellar testnet ledgers). Quick tips stop now. Adding funds before then cancels the withdrawal.`
      : 'Your balance stays locked for about 3 days. Quick tips stop now. Adding funds before then cancels the withdrawal.',
  estimate: 'Estimated from ledger times; the exact moment is a ledger number.',
  timelineLabel: 'Withdrawal',
  started: 'Withdrawal started',
  unlocks: (date: string | null) =>
    date ? `Unlocks around ${date}` : 'Unlocks after about 3 days',
  ready: 'Ready to withdraw',
  withdraw: (amount: string) => `Withdraw ${amount}`,
  nothingLeft: 'Nothing is left to withdraw.',
} as const

export const TAB_SETTLEMENT = {
  offTitle: 'Settlement is switched off',
  offReader:
    'QuillTip is not settling tab tips right now. Tips you sent are recorded and stay counted against your tab until they settle. New quick tips are paused.',
  offWriter:
    'QuillTip is not settling tab tips right now. Tips readers sent you are recorded and settle once it is back on.',
} as const

export const TAB_TIP = {
  heading: 'Tip from your tab',
  noPrompt:
    'No wallet prompt. It settles on Stellar testnet within about 6 hours.',
  free: (amount: string) => `${amount} free in your tab`,
  amountLabel: 'Tip amount',
  send: (amount: string) => `Tip ${amount} from tab`,
  sending: 'Sending…',
  another: 'Send another',
  unavailable: 'Quick tips are unavailable right now',
  settlementOff:
    'QuillTip is not settling tab tips at the moment, so it accepts none. Tip from your wallet instead. Nothing was paid.',
  signIn: 'Sign in to tip from a tab.',
  verify: 'Confirm your wallet to tip from a tab.',
  unconfirmedTitle: 'We could not confirm this tip',
  unconfirmedDetail:
    'The connection dropped after it was sent. It may have been accepted: check your tab before sending it again.',
  unreachableTitle: 'QuillTip could not be reached',
  unreachableDetail: 'Check your connection and try again. Nothing was paid.',
  stoppedTitle: 'This tip was not signed',
  checkTab: 'Check your tab',
} as const

export const COLLECT = {
  heading: 'Tab earnings',
  intro:
    'Readers with a tab tip you without a wallet prompt. QuillTip settles those tips on Stellar testnet; you collect them to your wallet when you choose.',
  ready: 'Ready to collect',
  readyNote: 'In the Tab contract for you now.',
  waiting: 'Waiting for settlement',
  waitingNote: 'Your share of tips not settled yet.',
  breakdownLabel: 'Settled from tabs',
  settledGross: 'Settled from tabs',
  fee: 'Platform fee (2.5%)',
  net: 'Your share (97.5%)',
  collected: 'Collected so far',
  collect: (amount: string) => `Collect ${amount}`,
  nothing: 'Nothing to collect yet. Settled tips show here.',
  none: 'No tab tips yet. When readers tip you from a tab, they show here.',
  unpaid: (n: number) =>
    n === 1
      ? 'One reader’s tab closed or its key ran out before some tips settled, so those tips will not be paid.'
      : `${n} readers’ tabs closed or their keys ran out before some tips settled, so those tips will not be paid.`,
  feeExplainer:
    'The fee and your share are from the settlement events on chain.',
} as const
