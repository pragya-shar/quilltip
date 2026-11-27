/**
 * How the money figure lays out a dollar amount. Pure: no React, no DOM.
 *
 * The money layer (lib/payments) owns every amount and its display text
 *: exact, with two decimals and up to six when the amount has
 * fractions of a cent ("$1.95", "$0.0975", "$2.925"); "≈" only before a
 * figure converted at today's price (wallet holdings, the token picker,
 * figures held in a token); an amount below the sixth decimal reads "$0.00"
 * with the exact token amount elsewhere. "<$0.01" is never used. The figure
 * never computes or rounds money: it splits that text into the parts it
 * draws (approximate mark, sign, symbol, dollars, cents and any further
 * digits) and the words a screen reader says. The money layer writes a
 * direction as a leading sign after any mark: "−$1.00", "≈ +$2.40".
 *
 * Text it does not recognise gives null, and the figure shows "Unavailable"
 * rather than a guess. Nothing here can produce a zero: digits come only
 * from a display string the money layer gave.
 */

/**
 * The shape the money layer hands the UI (lib/payments/types.ts `Money`).
 * `converted`: the figure is a conversion at today's price (the reader's
 * balance held in XLM): written with the approximate mark, two
 * decimals, and heard as "about". Amounts fixed at tip time are exact and
 * never converted. The money layer sets the flag and writes `display`
 * without the mark; the figure adds it from the flag. `spoken`: the money
 * layer's words for it ("9.75 cents", "about 18 dollars 40"), used when
 * given.
 */
export type MoneyValue = {
  readonly cents: number
  readonly display: string
  readonly converted?: boolean
  readonly spoken?: string
}

export type FigureParts = {
  /** "≈": converted at today's price, an estimate. */
  approx: boolean
  /** A direction: "−" (U+2212; a hyphen is read as one) or "+". */
  sign: '' | '−' | '+'
  symbol: '$'
  /** Whole dollars with group separators: "1,234". */
  whole: string
  /** ".40", ".0975", or "" for a whole-dollar label such as "$5". */
  fraction: string
  /** What a screen reader says: "$1.95", "about $17.28", "minus $1.00". */
  spoken: string
}

const PATTERN = /^(≈ ?)?([−+-])?\$(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2,6})?$/

function spoken(approx: boolean, sign: FigureParts['sign'], amount: string) {
  const direction = sign === '−' ? 'minus ' : sign === '+' ? 'plus ' : ''
  return `${direction}${approx ? 'about ' : ''}${amount}`
}

export function figureParts(display: string): FigureParts | null {
  const match = PATTERN.exec(display.trim())
  if (!match) return null
  const approx = match[1] !== undefined
  const sign = match[2] === undefined ? '' : match[2] === '+' ? '+' : '−'
  const whole = match[3] ?? ''
  const fraction = match[4] ?? ''
  if (whole.length > 1 && whole.startsWith('0')) return null
  // Exact amounts drop trailing zeros after the second decimal.
  if (fraction.length > 3 && fraction.endsWith('0')) return null
  return {
    approx,
    sign,
    symbol: '$',
    whole,
    fraction,
    spoken: spoken(approx, sign, `$${whole}${fraction}`),
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
  if (!parts) return { kind: 'unavailable' }
  if (value.converted && !parts.approx) {
    const amount = `$${parts.whole}${parts.fraction}`
    return {
      kind: 'value',
      parts: {
        ...parts,
        approx: true,
        spoken: spoken(true, parts.sign, amount),
      },
    }
  }
  return { kind: 'value', parts }
}

/**
 * A figure in words, for a label that is read aloud, as the money layer
 * says it (`spokenMoney` in lib/payments/money.ts): under a dollar in
 * cents ("9.75 cents", "10 cents", "1 cent"), from a dollar in dollars and
 * cents ("1 dollar 95", "2 dollars 50", "5 dollars", "1,234 dollars 5");
 * "about" for a conversion, "minus" or "plus" for a direction.
 */
export function spokenDollars(parts: FigureParts): string {
  const whole = Number(parts.whole.replace(/,/g, ''))
  const digits = parts.fraction.slice(1)
  // ".40" is 40 cents, ".0975" is 9.75, ".925" is 92.5.
  const cents =
    digits === ''
      ? 0
      : Number(`${digits.slice(0, 2).padEnd(2, '0')}.${digits.slice(2) || '0'}`)
  const words =
    whole === 0
      ? `${cents} ${cents === 1 ? 'cent' : 'cents'}`
      : `${whole.toLocaleString('en-US')} ${whole === 1 ? 'dollar' : 'dollars'}${cents ? ` ${cents}` : ''}`
  return spoken(parts.approx, parts.sign, words)
}

/**
 * A money value in words: the money layer's own `spoken` when it gave one
 * (with any direction from the text), else `spokenDollars`. Null for a
 * value the figure cannot read.
 */
export function spokenValue(value: MoneyValue): string | null {
  const state = figureState(value)
  if (state.kind !== 'value') return null
  if (!value.spoken) return spokenDollars(state.parts)
  const { sign } = state.parts
  const direction = sign === '−' ? 'minus ' : sign === '+' ? 'plus ' : ''
  return `${direction}${value.spoken}`
}
