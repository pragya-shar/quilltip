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

export async function articleTipIntentMemoServer(
  intentId: string
): Promise<string> {
  return `qt${(await sha256Hex(intentId)).slice(0, 24)}`
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
