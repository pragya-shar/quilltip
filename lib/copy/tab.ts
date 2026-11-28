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
    'This Quilltip deployment has not turned on tips on Stellar. Nothing was sent.',
} as const

export const TAB_BALANCE = {
  heading: 'Balance',
  free: 'Free to tip',
  freeNote: 'What quick tips can use now.',
  /** The same figure while the tab is closing: quick tips are off (#547). */
  closingFree: 'Comes back to you',
  /**
   * Under the closing figure: when it unlocks and what the reader does then
   * (#671). The date is an estimate from ledger times.
   */
  closingFreeNote: (date: string | null, ready: boolean) =>
    ready
      ? 'Unlocked. Choose Withdraw to move it to your wallet.'
      : `${TAB_CLOSE.unlocks(date)}. Come back then and choose Withdraw to move it to your wallet. Quick tips are off while your tab closes.`,
  settling: 'Settling',
  settlingNote: 'Tips sent, not settled on chain yet.',
  confirmed: 'Tab balance',
  confirmedNote: 'Held for you in the Tab contract.',
} as const

export const TAB_EMPTY = {
  title: 'You don’t have a tab yet',
  detail:
    'A tab is a prepaid balance for tips. You approve one deposit in your wallet, and this device can then tip without asking again. You can close it and take back what is left at any time.',
  /** The open was sent; its first events are on their way. */
  openingTitle: 'Opening your tab',
  openingDetail:
    'Stellar testnet is confirming your deposit and this device’s key. This page updates by itself when it is done. There is nothing else to do.',
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
  walletShort: (spendable: string, min: string) =>
    `Your wallet can spend ${spendable}, less than the smallest deposit of ${min}. Add test XLM to your wallet, then try again.`,
  /** `room` is null when the tab is at its limit. */
  tabFull: (room: string | null, min: string) =>
    room === null
      ? 'Your tab is at its limit, so it can’t take more.'
      : `Your tab can take ${room} more, less than the smallest deposit of ${min}.`,
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
    'This device’s tab history did not match Quilltip’s, so it stopped using its key. Your balance is safe and tips you already sent still settle. Set up quick tips again to keep tipping.',
  storageTitle: 'This browser can’t keep a quick-tip key',
  storageDetail:
    'Its storage is blocked, which some private windows do. Tip from your wallet, or use a normal window.',
  revokedTitle: 'Quick tips are off for this device',
  revokedDetail:
    'You revoked its key. Tips you already sent still settle. Set up quick tips again to keep tipping from your tab.',
  otherDeviceTitle: 'Quick tips are set up on another device',
  otherDeviceDetail:
    'Your tab has a quick-tip key on another device or browser. Set up quick tips here too, with one wallet approval.',
  uncheckedTitle: 'Quick tips can’t be checked right now',
  uncheckedDetail:
    'Quilltip could not reach Stellar testnet to check this device’s key, so quick tips wait. Try again in a minute, or tip from your wallet.',
  paused:
    'Setting up quick tips is paused while Quilltip accepts none. You can still revoke a key.',
  none: 'No quick-tip keys yet.',
} as const

export const TAB_HISTORY = {
  heading: 'Recent tab tips',
  empty: 'Tips you send from your tab show here, with when they settle.',
  highlight: 'Highlight',
  to: (name: string) => `To ${name}`,
  readMore: 'Read more',
  /** The settler's rule (convex/lib/chain/settler.ts), not a fixed wait. */
  accepted: 'Settles at 5 XLM to this writer, or after 6 hours',
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
  nothingLeft: 'Nothing is left to withdraw.',
} as const

