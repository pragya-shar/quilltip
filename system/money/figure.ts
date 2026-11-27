/**
 * How the money figure lays out a dollar amount. Pure: no React, no DOM.
 *
 * The money layer (lib/payments) owns every amount and its display text:
 * "$4.20" exact, "≈ $17.28" converted at today's price, "<$0.01" for a real
 * amount under a cent. The figure never computes or rounds money. It splits
 * that text into the parts it draws (approximate mark, symbol, dollars,
 * cents) and the words a screen reader says.
 *
 * Text it does not recognise gives null, and the figure shows "Unavailable"
 * rather than a guess. Nothing here can produce a zero: digits come only
 * from a display string the money layer gave.
 */

/** The shape the money layer hands the UI (lib/payments/types.ts `Money`). */
export type MoneyValue = { readonly cents: number; readonly display: string }

export type FigureParts = {
  /** "≈": converted at today's price, an estimate. */
  approx: boolean
  /** "<": a real amount below one cent. */
  below: boolean
  symbol: '$'
  /** Whole dollars with group separators: "1,234". */
  whole: string
  /** ".40", or "" for a whole-dollar label such as "$5". */
  fraction: string
  /** What a screen reader says: "about $17.28", "less than 1 cent". */
  spoken: string
}

const PATTERN = /^(≈ ?)?(<)?\$(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2,6})?$/

export function figureParts(display: string): FigureParts | null {
  const match = PATTERN.exec(display.trim())
  if (!match) return null
  const approx = match[1] !== undefined
  const below = match[2] !== undefined
  const whole = match[3] ?? ''
  const fraction = match[4] ?? ''
  if (whole.length > 1 && whole.startsWith('0')) return null
  // "<" only ever qualifies the smallest shown amount.
  if (below && (approx || `${whole}${fraction}` !== '0.01')) return null
  const amount = `$${whole}${fraction}`
  const spoken = below
    ? 'less than 1 cent'
    : approx
      ? `about ${amount}`
      : amount
  return { approx, below, symbol: '$', whole, fraction, spoken }
}

export type FigureStatus = 'ready' | 'loading' | 'unavailable'

export type FigureState =
  | { kind: 'value'; parts: FigureParts }
  | { kind: 'loading' }
  | { kind: 'unavailable' }

/**
 * What the figure shows. While the server has not answered it is loading;
 * when it cannot answer, or answered with nothing, it is unavailable. In
 * neither case is a digit drawn.
 */
export function figureState(
  value: MoneyValue | null,
  status: FigureStatus = 'ready'
): FigureState {
  if (status === 'loading') return { kind: 'loading' }
  if (status === 'unavailable' || value === null) return { kind: 'unavailable' }
  const parts = figureParts(value.display)
  return parts ? { kind: 'value', parts } : { kind: 'unavailable' }
}
