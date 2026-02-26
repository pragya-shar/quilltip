/**
 * Utility functions for highlight tipping
 */

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
  feeBps: number = 250
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

/**
 * Get color intensity for heatmap visualization
 * Based on tip amount relative to max amount
 *
 * @param amount - Current tip amount
 * @param maxAmount - Maximum tip amount in dataset
 * @returns RGB color string
 */
export function getHeatmapColor(amount: number, maxAmount: number): string {
  if (maxAmount === 0) return 'rgb(255, 255, 200)' // Light yellow for zero

  const intensity = Math.min(amount / maxAmount, 1)

  // Helper to clamp RGB values between 0-255
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.floor(value)))

  // Color gradient: Yellow (low) → Orange → Red (high)
  if (intensity < 0.33) {
    // Yellow to light orange
    const r = 255
    const g = clamp(255 - intensity * 3 * 100)
    const b = 150
    return `rgb(${r}, ${g}, ${b})`
  } else if (intensity < 0.66) {
    // Orange
    const r = 255
    const g = clamp(200 - (intensity - 0.33) * 3 * 100)
    const b = 100
    return `rgb(${r}, ${g}, ${b})`
  } else {
    // Red
    const r = 255
    const g = clamp(100 - (intensity - 0.66) * 3 * 100)
    const b = 50
    return `rgb(${r}, ${g}, ${b})`
  }
}
