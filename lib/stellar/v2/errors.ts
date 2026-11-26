/**
 * Contract error codes to user messages (docs/architecture/v2/06-app-integration.md,
 * section 6.1 step 3). Covers Core (1 to 21), Tab (30 to 47), the article NFT
 * (70 to 76) and the OpenZeppelin codes the contracts use (pause 1000+,
 * access control 2000+, role transfer 2200+, non-fungible token 200+).
 *
 * Codes come from the generated bindings, so a renamed or added code fails
 * the unit test that compares both lists.
 */
import { CoreError } from './bindings/core'
import { TabError } from './bindings/tab'
import { NftError, NonFungibleTokenError } from './bindings/nft'

type Entry = { name: string; message: string }

const CORE: Record<number, string> = {
  1: 'This article is not registered on Stellar yet.',
  2: 'This article is already registered on Stellar.',
  3: 'The article’s content anchor is missing. Refresh the page and try again.',
  4: 'The tip shares are not valid. Check that they add up to 100%.',
  5: 'An article can share tips with at most 4 co-authors.',
  6: 'This token is not accepted for tips.',
  7: 'Enter an amount above zero.',
  8: 'This tip is below the minimum.',
  9: 'You cannot tip an article that pays you.',
  10: 'This tip was already sent.',
  11: 'Add at least one tip.',
  12: 'Too many tips in one payment. Send fewer at once.',
  13: 'The amount is too large.',
  14: 'This upgrade has already run.',
  15: 'No more tokens can be added.',
  16: 'The minimum tip is too low.',
  17: 'This wallet already receives tips for this article.',
  18: 'The admin role cannot be given up.',
  19: 'No move to this wallet is waiting, or it has expired. Start the move again.',
  20: 'The move expiry is not valid. Start the move again.',
  21: 'Disable the token before removing it.',
}

const TAB: Record<number, string> = {
  30: 'Enter an amount above zero.',
  31: 'This deposit is below the minimum.',
  32: 'This deposit would take your tab over its limit.',
  33: 'The quick-tip key expiry is not valid.',
  34: 'The quick-tip key is not valid.',
  35: 'This quick-tip key was not found.',
  36: 'Nothing to settle.',
  37: 'Too many items in one settlement.',
  38: 'This receipt belongs to another writer.',
  39: 'Nothing to withdraw.',
  40: 'A withdrawal is already in progress.',
  41: 'Your withdrawal is not unlocked yet.',
  42: 'No withdrawal is in progress.',
  43: 'The amount is too large.',
  44: 'This upgrade has already run.',
  45: 'The limits are not valid.',
  46: 'The admin role cannot be given up.',
  47: 'This tab does not exist.',
}

const NFT: Record<number, string> = {
  70: 'This article has not reached the tip total needed to mint.',
  71: 'An NFT already exists for this article.',
  72: 'The mint threshold is not valid.',
  73: 'This upgrade has already run.',
  74: 'This NFT does not exist.',
  75: 'The royalty cannot be changed.',
  76: 'The admin role cannot be given up.',
}

const OPEN_ZEPPELIN: Record<number, string> = {
  200: 'This NFT does not exist.',
  201: 'This wallet does not own the NFT.',
  202: 'This wallet is not approved to move the NFT.',
  1000: 'Payments are paused for maintenance. Try again later.',
  2000: 'This wallet is not allowed to do that.',
}

function table(
  source: Record<number, { message: string }>,
  messages: Record<number, string>,
  fallback: string
): Map<number, Entry> {
  const out = new Map<number, Entry>()
  for (const [code, { message: name }] of Object.entries(source)) {
    const n = Number(code)
    out.set(n, { name, message: messages[n] ?? fallback })
  }
  return out
}

const GENERIC = 'Stellar refused the transaction. Nothing was sent.'

export const CONTRACT_ERRORS: ReadonlyMap<number, Entry> = new Map([
  ...table(CoreError, CORE, GENERIC),
  ...table(TabError, TAB, GENERIC),
  ...table(NftError, NFT, GENERIC),
  ...table(NonFungibleTokenError, OPEN_ZEPPELIN, GENERIC),
  [1000, { name: 'EnforcedPause', message: OPEN_ZEPPELIN[1000]! }],
  [1001, { name: 'ExpectedPause', message: GENERIC }],
  [2000, { name: 'Unauthorized', message: OPEN_ZEPPELIN[2000]! }],
])

/** The contract error code in a simulation or result message, if any. */
export function contractErrorCode(text: string): number | null {
  const match = /Error\(Contract, #(\d+)\)/.exec(text)
  return match ? Number(match[1]) : null
}

export type V2ErrorInfo = {
  /** Contract error code, when the failure came from a contract. */
  code: number | null
  /** Binding name of the code, e.g. `AlreadyRegistered`. */
  name: string | null
  message: string
}

/** A user message for a contract error code. */
export function contractErrorMessage(code: number): V2ErrorInfo {
  const entry = CONTRACT_ERRORS.get(code)
  return entry
    ? { code, name: entry.name, message: entry.message }
    : { code, name: null, message: GENERIC }
}

/** A user message for any simulation, send or result error text. */
export function describeContractFailure(text: string): V2ErrorInfo {
  const code = contractErrorCode(text)
  if (code !== null) return contractErrorMessage(code)
  if (/insufficient|underfunded|balance/i.test(text)) {
    return {
      code: null,
      name: null,
      message: 'This wallet needs more testnet XLM to pay the network fee.',
    }
  }
  if (/txBadSeq|bad_seq/i.test(text)) {
    return {
      code: null,
      name: null,
      message: 'The wallet’s account changed. Try again.',
    }
  }
  return { code: null, name: null, message: GENERIC }
}
