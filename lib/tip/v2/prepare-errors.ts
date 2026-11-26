/**
 * Maps a refused v2 tip prepare (`ConvexError` data from `convex/tipsV2.ts`)
 * to what the tip flow shows. Nothing was created on chain for any of these,
 * so every refusal says nothing was paid. Pure; type-only imports, so the
 * article page can load it without payment code.
 */
import type { TipV2ErrorCode, TipV2ErrorData } from '@/convex/tipsV2'
import type { WalletGateState } from '@/lib/payments/ui-state'
import type { TipsUnavailableReason } from '@/lib/copy/tips-unavailable'
import type { CopyBlock } from '@/lib/copy/payment-states'
import { PREPARE_REFUSAL_COPY } from '@/lib/copy/tip-flow'
import { formatCents } from './amount'

/** What a refusal shows in the tip dialog or the basket. */
export type TipRefusal =
  | { kind: 'gate'; gate: WalletGateState }
  | { kind: 'paused' }
  | { kind: 'tips-unavailable'; reason: TipsUnavailableReason }
  /** A basket item that cannot be sent; `itemIndex` says which. */
  | { kind: 'basket-item-unavailable' }
  | { kind: 'refused'; copy: CopyBlock }

export type MappedRefusal = TipRefusal & {
  code: TipV2ErrorCode | 'OFFLINE' | 'UNKNOWN'
  /** The batch item the refusal is about, from 0. */
  itemIndex: number | null
  /** The amount form should show this next to the amount field. */
  amountField: boolean
}

/** Every server code and what it shows. A unit test checks the list is complete. */
export const PREPARE_REFUSALS: Record<
  TipV2ErrorCode,
  (data: Partial<TipV2ErrorData>, ctx: RefusalContext) => TipRefusal
> = {
  UNAUTHENTICATED: () => ({ kind: 'gate', gate: { kind: 'signed-out' } }),
  NO_WALLET: (_, ctx) => ({
    kind: 'gate',
    gate: ctx.connectedAddress
      ? { kind: 'unverified', address: ctx.connectedAddress }
      : { kind: 'disconnected' },
  }),
  ADDRESS_UNVERIFIED: (_, ctx) => ({
    kind: 'gate',
    gate: {
      kind: 'unverified',
      ...(ctx.connectedAddress ? { address: ctx.connectedAddress } : {}),
    },
  }),
  RATE_LIMITED: (data) => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.rateLimited(
      typeof data.retryAfterMs === 'number'
        ? Math.max(1, Math.ceil(data.retryAfterMs / 1000))
        : null
    ),
  }),
  CHAIN_V2_DISABLED: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.v2Disabled,
  }),
  CHAIN_CONFIG_MISSING: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.notConfigured,
  }),
  CHAIN_CONFIG_INVALID: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.notConfigured,
  }),
  INVALID_PREPARE: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.generic,
  }),
  REQUEST_CONFLICT: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.generic,
  }),
  INVALID_AMOUNT: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.invalidAmount,
  }),
  ARTICLE_NOT_FOUND: (_, ctx) =>
    ctx.batch
      ? { kind: 'basket-item-unavailable' }
      : { kind: 'tips-unavailable', reason: 'unregistered' },
  ARTICLE_NOT_REGISTERED: (_, ctx) =>
    ctx.batch
      ? { kind: 'basket-item-unavailable' }
      : { kind: 'tips-unavailable', reason: 'unregistered' },
  PAYOUT_ADDRESS_CHANGED: (_, ctx) =>
    ctx.batch
      ? { kind: 'basket-item-unavailable' }
      : { kind: 'tips-unavailable', reason: 'payout_outdated' },
  SELF_TIP: () => ({ kind: 'refused', copy: PREPARE_REFUSAL_COPY.selfTip }),
  BELOW_MINIMUM: (_, ctx) => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.belowMinimum(
      ctx.minTipCents ? formatCents(ctx.minTipCents) : null
    ),
  }),
  PAUSED: () => ({ kind: 'paused' }),
  PRICE_UNAVAILABLE: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.noPrice,
  }),
  BATCH_EMPTY: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.batchEmpty,
  }),
  BATCH_TOO_LARGE: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.batchTooLarge,
  }),
  HIGHLIGHT_INVALID: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.highlightInvalid,
  }),
  NOT_FOUND: () => ({ kind: 'refused', copy: PREPARE_REFUSAL_COPY.generic }),
  INVALID_STATE: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.generic,
  }),
  INVALID_TX_HASH: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.generic,
  }),
  DUPLICATE_TX: () => ({
    kind: 'refused',
    copy: PREPARE_REFUSAL_COPY.generic,
  }),
}

export type RefusalContext = {
  /** A basket payment: article refusals name the item instead. */
  batch?: boolean
  /** The connected wallet address, for the "confirm this wallet" gate. */
  connectedAddress?: string | null
  /** From `getTipEligibility`, for the below-minimum copy. */
  minTipCents?: number | null
}

const AMOUNT_CODES = new Set<string>(['BELOW_MINIMUM', 'INVALID_AMOUNT'])

function errorData(error: unknown): Partial<TipV2ErrorData> | null {
  if (!error || typeof error !== 'object') return null
  // `ConvexError` from convex/values; checked by shape so this module stays
  // free of value imports.
  const data = (error as { data?: unknown }).data
  if (
    (error as { name?: string }).name === 'ConvexError' &&
    data &&
    typeof data === 'object' &&
    typeof (data as { code?: unknown }).code === 'string'
  ) {
    return data as Partial<TipV2ErrorData>
  }
  return null
}

/** What to show for an error thrown by a v2 tip prepare call. */
export function refusalFromPrepareError(
  error: unknown,
  ctx: RefusalContext = {}
): MappedRefusal {
  const data = errorData(error)
  if (!data) {
    return {
      kind: 'refused',
      copy: PREPARE_REFUSAL_COPY.offline,
      code: 'OFFLINE',
      itemIndex: null,
      amountField: false,
    }
  }
  const code = data.code as TipV2ErrorCode
  const map = PREPARE_REFUSALS[code] as
    | ((typeof PREPARE_REFUSALS)[TipV2ErrorCode])
    | undefined
  const refusal = map
    ? map(data, ctx)
    : { kind: 'refused' as const, copy: PREPARE_REFUSAL_COPY.generic }
  return {
    ...refusal,
    code: map ? code : 'UNKNOWN',
    itemIndex: typeof data.itemIndex === 'number' ? data.itemIndex : null,
    amountField: AMOUNT_CODES.has(code),
  }
}

/** True for a `ConvexError` from a tip function (as opposed to a lost request). */
export function isTipServerError(error: unknown): boolean {
  return errorData(error) !== null
}
