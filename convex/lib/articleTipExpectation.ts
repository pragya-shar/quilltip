import { v } from 'convex/values'
import {
  STROOPS_PER_XLM,
  TIP_MAX_CENTS,
  TIP_MIN_CENTS,
  TIP_MIN_STROOPS,
} from './constants'

export const ARTICLE_TIP_FALLBACK_XLM_USD_RATE = 0.22
export const ARTICLE_TIP_INTENT_TTL_MS = 15 * 60 * 1000

function calculateTipStroops(amountCents: number, priceUsd: number): number {
  const usdAmount = amountCents / 100
  const stroops = Math.floor((usdAmount / priceUsd) * STROOPS_PER_XLM)
  return Math.max(stroops, TIP_MIN_STROOPS)
}

export const tipXlmPresetValidator = v.union(
  v.literal(1),
  v.literal(2),
  v.literal(5)
)

type TipAmount =
  | { amountCents: number; amountXlm?: never }
  | { amountXlm: 1 | 2 | 5; amountCents?: never }

export function validateTipAmount(args: {
  amountCents?: number
  amountXlm?: 1 | 2 | 5
}): TipAmount {
  const { amountCents, amountXlm } = args
  if (amountXlm !== undefined && amountCents === undefined) return { amountXlm }
  if (
    amountXlm === undefined &&
    amountCents !== undefined &&
    Number.isSafeInteger(amountCents) &&
    amountCents >= TIP_MIN_CENTS &&
    amountCents <= TIP_MAX_CENTS
  ) {
    return { amountCents }
  }
  throw new Error('Invalid tip amount')
}

export function quoteTipAmount(amount: TipAmount, priceUsd: number) {
  if (amount.amountXlm === undefined) {
    return {
      amountCents: amount.amountCents,
      expectedAmountStroops: calculateTipStroops(amount.amountCents, priceUsd),
    }
  }
  const amountCents = Math.max(
    TIP_MIN_CENTS,
    Math.round(amount.amountXlm * priceUsd * 100)
  )
  if (!Number.isSafeInteger(amountCents) || amountCents > TIP_MAX_CENTS) {
    throw new Error('Invalid tip amount')
  }
  return {
    amountCents,
    expectedAmountStroops: amount.amountXlm * STROOPS_PER_XLM,
  }
}

export async function shortArticleIdServer(articleId: string): Promise<string> {
  return (await sha256Hex(articleId)).slice(0, 10)
}

export async function articleTipIntentTimeBoundsServer(
  intentId: string,
  expiresAtMs: number
): Promise<{ minTime: string; maxTime: string }> {
  const digest = await sha256Hex(intentId)
  // Stellar time bounds are part of the signed Soroban envelope. A
  // deterministic value in the distant past is always valid while giving
  // each server intent its own on-chain replay binding.
  const minTime = (Number.parseInt(digest.slice(0, 8), 16) % 1_000_000_000) + 1
  return {
    minTime: minTime.toString(),
    maxTime: Math.floor(expiresAtMs / 1000).toString(),
  }
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value)
  const bytes = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength
  ) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
