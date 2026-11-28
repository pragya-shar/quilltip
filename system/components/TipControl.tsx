'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '../cx'
import { focusDestination, watchInputModality } from '../inputModality'
import { AmountIcon, CloseIcon, DoneIcon, TipIcon } from '../icons'
import type { MoneyValue } from '../money/figure'
import {
  HOLD_CANCELLED,
  tipButtonParts,
  tipNote,
  type TipControlPhase,
} from '../money/tip'
import { AmountTray } from './AmountTray'
import { Icon } from './Icon'
import { Spinner } from './Spinner'
import { TipProjected } from './TipProjected'

/**
 * The hold before sending (the `holding` phase), as the money layer's
 * controller describes it. The control draws it; it keeps no timer of its
 * own.
 */
export type TipHold = {
  /** The balance now and after this tip, drawn "≈ $18.40 → ≈ $17.40" and
   * heard "about 18 dollars 40, then about 17 dollars 40". */
  projected?: { before: MoneyValue; after: MoneyValue }
  /** Ends the hold with nothing sent (Cancel, Escape). */
  onCancel: () => void
  /** Adds $1 and restarts the hold. */
  onAddOne: () => void
  /** Why +$1 cannot add now (balance, daily limit, per-tip limit); it is
   * then disabled and says why. */
  addOneBlocked?: string | null
  /** Changes each time the hold restarts, so the countdown starts again. */
  restartKey?: number | string
}

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
  /** After a failure: leaves it, back to idle ("Not now"). */
  onNotNow?: () => void
  /** The writer's full name, for what a screen reader hears. */
  recipient: string
  /** The name on the button ("Tip Tomás $1"); the first word of
   * `recipient` by default. Empty: "Tip $1". */
  recipientFirstName?: string
  /** passage: a line is chosen and the button says "Tip this line". */
  target?: 'article' | 'passage'
  /** Clears a chosen line; shown only while a line is chosen. */
  onClearTarget?: () => void
  /** The hold, while the money layer holds the tip before sending. */
  hold?: TipHold | null
  /** Why this reader cannot tip here now, in a few words. Hides the amount. */
  unavailable?: string | null
  /** Offers an "Other" amount field in the tray. */
  allowOther?: boolean
  /** What the reader can tip now (the money layer's figure); the tray
   * shows "≈ $18.40 ready to tip". */
  balance?: MoneyValue | null
  /** Opens the balance (the shell's `sheetStack.open('pocket')`) from the
   * tray's caption: on a pushed screen at phone width it is the way to the
   * balance. */
  onOpenBalance?: () => void
  /** `labelled`: the amount control shows the word "Amount" beside its
   * icon, where the design has one. `icon` (default): the icon alone, named
   * "Change amount". */
  amountControl?: 'icon' | 'labelled'
  className?: string
}

/** A held key repeats its keydown; Enter on a button clicks each time. */
function refuseRepeat(event: KeyboardEvent<HTMLElement>) {
  if (event.repeat) event.preventDefault()
}

/** How long a press waits for the phase to change before another counts. */
const PRESS_LATCH_MS = 1000

/**
 * The main action: a labelled button that states the amount
 * ("Tip Tomás $1", "Tip this line $1"), with a visible amount button that
 * works by tap and by keyboard; choosing an amount never sends. While a tip
 * is held or sending, the button becomes a status and focus moves to it;
 * "Sent" keeps focus; a refusal moves focus to its reason. Focus never
 * depends on the pressed button keeping it (Safari does not focus a button
 * on click), and each change is read once, by focus. The one live
 * announcement is "Cancelled. Nothing was sent.", which has no element to
 * focus. No swipe, no long press, no Undo; the hold's timing belongs to the
 * money layer. A held key or a double press asks for one tip: a repeated
 * key is refused, and a press waits for the phase to change.
 */
