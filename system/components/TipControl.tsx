'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cx } from '../cx'
import { focusDestination, watchInputModality } from '../inputModality'
import { AmountIcon, CloseIcon, DoneIcon, TipIcon } from '../icons'
import type { MoneyValue } from '../money/figure'
import { tipButtonParts, tipNote, type TipControlPhase } from '../money/tip'
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

/** Focus is lost when it sits on the body, or on a box around the control. */
function focusLost(root: HTMLElement | null): boolean {
  const active = document.activeElement
  return (
    !active ||
    active === document.body ||
    (root !== null && active !== root && active.contains(root))
  )
}

/**
 * The main action: a labelled button that states the amount ("Tip $1"),
 * with a visible amount button beside it that works by tap and by keyboard.
 * A press sends; choosing an amount never sends. While the server decides,
 * the button becomes a status ("Sending $1") and focus moves to it; when it
 * accepts, the status reads "Sent $1" and keeps focus; when it refuses, focus
 * moves to the reason. Focus never depends on the pressed button keeping it
 * (Safari does not focus a button on click), and each change is read once,
 * by focus, with no second live announcement. No swipe, no long press, no
 * Undo.
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
  const noteId = useId()
  const [trayOpen, setTrayOpen] = useState(false)
  const [offlineNote, setOfflineNote] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const amountButton = useRef<HTMLButtonElement>(null)
  const tipButton = useRef<HTMLButtonElement>(null)
  const status = useRef<HTMLDivElement>(null)
  const note = useRef<HTMLParagraphElement>(null)
  const previous = useRef(state.phase)
  const busy = state.phase === 'sending' || state.phase === 'sent'
  const stuck = state.phase === 'needs-funds' && !onAddMoney
  const parts = unavailable
    ? { words: unavailable, amount: null }
    : tipButtonParts(state, amount, target)
  const noteText =
    state.phase === 'offline'
      ? offlineNote
        ? tipNote(state)
        : null
      : tipNote(state)

  // Focus follows the tip: to the status when it starts, to the result when
  // it ends, back to the button when the result clears and focus was lost.
  useEffect(() => {
    const before = previous.current
    previous.current = state.phase
    if (before === state.phase) return
    if (state.phase === 'sending' || state.phase === 'sent') {
      focusDestination(status.current)
    } else if (state.phase === 'failed') {
      focusDestination(note.current)
    } else if (state.phase === 'idle' && focusLost(root.current)) {
      tipButton.current?.focus({ preventScroll: true })
    }
    if (state.phase !== 'offline') setOfflineNote(false)
  }, [state.phase])
  useEffect(() => {
    if (offlineNote) focusDestination(note.current)
  }, [offlineNote])
  useEffect(() => watchInputModality(), [])
  useEffect(() => {
    if (busy) setTrayOpen(false)
  }, [busy])

  const press = () => {
    if (busy || unavailable || stuck) return
    if (state.phase === 'offline') {
      setOfflineNote(true)
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

  const face = (
    <>
      <span className="qt-tip__nib" aria-hidden="true">
        {state.phase === 'sending' ? (
          <Spinner />
        ) : state.phase === 'sent' ? (
          <Icon icon={DoneIcon} size={20} />
        ) : (
          <Icon icon={TipIcon} size={20} />
        )}
      </span>
      <span className="qt-tip__label">
        <span className="qt-tip__words">{parts.words}</span>{' '}
        {parts.amount ? (
          <span className="qt-tip__amount">{parts.amount}</span>
        ) : null}
      </span>
    </>
  )

  return (
    <div
      ref={root}
      className={cx('qt-tip', className)}
      role="group"
      aria-label={`Tip ${recipient}`}
      data-phase={unavailable ? 'unavailable' : state.phase}
      data-target={target}
      onBlur={(event) => {
        // Focus left the control and its tray: the tray closes.
        if (trayOpen && !event.currentTarget.contains(event.relatedTarget))
          setTrayOpen(false)
      }}
    >
      {noteText ? (
        <p className="qt-tip__note" id={noteId} ref={note} tabIndex={-1}>
          {noteText}
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
            aria-expanded={trayOpen}
            aria-controls={trayOpen ? trayId : undefined}
            disabled={busy}
            onClick={() => setTrayOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && trayOpen) {
                event.preventDefault()
                setTrayOpen(false)
              }
            }}
          >
            <Icon icon={AmountIcon} size={24} />
          </button>
        ) : null}
        {busy ? (
          <div ref={status} className="qt-tip__button" tabIndex={-1}>
            {face}
            {state.phase === 'sent' ? (
              <span className="qt-visually-hidden"> to {recipient}</span>
            ) : null}
          </div>
        ) : (
          <button
            ref={tipButton}
            type="button"
            className="qt-tip__button"
            aria-disabled={Boolean(unavailable) || stuck || undefined}
            aria-describedby={noteText ? noteId : undefined}
            onClick={press}
          >
            {face}
          </button>
        )}
      </div>
    </div>
  )
}
