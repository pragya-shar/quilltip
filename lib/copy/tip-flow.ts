/**
 * Copy for the v2 tip flows (article, highlight and basket) that the shared
 * payment kit does not define. The kit's own states and copy are in
 * lib/copy/payment-states.ts; the flow rules are in
 * docs/design-system/tip-flows.md.
 */
import type { CopyBlock } from '@/lib/copy/payment-states'
import { SITE_NAME } from '@/lib/seo/siteMetadata'

export const TIP_DIALOG = {
  articleTitle: 'Tip this article',
  highlightTitle: 'Tip this passage',
  description: (authorName: string) =>
    `Your tip goes to ${authorName} on Stellar testnet.`,
  amountLegend: 'Choose an amount',
  customLabel: 'Other amount',
  customHint: (min: string, max: string) =>
    `From ${min} to ${max}. The XLM amount is set when you send.`,
  messageLabel: 'Note to the writer (optional)',
  send: 'Send tip',
  addToBasket: 'Add to tip basket',
  added: 'Added to your tip basket',
  openBasket: 'Open basket',
  trigger: 'Tip this article',
  triggerHighlight: 'Tip this passage',
  checkingLast: 'Your last tip is being checked.',
  viewLast: 'View',
} as const

export const AMOUNT_ERRORS = {
  empty: 'Choose an amount.',
  invalid: 'Enter an amount in dollars, for example 1.50.',
  belowMinimum: (min: string) => `The smallest tip right now is ${min}.`,
  aboveMaximum: (max: string) => `The largest tip is ${max}.`,
} as const

/** Prepare refusals that have no kit notice of their own. */
export const PREPARE_REFUSAL_COPY = {
  belowMinimum: (min: string | null): CopyBlock => ({
    title: 'This tip is below the minimum',
    detail: min
      ? `The smallest tip right now is ${min}. Choose a larger amount. Nothing was paid.`
      : 'Choose a larger amount. Nothing was paid.',
  }),
  invalidAmount: {
    title: 'Choose another amount',
    detail: 'A tip is from $0.01 to $100.00. Nothing was paid.',
  },
  rateLimited: (seconds: number | null): CopyBlock => ({
    title: 'Too many tips in a short time',
    detail:
      seconds && seconds > 0
        ? `Wait ${seconds} seconds, then try again. Nothing was paid.`
        : 'Wait a moment, then try again. Nothing was paid.',
  }),
  noPrice: {
    title: 'No XLM price right now',
    detail: `${SITE_NAME} can’t convert this amount yet. Try again in a minute. Nothing was paid.`,
  },
  v2Disabled: {
    title: 'Tips on Stellar testnet are not on here',
    detail: `This ${SITE_NAME} site has not turned them on. Nothing was paid.`,
  },
  notConfigured: {
    title: 'Tips are not set up on this site',
    detail: 'Try again later. Nothing was paid.',
  },
  selfTip: {
    title: 'You can’t tip your own article',
    detail: 'Tips for this article come to you. Nothing was paid.',
  },
  highlightInvalid: {
    title: 'This passage changed',
    detail: 'Select the passage again, then tip it. Nothing was paid.',
  },
  batchTooLarge: {
    title: 'Too many tips for one payment',
    detail:
      'One payment holds up to 10 tips and 24 transfers. Remove a tip, then pay. Nothing was paid.',
  },
  batchEmpty: {
    title: 'Your tip basket is empty',
    detail: 'Add a tip first.',
  },
  generic: {
    title: `${SITE_NAME} could not prepare this tip`,
    detail: 'Try again in a minute. Nothing was paid.',
  },
  offline: {
    title: `${SITE_NAME} could not be reached`,
    detail: 'Check your connection, then try again. Nothing was paid.',
  },
  checkFailed: (detail: string): CopyBlock => ({
    title: `This request does not match ${SITE_NAME}’s settings`,
    detail,
  }),
  wrongAccount: (expected: string, actual: string): CopyBlock => ({
    title: `Switch your wallet to ${expected}`,
    detail: `Tips are sent from your linked wallet, ${expected}. Your wallet is on ${actual}. Nothing was signed.`,
  }),
} as const

/** The tip form's code did not load (offline, or a deploy replaced it). */
export const TIP_CODE_FAILED = {
  title: 'The tip form couldn’t load',
  detail: 'Check your connection, then try again. Nothing was sent.',
  retry: 'Try again',
} as const

export const BASKET_COPY = {
  title: 'Tip basket',
  description:
    'Send several tips in one payment. You approve once in your wallet.',
  trigger: (count: number) =>
    count === 1 ? 'Tip basket, 1 tip' : `Tip basket, ${count} tips`,
  /** The basket's tips were sent; the result is still to be seen. */
  triggerSent: 'Tip basket, tips sent',
  /** A basket row whose article title is not known. */
  untitled: (author: string) => `An article by ${author}`,
  empty: 'Your tip basket is empty. Add a tip from an article or a passage.',
  pay: (count: number) => (count === 1 ? 'Send 1 tip' : `Send ${count} tips`),
  remove: 'Remove',
  removeLabel: (title: string) => `Remove the tip for ${title}`,
  clear: 'Clear basket',
  limits: (items: number, transfers: number) =>
    `${items} of 10 tips · ${transfers} of 24 transfers`,
  itemArticle: 'Article',
  itemPassage: 'Passage',
  // Why an item cannot be added.
  fullItems: {
    title: 'Your basket is full',
    detail: 'One payment holds up to 10 tips. Send these first.',
  },
  fullTransfers: (needed: number, left: number): CopyBlock => ({
    title: 'This tip doesn’t fit in one payment',
    detail: `It needs ${needed} transfers and ${left} are left of 24. Send your basket first.`,
  }),
  duplicate: {
    title: 'Already in your basket',
    detail:
      'To change its amount, remove it from your basket, then add it again.',
  },
  unavailable: {
    title: 'This article can’t take tips right now',
    detail: 'It can’t be added to your basket.',
  },
  busy: {
    title: 'Your basket is being paid',
    detail: 'Wait for the result, then add more tips.',
  },
  itemUnavailableNote: 'Can’t take tips right now',
  itemPaidNote: 'Paid',
} as const