export function TipControl({
  state,
  amount,
  amounts,
  onAmountChange,
  onTip,
  onAddMoney,
  onNotNow,
  recipient,
  recipientFirstName,
  target = 'article',
  onClearTarget,
  hold,
  unavailable,
  allowOther = true,
  balance,
  onOpenBalance,
  amountControl = 'icon',
  className,
}: TipControlProps) {
  const trayId = useId()
  const noteId = useId()
  const [trayOpen, setTrayOpen] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  // Whether focus is the control's to move: it put focus on its status or
  // its reason, or focus is inside it, and the person has not since moved
  // it out (Tab) or pressed elsewhere. Not "focus is on the body": in
  // Safari a press on plain text leaves focus there too, and the control
  // must not pull it back.
  const owned = useRef(false)
  const wasBusy = useRef(false)
  const amountButton = useRef<HTMLButtonElement>(null)
  const tipButton = useRef<HTMLButtonElement>(null)
  const status = useRef<HTMLDivElement>(null)
  const note = useRef<HTMLParagraphElement>(null)
  const previous = useRef(state.phase)
  const latch = useRef<number | null>(null)
  const holding = state.phase === 'holding'
  const busy =
    holding ||
    state.phase === 'sending' ||
    state.phase === 'sent' ||
    (state.phase === 'other' && state.busy)
  const stuck = state.phase === 'needs-funds' && !onAddMoney
  const inert = state.phase === 'offline' || Boolean(unavailable) || stuck
  const parts = unavailable
    ? { words: unavailable, amount: null }
    : tipButtonParts(state, amount, target, recipientFirstName ?? recipient)
  const noteText = tipNote(state)

  useEffect(() => watchInputModality(), [])

  // Focus follows the tip: to the status while it is held or sending, kept
  // on "Sent", to the reason on a refusal, back to the button when the
  // status leaves and focus was still the control's. Every move uses
  // preventScroll.
  useEffect(() => {
    const before = previous.current
    previous.current = state.phase
    if (before === state.phase) {
      wasBusy.current = busy
      return
    }
    releaseLatch()
    const started = busy && !wasBusy.current
    wasBusy.current = busy
    if (busy) {
      setCancelled(false)
      // A tip starts: focus goes to its status. Held to sending to sent:
      // it follows only while it is still the control's.
      if (started) owned.current = true
      if (owned.current) focusDestination(status.current)
    } else if (state.phase === 'failed') {
      owned.current = true
      focusDestination(note.current)
    } else if (
      state.phase === 'idle' &&
      owned.current &&
      !root.current?.contains(document.activeElement)
    ) {
      tipButton.current?.focus({ preventScroll: true })
    }
    // `busy` follows the phase; listing the phase is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])
  useEffect(() => {
    if (busy) setTrayOpen(false)
  }, [busy])
  useEffect(() => () => releaseLatch(), [])
  useEffect(() => {
    // A press anywhere else takes focus back from the control.
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) owned.current = false
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [])

  // Escape ends a hold while focus is in the control (the hold puts it on
  // the status); elsewhere Escape belongs to whatever has focus.
  const holdRef = useRef(hold)
  const hasHold = Boolean(hold)
  useEffect(() => {
    holdRef.current = hold
  })
  useEffect(() => {
    if (!holding || !hasHold) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return
      if (!root.current?.contains(document.activeElement)) return
      event.preventDefault()
      setCancelled(true)
      holdRef.current?.onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [holding, hasHold])

  function releaseLatch() {
    if (latch.current !== null) window.clearTimeout(latch.current)
    latch.current = null
  }

  // One tip per press: a second press before the phase moves is ignored.
  const press = () => {
    if (busy || inert || latch.current !== null) return
    setCancelled(false)
    if (state.phase === 'needs-funds') {
      onAddMoney?.()
      return
    }
    if (!amount) {
      // Nothing to send: the tray opens to choose one.
      setTrayOpen(true)
      return
    }
    latch.current = window.setTimeout(releaseLatch, PRESS_LATCH_MS)
    onTip()
  }

  const closeTray = (returnFocus: boolean) => {
    setTrayOpen(false)
    if (returnFocus) amountButton.current?.focus()
  }

  const face = (
    <>
      {holding && hold ? (
        <span
          key={hold.restartKey ?? 0}
          className="qt-tip__countdown"
          aria-hidden="true"
        />
      ) : null}
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
      onFocus={() => {
        owned.current = true
      }}
      onBlur={(event) => {
        const outside =
          event.relatedTarget !== null &&
          !event.currentTarget.contains(event.relatedTarget)
        // Moved out (Tab, or a press on another control): not ours now.
        if (outside) owned.current = false
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
          balance={balance}
          onOpenBalance={onOpenBalance}
          onChange={onAmountChange}
          onClose={closeTray}
          anchor={amountButton}
        />
      ) : null}
      <div className="qt-tip__bar">
        {holding && hold ? (
          <button
            type="button"
            className="qt-tip__round"
            data-variant="plain"
            onKeyDown={refuseRepeat}
            onClick={() => {
              setCancelled(true)
              hold.onCancel()
            }}
          >
            Cancel
          </button>
        ) : null}
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
        {!unavailable && !busy ? (
          <button
            ref={amountButton}
            type="button"
            className="qt-tip__round"
            data-variant="action"
            data-labelled={amountControl === 'labelled' || undefined}
            aria-label={
              amountControl === 'labelled' ? undefined : 'Change amount'
            }
            aria-expanded={trayOpen}
            aria-controls={trayOpen ? trayId : undefined}
            onClick={() => setTrayOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && trayOpen) {
                event.preventDefault()
                setTrayOpen(false)
              }
            }}
          >
            <Icon icon={AmountIcon} size={24} />
            {amountControl === 'labelled' ? (
              <span className="qt-tip__amount-word">Amount</span>
            ) : null}
          </button>
        ) : null}
        {busy ? (
          <div
            ref={status}
            className="qt-tip__button"
            data-status=""
            tabIndex={-1}
          >
            {face}
            {holding ? (
              <span className="qt-visually-hidden">
                {hold
                  ? ` to ${recipient}. Cancel stops it.`
                  : ` to ${recipient}`}
              </span>
            ) : state.phase === 'sent' ? (
              <span className="qt-visually-hidden"> to {recipient}</span>
            ) : null}
            {holding && hold?.projected ? (
              <TipProjected {...hold.projected} />
            ) : null}
          </div>
        ) : (
          <button
            ref={tipButton}
            type="button"
            className="qt-tip__button"
            aria-disabled={inert || undefined}
            aria-describedby={noteText ? noteId : undefined}
            onKeyDown={refuseRepeat}
            onClick={press}
          >
            {face}
          </button>
        )}
        {holding && hold ? (
          <button
            type="button"
            className="qt-tip__round"
            data-variant="plain"
            aria-label={
              hold?.addOneBlocked
                ? `Add $1. Not now: ${hold.addOneBlocked}`
                : 'Add $1'
            }
            aria-disabled={hold?.addOneBlocked ? true : undefined}
            onKeyDown={refuseRepeat}
            onClick={() => {
              if (!hold?.addOneBlocked) hold?.onAddOne()
            }}
          >
            +$1
          </button>
        ) : null}
        {state.phase === 'failed' && onNotNow ? (
          <button
            type="button"
            className="qt-tip__round"
            data-variant="plain"
            onKeyDown={refuseRepeat}
            onClick={onNotNow}
          >
            Not now
          </button>
        ) : null}
      </div>
      <span className="qt-visually-hidden" role="status">
        {cancelled && !busy ? HOLD_CANCELLED : ''}
      </span>
    </div>
  )
}
