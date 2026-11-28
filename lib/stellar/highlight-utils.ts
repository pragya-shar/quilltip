/**
 * Display helpers for passage tips: amounts and the heatmap palette.
 */

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
