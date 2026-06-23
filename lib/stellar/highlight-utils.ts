/**
 * Utility functions for highlight tipping
 */

import { STELLAR_CONFIG } from './config'

/**
 * Generate deterministic highlight ID from text selection
 * This ID will be stored in Stellar memo field and used to track tips
 *
 * Uses Web Crypto API (browser-compatible) instead of Node.js crypto
 *
 * @param articleSlug - Article slug (unique identifier for the article)
 * @param text - Selected text (truncated to first 50 chars for consistency)
 * @param startOffset - Start position in article
 * @param endOffset - End position in article
 * @returns SHA256 hash (first 28 chars for Stellar memo compatibility)
 */
export async function generateHighlightId(
  articleSlug: string,
  text: string,
  startOffset: number,
  endOffset: number
): Promise<string> {
  // Create deterministic data string
  const data = `${articleSlug}:${startOffset}:${endOffset}:${text.slice(0, 50)}`

  // Convert string to Uint8Array
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)

  // Generate SHA-256 hash using Web Crypto API
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    dataBuffer as BufferSource
  )

  // Convert hash to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  // Return first 28 chars for Stellar memo compatibility (max 28 bytes)
  return hashHex.slice(0, 28)
}

/**
 * Validate highlight ID format
 *
 * @param highlightId - Highlight ID to validate
 * @returns true if valid format
 */
export function isValidHighlightId(highlightId: string): boolean {
  // Should be 28 characters, hexadecimal
  return /^[a-f0-9]{28}$/.test(highlightId)
}

/**
 * Format tip amount for display
 *
 * @param amountCents - Amount in cents
 * @returns Formatted string (e.g., "$1.50")
 */
export function formatTipAmount(amountCents: number): string {
  const dollars = amountCents / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars)
}

/**
 * Calculate platform fee and author share
 *
 * @param amountCents - Total tip amount in cents
 * @param feeBps - Platform fee in basis points (e.g., 250 = 2.5%)
 * @returns Object with platformFee and authorShare
 */
export function calculateTipBreakdown(
  amountCents: number,
  feeBps: number = STELLAR_CONFIG.PLATFORM_FEE_BPS
) {
  const platformFee = Math.floor((amountCents * feeBps) / 10_000)
  const authorShare = amountCents - platformFee

  return {
    platformFee,
    authorShare,
    platformFeeFormatted: formatTipAmount(platformFee),
    authorShareFormatted: formatTipAmount(authorShare),
  }
}

/**
 * Truncate text for display
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default 100)
 * @returns Truncated text with ellipsis if needed
 */
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

/** Heat intensity palette tokens defined in app/globals.css. */
export const HEATMAP_PALETTE = [
  'var(--heatmap-0)',
  'var(--heatmap-1)',
  'var(--heatmap-2)',
  'var(--heatmap-3)',
] as const

const HEATMAP_FALLBACK_COLOR = HEATMAP_PALETTE[0]!

/** Use `var(--heatmap-gradient)` in inline styles, defined in app/globals.css. */
export const HEATMAP_GRADIENT_CSS = 'var(--heatmap-gradient)'

function interpolateHeatmapPalette(intensity: number): string {
  const clamped = Math.max(0, Math.min(intensity, 1))
  const scaled = clamped * (HEATMAP_PALETTE.length - 1)
  const lowerIndex = Math.floor(scaled)
  const upperIndex = Math.min(lowerIndex + 1, HEATMAP_PALETTE.length - 1)
  const t = scaled - lowerIndex

  const lowerColor = HEATMAP_PALETTE[lowerIndex] ?? HEATMAP_FALLBACK_COLOR
  const upperColor = HEATMAP_PALETTE[upperIndex] ?? HEATMAP_FALLBACK_COLOR

  if (t === 0 || lowerColor === upperColor) {
    return lowerColor
  }

  return `color-mix(in srgb, ${lowerColor} ${Math.round(
    (1 - t) * 100
  )}%, ${upperColor})`
}

/**
 * Map tip amount to a heat color from the Quilltip heat palette.
 *
 * @param amount - Current tip amount in cents
 * @param maxAmount - Maximum tip amount in dataset
 * @returns CSS color value for bars and heat indicators
 */
export function getHeatmapColor(amount: number, maxAmount: number): string {
  if (maxAmount <= 0) return HEATMAP_PALETTE[0]

  const intensity = Math.min(amount / maxAmount, 1)
  return interpolateHeatmapPalette(intensity)
}
