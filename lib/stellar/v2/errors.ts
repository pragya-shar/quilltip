/**
 * Contract error codes to user messages (docs/architecture/v2/06-app-integration.md,
 * section 6.1 step 3). Covers Core (1 to 21), Tab (30 to 47), the article NFT
 * (70 to 76), the OpenZeppelin codes the contracts use (pause 1000+,
 * access control 2000+, role transfer 2200+, non-fungible token 200+) and
 * the Stellar Asset Contract that moves XLM (1 to 15).
 *
 * Token codes overlap Core codes, so a code is decoded only together with
 * the contract that raised it, read from the simulation's diagnostic
 * events. When that contract is not known, the failure is generic.
 *
 * Codes come from the generated bindings, so a renamed or added code fails
 * the unit test that compares both lists.
 */
import { CoreError } from './bindings/core'
import { TabError } from './bindings/tab'
import { NftError, NonFungibleTokenError } from './bindings/nft'

type Entry = { name: string; message: string }

/** The contracts a failure can come from. */
export type ContractKind = 'core' | 'tab' | 'nft' | 'token'

const CORE: Record<number, string> = {
  1: 'This article is not registered on Stellar yet.',
  2: 'Tips are already on for this article. Refresh the page to see them.',
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

/**
 * Stellar Asset Contract errors (soroban-env-host `ContractError`). The
 * native XLM contract raises these during a tip, a deposit or a withdrawal.
 */
const TOKEN: Record<number, Entry> = {
  2: { name: 'OperationNotSupportedError', message: '' },
  3: { name: 'AlreadyInitializedError', message: '' },
  4: { name: 'UnauthorizedError', message: '' },
  5: { name: 'AuthenticationError', message: '' },
  6: {
    name: 'AccountMissingError',
    message: 'This wallet’s account is not on Stellar testnet. Fund it first.',
  },
  7: { name: 'AccountIsNotClassic', message: '' },
  8: { name: 'NegativeAmountError', message: 'Enter an amount above zero.' },
  9: { name: 'AllowanceError', message: '' },
  10: {
    name: 'BalanceError',
    message: 'This wallet does not have enough testnet XLM for this payment.',
  },
  11: { name: 'BalanceDeauthorizedError', message: '' },
  12: { name: 'OverflowError', message: 'The amount is too large.' },
  13: { name: 'TrustlineMissingError', message: '' },
  14: {
    name: 'InsufficientAccountReserve',
    message: 'This wallet does not have enough testnet XLM for this payment.',
  },
  15: { name: 'TooManyAccountSubentries', message: '' },
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

const GENERIC = 'Stellar testnet refused the transaction. Nothing was sent.'

const SHARED: ReadonlyArray<[number, Entry]> = [
  [1000, { name: 'EnforcedPause', message: OPEN_ZEPPELIN[1000]! }],
  [1001, { name: 'ExpectedPause', message: GENERIC }],
  [2000, { name: 'Unauthorized', message: OPEN_ZEPPELIN[2000]! }],
]

/** QuillTip contract codes. The ranges do not overlap between contracts. */
export const CONTRACT_ERRORS: ReadonlyMap<number, Entry> = new Map([
  ...table(CoreError, CORE, GENERIC),
  ...table(TabError, TAB, GENERIC),
  ...table(NftError, NFT, GENERIC),
  ...table(NonFungibleTokenError, OPEN_ZEPPELIN, GENERIC),
  ...SHARED,
])

const BY_CONTRACT: Record<ContractKind, ReadonlyMap<number, Entry>> = {
  core: new Map([...table(CoreError, CORE, GENERIC), ...SHARED]),
  tab: new Map([...table(TabError, TAB, GENERIC), ...SHARED]),
  nft: new Map([
    ...table(NftError, NFT, GENERIC),
    ...table(NonFungibleTokenError, OPEN_ZEPPELIN, GENERIC),
    ...SHARED,
  ]),
  token: new Map(
    Object.entries(TOKEN).map(([code, entry]) => [
      Number(code),
      { name: entry.name, message: entry.message || GENERIC },
    ])
  ),
}

/** The contract IDs of this deployment, from `V2ClientConfig`. */
export type KnownContracts = Partial<Record<ContractKind, string | null>>

/** Which deployment contract an address is, if any. */
export function contractKindOf(
  contractId: string | null,
  contracts: KnownContracts
): ContractKind | null {
  if (!contractId) return null
  for (const kind of ['core', 'tab', 'nft', 'token'] as const) {
    if (contracts[kind] && contracts[kind] === contractId) return kind
  }
  return null
}

type JsonEvent = {
  event?: {
    contract_id?: string | null
    body?: { v0?: { topics?: unknown[] } }
  }
}

function asJson(event: unknown): JsonEvent | null {
  if (!event || typeof event !== 'object') return null
  const withJson = event as { toJSON?: () => unknown }
  const value =
    typeof withJson.toJSON === 'function' ? withJson.toJSON() : event
  return value && typeof value === 'object' ? (value as JsonEvent) : null
}

/**
 * The contract that raised a contract error, from simulation diagnostic
 * events (chronological). The first `error` event with a contract code is
 * the origin; callers that only pass the failure up emit later ones.
 */
export function raisingContract(events: readonly unknown[]): string | null {
  for (const raw of events) {
    const json = asJson(raw)
    const topics = json?.event?.body?.v0?.topics
    if (!Array.isArray(topics) || topics.length < 2) continue
    const [first, second] = topics as Array<Record<string, unknown>>
    if (first?.symbol !== 'error') continue
    const error = second?.error as { contract?: unknown } | undefined
    if (typeof error?.contract !== 'number') continue
    return json?.event?.contract_id ?? null
  }
  return null
}

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
  /** The contract that raised the code, when it is one of this deployment's. */
  contract: ContractKind | null
  message: string
}

/** Name for a send or fee failure caused by a low XLM balance. */
export const INSUFFICIENT_FEE_BALANCE = 'InsufficientFeeBalance'

/**
 * A user message for a contract error code raised by `contract`. A code
 * outside that contract's table, or from an unknown contract, is generic.
 */
export function contractErrorMessage(
  code: number,
  contract: ContractKind | null
): V2ErrorInfo {
  const entry = contract ? BY_CONTRACT[contract].get(code) : undefined
  return entry
    ? { code, name: entry.name, contract, message: entry.message }
    : { code, name: null, contract, message: GENERIC }
}

/** Where a contract error came from, read from the simulation. */
export type FailureSource = {
  /** The raising contract's address, from `raisingContract(events)`. */
  raisedBy: string | null
  contracts: KnownContracts
}

/**
 * A user message for any simulation, send or result error text. A contract
 * code is decoded only when `source` names a known raising contract.
 */
export function describeContractFailure(
  text: string,
  source?: FailureSource
): V2ErrorInfo {
  const code = contractErrorCode(text)
  if (code !== null) {
    const kind = source
      ? contractKindOf(source.raisedBy, source.contracts)
      : null
    return contractErrorMessage(code, kind)
  }
  if (/insufficient|underfunded|balance/i.test(text)) {
    return {
      code: null,
      name: INSUFFICIENT_FEE_BALANCE,
      contract: null,
      message: 'This wallet needs more testnet XLM to pay the network fee.',
    }
  }
  if (/txBadSeq|bad_seq/i.test(text)) {
    return {
      code: null,
      name: null,
      contract: null,
      message: 'The wallet’s account changed. Try again.',
    }
  }
  return { code: null, name: null, contract: null, message: GENERIC }
}
