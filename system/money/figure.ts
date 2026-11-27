/**
 * How the money figure lays out a dollar amount. Pure: no React, no DOM.
 *
 * The money layer (lib/payments) owns every amount and its display text
 * (design N2): exact, with two decimals and up to six when the amount has
 * fractions of a cent ("$1.95", "$0.0975", "$2.925"); "≈" only before a
 * figure converted at today's price (wallet holdings, the token picker,
 * figures held in a token); an amount below the sixth decimal reads "$0.00"
 * with the exact token amount elsewhere. "<$0.01" is never used. The figure
 * never computes or rounds money: it splits that text into the parts it
 * draws (approximate mark, symbol, dollars, cents and any further digits)
 * and the words a screen reader says.
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
  symbol: '$'
  /** Whole dollars with group separators: "1,234". */
  whole: string
  /** ".40", ".0975", or "" for a whole-dollar label such as "$5". */
  fraction: string
  /** What a screen reader says: "$1.95", "about $17.28". */
  spoken: string
}

const PATTERN = /^(≈ ?)?\$(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2,6})?$/

export function figureParts(display: string): FigureParts | null {
  const match = PATTERN.exec(display.trim())
  if (!match) return null
  const approx = match[1] !== undefined
  const whole = match[2] ?? ''
  const fraction = match[3] ?? ''
  if (whole.length > 1 && whole.startsWith('0')) return null
  // Exact amounts drop trailing zeros after the second decimal (N2).
  if (fraction.length > 3 && fraction.endsWith('0')) return null
  const amount = `$${whole}${fraction}`
  return {
    approx,
    symbol: '$',
    whole,
    fraction,
    spoken: approx ? `about ${amount}` : amount,
  }
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
