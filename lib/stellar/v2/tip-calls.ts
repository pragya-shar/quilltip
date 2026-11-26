/**
 * Core tip calls from a Convex prepare result
 * (docs/architecture/v2/05-flows-and-admin.md, sections 5.2 to 5.4).
 *
 * `tipsV2.prepareDirectTip`, `prepareHighlightTip` and `prepareBatch` return
 * the values of each Core `TipInput` as strings (hex bytes and a decimal
 * i128). This module checks them against the client's configuration and the
 * request the reader made, then encodes `Core.tip` (one item) or
 * `Core.tip_batch` (several) with the generated Core bindings' contract spec.
 * A wrong network, contract, token, item count, article or passage is refused
 * before anything is signed.
 */
import { StrKey, type xdr } from '@stellar/stellar-sdk'
import type { PreparedTip } from '@/convex/tipsV2'
import { Client as CoreClient } from './bindings/core'
import { bytesToHex } from '../bytes'
import { highlightId } from './ids'
import type { ContractCall } from './tx'

/** The fields of the prepare response that the call and the checks use. */
export type PreparedTipCall = Pick<
  PreparedTip,
  | 'method'
  | 'networkPassphrase'
  | 'contractId'
  | 'tokenContractId'
  | 'tipperAddress'
  | 'maxTime'
> & {
  items: Array<
    Pick<PreparedTip['items'][number], 'articleId' | 'tipInput'> & {
      quote: Pick<PreparedTip['items'][number]['quote'], 'grossBaseUnits'>
    }
  >
}

/** What the reader asked for, item by item, in the order sent to prepare. */
export type RequestedTipItem = {
  articleId: string
  /** `article_id` hex from `getTipEligibility`, when the client has it. */
  articleKey?: string | null
  /** The passage, for a highlight tip; null or absent for an article tip. */
  highlight?: {
    articleSlug: string
    text: string
    startOffset: number
    endOffset: number
  } | null
}

export type TipCallExpectation = {
  networkPassphrase: string
  coreContractId: string | null
  tokenContractId: string | null
  items: readonly RequestedTipItem[]
  /** Unix milliseconds; defaults to `Date.now()`. */
  now?: number
}

export class TipCallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TipCallError'
  }
}

/** Core caps a batch at 10 items (02-core-contract.md, section 2.1). */
export const MAX_TIP_ITEMS = 10
/** The server sets `maxTime` 300 s ahead; allow for clock skew. */
const MAX_TIME_AHEAD_SECONDS = 900
const I128_MAX = (BigInt(1) << BigInt(127)) - BigInt(1)

function isHex(value: unknown, bytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.length === bytes * 2 &&
    /^[0-9a-f]+$/.test(value)
  )
}

/** Lower-case hex of an exact length to bytes. */
export function hexBytes(hex: string, bytes: number, field: string): Uint8Array {
  if (!isHex(hex, bytes)) {
    throw new TipCallError(`${field} must be ${bytes} bytes of hex.`)
  }
  const out = new Uint8Array(bytes)
  for (let i = 0; i < bytes; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** A positive i128 from a decimal string of base units. */
export function baseUnits(value: string, field: string): bigint {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,38}$/.test(value)) {
    throw new TipCallError(`${field} must be a positive whole number.`)
  }
  const amount = BigInt(value)
  if (amount > I128_MAX) throw new TipCallError(`${field} is too large.`)
  return amount
}

/**
 * Checks a prepare response against the client's configuration and the
 * request. Throws `TipCallError` with a message the reader can see.
 */