export const TAB_SETTLEMENT = {
  offTitle: 'Quick tips are paused on Stellar testnet',
  /** No tab, or a closed one: nothing to open while quick tips are off. */
  offNoTab:
    'Quilltip is not accepting tips from tabs right now, so opening a tab is paused too. You can still tip any article from your wallet.',
  /** An open or closing tab. */
  offTab:
    'Quilltip is not accepting tips from tabs right now, so you can’t tip from your tab or add funds to it. You can still tip from your wallet, and you can close your tab and withdraw what is left.',
  offWaiting:
    'Tips you already sent from your tab are recorded. They stay counted against your balance and settle when quick tips are back.',
  offWriterTitle: 'Tab settlement is paused on Stellar testnet',
  offWriter:
    'Quilltip is not settling tab tips right now. Tips readers already sent you are recorded and settle once it is back on. What is ready to collect stays yours to collect.',
} as const

export const TAB_TIP = {
  heading: 'Tip from your tab',
  noPrompt:
    'No wallet prompt. Quilltip settles it on Stellar testnet once your unsettled tips to this writer reach 5 XLM, or when the oldest is 6 hours old.',
  /** After the amount: "12.5 XLM free in your tab". */
  freeSuffix: 'free in your tab',
  amountLabel: 'Tip amount',
  send: (amount: string) => `Tip ${amount} from tab`,
  sending: 'Sending…',
  another: 'Send another',
  unavailable: 'Quick tips are unavailable right now',
  settlementOff:
    'Quilltip is not accepting tips from tabs on Stellar testnet right now. Tip from your wallet instead.',
  unconfirmedTitle: 'We could not confirm this tip',
  unconfirmedDetail:
    'The connection dropped after it was sent. It may have been accepted: check your tab before sending it again.',
  unreachableTitle: 'Quilltip could not be reached',
  unreachableDetail: 'Check your connection and try again. Nothing was paid.',
  stoppedTitle: 'This tip was not signed',
  tipFromWallet: 'Tip from wallet',
} as const

export const COLLECT = {
  heading: 'Tab earnings',
  intro:
    'Readers with a tab tip you without a wallet prompt. Quilltip settles those tips on Stellar testnet, and you collect them to your wallet when you choose.',
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
  shortfall: (n: number, amount: string) =>
    n === 1
      ? `${amount} of what is waiting is from one reader whose tab ran short. It settles after that reader adds funds to their tab.`
      : `${amount} of what is waiting is from ${n} readers whose tabs ran short. It settles after they add funds to their tabs.`,
  feeExplainer:
    'The fee and your share are from the settlement events on chain.',
} as const

/**
 * The tab tip section of the tip dialog (issue #546): one amount for the
 * dialog, sent from the tab or from the wallet.
 */
export const TAB_TIP_DIALOG = {
  heading: 'From your tab',
  /** After the amount: "12.5 XLM free". */
  free: 'free',
  send: (amount: string) => `Send ${amount} from your tab`,
  sending: 'Sending from your tab…',
  /** The wallet button while the tab can send. */
  sendFromWallet: 'Send from your wallet',
  /** The same, with the amount as the reader chose it (#645). */
  sendFromWalletAmount: (amount: string) =>
    `Send ${amount} tip from your wallet`,
  walletHeading: 'From your wallet',
  noTab: 'Tip without a wallet prompt from a prepaid tab.',
  loading: 'Checking your tab…',
  /** Under the amount field while a quick tip is on offer. */
  maxHint: (max: string) => `Tab tips go up to ${max} at today’s XLM price.`,
  aboveMax: (max: string) => ({
    title: `Tab tips go up to ${max} right now`,
    detail: `That is the most a tab tip can be at today’s XLM price. Choose ${max} or less, or send this amount from your wallet.`,
  }),
  dailyLimit: (left: string) => ({
    title: 'This is over today’s tab limit',
    detail: `You can tip ${left} more from your tab today. Choose a smaller amount, or send this one from your wallet.`,
  }),
  keyLimit: (left: string) => ({
    title: 'This is over this device’s quick-tip limit',
    detail: `This device can tip ${left} more from your tab. Set up quick tips again to raise it, or send this from your wallet.`,
  }),
  chooseAmount: 'Choose an amount first.',
  done: 'Done',
} as const
