'use client'

/**
 * The passage tip bar (view only; `PassageTip` supplies the state). Docked
 * at the bottom so the chosen passage stays visible above it, and the
 * confirmation is a line inside the bar, never over the article.
 *
 *   [x clear] [$ change amount] [ Tip this line $1 ]
 *   amount choices: a radio group, by tap or arrow keys
 *
 * The labelled button is the only control that sends: a tap on the text or
 * a drag across it never pays.
 */
import { CircleDollarSign, Highlighter, X } from 'lucide-react'
import { formatMoney } from '@/lib/payments/money'
import type { Money, TipPhase } from '@/lib/payments/types'
import './balance.css'

export type PassageTipBarProps = {
  phase: TipPhase
  label: string
  amount: Money | null
  amounts: Money[]
  trayOpen: boolean
  /** One plain line above the controls, announced politely. */
  status: {
    text: string
    tone?: 'danger'
    link?: { href: string; label: string }
  } | null
  disabled?: boolean
  /** The payments code is loaded and answered: a tap sends at once. */
  live?: boolean
  onTip(): void
  onToggleTray(): void
  onChooseAmount(cents: number): void
  onClear(): void
  /** Saves the passage as a highlight, apart from any tip. */
  onHighlight?: () => void
  highlightBusy?: boolean
}

export function PassageTipBar({
  phase,
  label,
  amount,
  amounts,
  trayOpen,
  status,
  disabled,
  live,
  onTip,
  onToggleTray,
  onChooseAmount,
  onClear,
  onHighlight,
  highlightBusy,
}: PassageTipBarProps) {
  const sending = phase.phase === 'sending'
  return (
    <div
      className="qt-pay qt-tipbar"
      role="region"
      aria-label="Tip this passage"
      data-testid="passage-tip-bar"
      // A press on the bar is not a press on the article: it keeps the passage.
      data-article-overlay=""
    >
      <div className="qt-tipbar-inner">
        <p
          className="qt-tipbar-status"
          data-tone={status?.tone}
          role="status"
          aria-live="polite"
        >
          {status?.text}
          {status?.link ? (
            <>
              {' '}
              <a href={status.link.href}>{status.link.label}</a>
            </>
          ) : null}
        </p>
        <div className="qt-tipbar-row">
          <button
            type="button"
            className="qt-round"
            aria-label="Clear passage"
            onClick={onClear}
            disabled={sending}
          >
            <X aria-hidden size={20} />
          </button>
          {onHighlight ? (
            <button
              type="button"
              className="qt-round"
              aria-label="Save highlight"
              onClick={onHighlight}
              disabled={sending || highlightBusy}
            >
              <Highlighter aria-hidden size={19} />
            </button>
          ) : null}
          <button
            type="button"
            className="qt-round"
            aria-label="Change amount"
            aria-expanded={trayOpen}
            aria-controls="qt-amounts"
            onClick={onToggleTray}
            disabled={sending || amounts.length < 2}
          >
            <CircleDollarSign aria-hidden size={21} />
          </button>
          <button
            type="button"
            className="qt-tip"
            data-phase={phase.phase}
            data-live={live ? 'true' : 'false'}
            aria-disabled={sending || disabled ? true : undefined}
            onClick={() => {
              if (!sending && !disabled) onTip()
            }}
          >
            <svg
              className="qt-nib"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M4 20l3.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20z"
              />
            </svg>
            {label}
          </button>
        </div>
        {trayOpen ? (
          <fieldset className="qt-amounts" id="qt-amounts">
            <legend>Amount</legend>
            {amounts.map((m) => (
              <label key={m.cents} className="qt-amount">
                <input
                  type="radio"
                  name="qt-amount"
                  value={m.cents}
                  checked={m.cents === amount?.cents}
                  onChange={() => onChooseAmount(m.cents)}
                />
                <span>{formatMoney(m.cents, { short: true })}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
    </div>
  )
}
