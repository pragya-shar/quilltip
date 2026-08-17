import { TIP_MIN_STROOPS } from './constants'

export const ARTICLE_TIP_FALLBACK_XLM_USD_RATE = 0.22
export const ARTICLE_TIP_INTENT_TTL_MS = 15 * 60 * 1000

export function calculateTipStroops(
  amountCents: number,
  priceUsd: number
): number {
  const usdAmount = amountCents / 100
  const stroops = Math.floor((usdAmount / priceUsd) * 10_000_000)
  return Math.max(stroops, TIP_MIN_STROOPS)
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
