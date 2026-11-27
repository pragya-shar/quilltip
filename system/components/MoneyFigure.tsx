import type { ReactNode } from 'react'
import { cx } from '../cx'
import {
  figureState,
  type FigureStatus,
  type MoneyValue,
} from '../money/figure'

type MoneyFigureProps = {
  /** From the money layer (hooks/payments). Null until the server answers. */
  value: MoneyValue | null
  /** loading: not answered yet. unavailable: payments cannot answer now. */
  status?: FigureStatus
  /** xl: Ready to tip, Ready to withdraw. l: the receipt, the withdraw
   * sheet. m: Ready to tip beside earnings. pending: a figure beside another
   * ("On its way"). s: rows. Sizes are tokens (--qt-money-*). */
  size?: 'xl' | 'l' | 'm' | 'pending' | 's'
  /** in: money received (marker-ink). muted: did not go through (grey). */
  tone?: 'default' | 'in' | 'muted'
  /** Direction mark for activity rows, when the money layer's text has
   * none ("−$1.00" carries its own). A sign never colours a figure red. */
  sign?: '+' | '−'
  /** What the number is, shown below it: "Ready to tip". */
  label?: ReactNode
  /** Words for "unavailable" in this place. */
  unavailableText?: string
  className?: string
}

/**
 * A dollar amount, exactly as the money layer wrote it: "$18.40",
 * "$0.0975", or "≈ $17.28" for a converted figure. At the serif sizes the
 * cents, and any further digits, draw raised and smaller. Figures are tabular,
 * so a changing amount never shifts its neighbours. Until the server
 * answers, a skeleton holds the space; when payments are down, the figure
 * says so. It never draws a placeholder zero.
 */
export function MoneyFigure({
  value,
  status = 'ready',
  size = 'm',
  tone = 'default',
  sign,
  label,
  unavailableText = 'Unavailable',
  className,
}: MoneyFigureProps) {
  const state = figureState(value, status)
  const drawnSign = state.kind === 'value' ? state.parts.sign || sign || '' : ''
  const spokenSign =
    state.kind === 'value' && !state.parts.sign && sign
      ? sign === '+'
        ? 'plus '
        : 'minus '
      : ''
  const figure =
    state.kind === 'value' ? (
      <span className="qt-money__figure">
        <span aria-hidden="true" className="qt-money__digits">
          {state.parts.approx ? (
            <span className="qt-money__approx">≈</span>
          ) : null}
          {drawnSign ? (
            <span className="qt-money__sign">{drawnSign}</span>
          ) : null}
          <span className="qt-money__symbol">{state.parts.symbol}</span>
          <span className="qt-money__whole">{state.parts.whole}</span>
          {state.parts.fraction ? (
            <span className="qt-money__fraction">{state.parts.fraction}</span>
          ) : null}
        </span>
        <span className="qt-visually-hidden">
          {spokenSign}
          {state.parts.spoken}
        </span>
      </span>
    ) : state.kind === 'loading' ? (
      <span className="qt-money__figure" data-skeleton="">
        <span className="qt-money__placeholder" aria-hidden="true" />
        <span className="qt-visually-hidden">Loading amount</span>
      </span>
    ) : (
      <span className="qt-money__figure" data-unavailable="">
        <span className="qt-money__unavailable">{unavailableText}</span>
      </span>
    )
  return (
    <span
      className={cx('qt-money', className)}
      data-size={size}
      data-tone={tone}
      data-state={state.kind}
      aria-busy={state.kind === 'loading' || undefined}
    >
      {figure}
      {label ? <span className="qt-money__label">{label}</span> : null}
    </span>
  )
}
