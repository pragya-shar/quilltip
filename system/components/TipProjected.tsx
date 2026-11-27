import { figureState, spokenDollars, type MoneyValue } from '../money/figure'

/** A projected figure, drawn and in words. */
function projectedFigure(value: MoneyValue) {
  const state = figureState(value)
  if (state.kind !== 'value') return null
  const { approx, sign, symbol, whole, fraction } = state.parts
  return {
    drawn: `${approx ? '≈ ' : ''}${sign}${symbol}${whole}${fraction}`,
    spoken: spokenDollars(state.parts),
  }
}

/**
 * The balance now and after a held tip, under the tip control's status:
 * "≈ $18.40 → ≈ $17.40" drawn (hidden from assistive technology), "about 18
 * dollars 40, then about 17 dollars 40" heard. Draws nothing for a value the
 * figure cannot read.
 */
export function TipProjected({
  before,
  after,
}: {
  before: MoneyValue
  after: MoneyValue
}) {
  const from = projectedFigure(before)
  const to = projectedFigure(after)
  if (!from || !to) return null
  return (
    <span className="qt-tip__projected">
      <span aria-hidden="true">
        {from.drawn} <span className="qt-tip__arrow">→</span> {to.drawn}
      </span>
      <span className="qt-visually-hidden">
        {`. ${from.spoken}, then ${to.spoken}`}
      </span>
    </span>
  )
}