export function checkPreparedTip(
  prepared: PreparedTipCall,
  expected: TipCallExpectation
): void {
  if (prepared.networkPassphrase !== expected.networkPassphrase) {
    throw new TipCallError(
      'QuillTip prepared this tip for another network. Nothing was signed.'
    )
  }
  if (
    !expected.coreContractId ||
    prepared.contractId !== expected.coreContractId
  ) {
    throw new TipCallError(
      'QuillTip prepared this tip for another contract. Nothing was signed.'
    )
  }
  if (
    !expected.tokenContractId ||
    prepared.tokenContractId !== expected.tokenContractId
  ) {
    throw new TipCallError(
      'QuillTip prepared this tip in another token. Nothing was signed.'
    )
  }
  if (!StrKey.isValidEd25519PublicKey(prepared.tipperAddress)) {
    throw new TipCallError('The tipping address is not valid.')
  }
  const count = prepared.items.length
  if (count < 1 || count > MAX_TIP_ITEMS || count !== expected.items.length) {
    throw new TipCallError(
      'The prepared tips do not match your request. Nothing was signed.'
    )
  }
  if (prepared.method !== (count === 1 ? 'tip' : 'tip_batch')) {
    throw new TipCallError(
      'The prepared tips do not match your request. Nothing was signed.'
    )
  }
  const nowSeconds = Math.floor((expected.now ?? Date.now()) / 1000)
  if (
    !Number.isSafeInteger(prepared.maxTime) ||
    prepared.maxTime <= nowSeconds ||
    prepared.maxTime > nowSeconds + MAX_TIME_AHEAD_SECONDS
  ) {
    throw new TipCallError(
      'This tip request has timed out. Start again. Nothing was signed.'
    )
  }
  const refs = new Set<string>()
  prepared.items.forEach((item, index) => {
    const want = expected.items[index]!
    const input = item.tipInput
    if (item.articleId !== want.articleId) {
      throw new TipCallError('The prepared tips are in another order.')
    }
    hexBytes(input.article_id, 32, 'article_id')
    if (want.articleKey && input.article_id !== want.articleKey) {
      throw new TipCallError(
        'The article ID does not match the registered article. Nothing was signed.'
      )
    }
    const amount = baseUnits(input.amount, 'amount')
    if (amount.toString() !== item.quote.grossBaseUnits) {
      throw new TipCallError('The tip amount does not match the quote.')
    }
    hexBytes(input.client_ref, 16, 'client_ref')
    if (refs.has(input.client_ref)) {
      throw new TipCallError('Two tips share one reference.')
    }
    refs.add(input.client_ref)
    const passage = want.highlight ?? null
    if (passage === null) {
      if (input.highlight_id !== null) {
        throw new TipCallError(
          'The prepared tip names a passage you did not choose.'
        )
      }
      return
    }
    if (input.highlight_id === null) {
      throw new TipCallError('The prepared tip is missing the passage.')
    }
    hexBytes(input.highlight_id, 32, 'highlight_id')
    const local = bytesToHex(
      highlightId(
        passage.articleSlug,
        passage.startOffset,
        passage.endOffset,
        passage.text
      )
    )
    if (input.highlight_id !== local) {
      throw new TipCallError(
        'The passage ID does not match the passage you chose. Nothing was signed.'
      )
    }
  })
}

let spec: CoreClient['spec'] | null = null
function coreSpec(contractId: string, networkPassphrase: string) {
  // The spec is the same for every Core instance; no network is contacted.
  spec ??= new CoreClient({
    contractId,
    networkPassphrase,
    rpcUrl: 'http://localhost',
    allowHttp: true,
  }).spec
  return spec
}

/** The binding arguments of one `TipInput`. */
function tipInput(item: PreparedTipCall['items'][number]) {
  const input = item.tipInput
  return {
    amount: baseUnits(input.amount, 'amount'),
    article_id: hexBytes(input.article_id, 32, 'article_id'),
    client_ref: hexBytes(input.client_ref, 16, 'client_ref'),
    highlight_id:
      input.highlight_id === null
        ? null
        : hexBytes(input.highlight_id, 32, 'highlight_id'),
  }
}

/**
 * The Core invocation for a prepared tip: `tip` for one item, `tip_batch`
 * for several. The tipper is the transaction source, and the time bounds are
 * `[0, maxTime]` (`tx.ts`).
 */
export function tipContractCall(prepared: PreparedTipCall): ContractCall {
  const method = prepared.method
  let args: Record<string, unknown>
  if (method === 'tip') {
    if (prepared.items.length !== 1) {
      throw new TipCallError('A single tip has exactly one item.')
    }
    const item = tipInput(prepared.items[0]!)
    args = {
      tipper: prepared.tipperAddress,
      article_id: item.article_id,
      token: prepared.tokenContractId,
      amount: item.amount,
      highlight_id: item.highlight_id,
      client_ref: item.client_ref,
    }
  } else if (method === 'tip_batch') {
    if (prepared.items.length < 2 || prepared.items.length > MAX_TIP_ITEMS) {
      throw new TipCallError('A batch has 2 to 10 items.')
    }
    args = {
      tipper: prepared.tipperAddress,
      token: prepared.tokenContractId,
      items: prepared.items.map(tipInput),
    }
  } else {
    throw new TipCallError('Unknown tip method.')
  }
  const scArgs: xdr.ScVal[] = coreSpec(
    prepared.contractId,
    prepared.networkPassphrase
  ).funcArgsToScVals(method, args)
  return {
    contractId: prepared.contractId,
    method,
    args: scArgs,
    source: prepared.tipperAddress,
    maxTime: prepared.maxTime,
    networkPassphrase: prepared.networkPassphrase,
  }
}
