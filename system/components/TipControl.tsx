'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cx } from '../cx'
import { AmountIcon, CloseIcon, DoneIcon, TipIcon } from '../icons'
import type { MoneyValue } from '../money/figure'
import {
  tipAnnouncement,
  tipButtonLabel,
  type TipControlPhase,
} from '../money/tip'
import { AmountTray } from './AmountTray'
import { Icon } from './Icon'
import { Spinner } from './Spinner'

export type TipControlProps = {
  /** `useTip(...).state` from hooks/payments. */
  state: TipControlPhase
  /** The amount the button states and sends. Null when none fits. */
  amount: MoneyValue | null
  /** The quick amounts, within every limit. */
  amounts: readonly MoneyValue[]
  onAmountChange: (cents: number) => void
  /** Sends the chosen amount, or retries after a failure. */
  onTip: () => void
  /** Opens the add-money sheet when the balance is short. */
  onAddMoney?: () => void
  /** The writer, for what a screen reader hears. */
  recipient: string
  /** passage: a line is targeted and the button says "Tip this line". */
  target?: 'article' | 'passage'
  /** Clears a targeted line; shown only while a line is targeted. */
  onClearTarget?: () => void
  /** Why this reader cannot tip here now, in a few words. Hides the amount. */
  unavailable?: string | null
  /** Offers an "Other" amount field in the tray. */
  allowOther?: boolean
  className?: string
}

/**
 * The main action: a labelled button that states the amount ("Tip $1"),
 * with a visible amount button beside it that works by tap and by keyboard.
 * A tap on the button sends; choosing an amount never sends. It shows
 * Sending while the server decides, Sent only after it accepted, and
 * "Try again" when it refused. No swipe, no long press, no Undo.
 */
export function TipControl({
  state,
  amount,
  amounts,
  onAmountChange,
  onTip,
  onAddMoney,
  recipient,
  target = 'article',
  onClearTarget,
  unavailable,
  allowOther = true,
  className,
}: TipControlProps) {
  const trayId = useId()
  const hintId = useId()
  const [trayOpen, setTrayOpen] = useState(false)
  const [offlineHint, setOfflineHint] = useState(false)
  const amountButton = useRef<HTMLButtonElement>(null)
  const busy = state.phase === 'sending' || state.phase === 'sent'
  const label = unavailable ?? tipButtonLabel(state, amount, target)
  const announcement = tipAnnouncement(state, recipient)

  useEffect(() => {
    if (state.phase !== 'offline') setOfflineHint(false)
  }, [state.phase])
  useEffect(() => {
    if (busy) setTrayOpen(false)
  }, [busy])

  const press = () => {
    if (busy || unavailable) return
    if (state.phase === 'offline') {
      setOfflineHint(true)
      return
    }
    if (state.phase === 'needs-funds') {
      onAddMoney?.()
      return
    }
    if (!amount) {
      setTrayOpen(true)
      return
    }
    onTip()
  }

  const closeTray = (returnFocus: boolean) => {
    setTrayOpen(false)
    if (returnFocus) amountButton.current?.focus()
  }

  return (
    <div
      className={cx('qt-tip', className)}
      role="group"
      aria-label={`Tip ${recipient}`}
      data-phase={unavailable ? 'unavailable' : state.phase}
      data-target={target}
    >
      {offlineHint ? (
        <p className="qt-tip__hint" id={hintId}>
          You are offline. Tip again when you are back online.
        </p>
      ) : null}
      {trayOpen ? (
        <AmountTray
          id={trayId}
          amounts={amounts}
          value={amount}
          allowOther={allowOther}
          onChange={onAmountChange}
          onClose={closeTray}
          anchor={amountButton}
        />
      ) : null}
      <div className="qt-tip__bar">
        {target === 'passage' && onClearTarget && !busy ? (
          <button
            type="button"
            className="qt-tip__round"
            data-variant="plain"
            aria-label="Clear the line"
            onClick={onClearTarget}
          >
            <Icon icon={CloseIcon} size={24} />
          </button>
        ) : null}
        {!unavailable ? (
          <button
            ref={amountButton}
            type="button"
            className="qt-tip__round"
            data-variant="action"
            aria-label="Change amount"
            aria-haspopup="true"
            aria-expanded={trayOpen}
            aria-controls={trayOpen ? trayId : undefined}
            disabled={busy}
            onClick={() => setTrayOpen((open) => !open)}
          >
            <Icon icon={AmountIcon} size={24} />
          </button>
        ) : null}
        <button
          type="button"
          className="qt-tip__button"
          aria-disabled={busy || Boolean(unavailable) || undefined}
          aria-describedby={offlineHint ? hintId : undefined}
          onClick={press}
        >
          <span className="qt-tip__nib" aria-hidden="true">
            {state.phase === 'sending' ? (
              <Spinner />
            ) : state.phase === 'sent' ? (
              <Icon icon={DoneIcon} size={20} />
            ) : (
              <Icon icon={TipIcon} size={20} />
            )}
          </span>
          <span className="qt-tip__label">{label}</span>
        </button>
      </div>
      <span className="qt-visually-hidden" role="status">
        {announcement.polite}
      </span>
      <span className="qt-visually-hidden" role="alert">
        {announcement.assertive}
      </span>
    </div>
  )
}
