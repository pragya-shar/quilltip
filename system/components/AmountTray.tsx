'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { spokenValue, type MoneyValue } from '../money/figure'
import { centsFromInput } from '../money/tip'
import { MoneyFigure } from './MoneyFigure'

type AmountTrayProps = {
  id: string
  amounts: readonly MoneyValue[]
  value: MoneyValue | null
  allowOther: boolean
  /** What the reader can tip now, from the money layer: "≈ $18.40 ready to
   * tip" above the amounts. */
  balance?: MoneyValue | null
  /** Opens the balance from its caption. Without it the caption is text. */
  onOpenBalance?: () => void
  onChange: (cents: number) => void
  /** `returnFocus`: put focus back on the amount button. */
  onClose: (returnFocus: boolean) => void
  anchor: RefObject<HTMLElement | null>
}

/**
 * The amount choice above the tip control: a radio group of quick amounts
 * and an "Other" field. Arrow keys move and choose, Enter or a tap chooses
 * and closes, Escape closes. Choosing changes the button label; it never
 * sends.
 */
export function AmountTray({
  id,
  amounts,
  value,
  allowOther,
  balance,
  onOpenBalance,
  onChange,
  onClose,
  anchor,
}: AmountTrayProps) {
  const balanceWords = balance ? spokenValue(balance) : null
  const labelId = useId()
  const otherId = useId()
  const errorId = useId()
  const root = useRef<HTMLDivElement>(null)
  const [other, setOther] = useState('')
  const [otherError, setOtherError] = useState(false)
  // The chosen quick amount, or -1 when the amount was typed in Other: then
  // no radio is checked, and the first one takes Tab.
  const checkedIndex = amounts.findIndex((a) => a.cents === value?.cents)
  const tabIndexAt = Math.max(0, checkedIndex)

  // Focus the chosen amount on open, as a radio group does.
  useEffect(() => {
    root.current
      ?.querySelector<HTMLButtonElement>('[role="radio"][tabindex="0"]')
      ?.focus()
  }, [])

  // A press outside the tray and its button closes it.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (root.current?.contains(target) || anchor.current?.contains(target))
        return
      onClose(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [anchor, onClose])

  const radios = () =>
    Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []
    )

  const onRadioKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    // A held key chooses once: repeats never close the tray again onto the
    // amount button, nor run past the amounts.
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      return
    }
    const forward = ['ArrowRight', 'ArrowDown']
    const back = ['ArrowLeft', 'ArrowUp']
    let next = index
    // In a right-to-left page, left and right swap.
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    if (forward.includes(event.key))
      next = index + (rtl && event.key === 'ArrowRight' ? -1 : 1)
    else if (back.includes(event.key))
      next = index + (rtl && event.key === 'ArrowLeft' ? 1 : -1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = amounts.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      onClose(true)
      return
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onClose(true)
      return
    } else return
    event.preventDefault()
    next = (next + amounts.length) % amounts.length
    const choice = amounts[next]
    if (!choice) return
    onChange(choice.cents)
    radios()[next]?.focus()
  }

  const submitOther = () => {
    const cents = centsFromInput(other)
    if (cents === null) {
      setOtherError(true)
      return
    }
    onChange(cents)
    onClose(true)
  }

  return (
    <div className="qt-tray" id={id} ref={root}>
      {balance && onOpenBalance ? (
        <button
          type="button"
          className="qt-tray__caption"
          data-control=""
          aria-label={`${balanceWords ?? 'Your balance'} ready to tip. Open balance`}
          onClick={() => {
            onClose(false)
            onOpenBalance()
          }}
        >
          <span aria-hidden="true">
            <MoneyFigure value={balance} size="s" />
          </span>{' '}
          ready to tip
        </button>
      ) : balance ? (
        <p className="qt-tray__caption">
          <MoneyFigure value={balance} size="s" /> ready to tip
        </p>
      ) : null}
      <span className="qt-visually-hidden" id={labelId}>
        Tip amount
      </span>
      <div
        className="qt-tray__amounts"
        role="radiogroup"
        aria-labelledby={labelId}
      >
        {amounts.map((choice, index) => {
          const checked = index === checkedIndex
          return (
            <button
              key={choice.cents}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === tabIndexAt ? 0 : -1}
              className="qt-tray__amount"
              onClick={() => {
                onChange(choice.cents)
                onClose(true)
              }}
              onKeyDown={(event) => onRadioKey(event, index)}
            >
              {choice.display}
            </button>
          )
        })}
      </div>
      {allowOther ? (
        <form
          className="qt-tray__other"
          onSubmit={(event) => {
            event.preventDefault()
            submitOther()
          }}
        >
          <label className="qt-visually-hidden" htmlFor={otherId}>
            Other amount in dollars
          </label>
          <span className="qt-tray__currency" aria-hidden="true">
            $
          </span>
          <input
            id={otherId}
            className="qt-tray__input"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="Other"
            value={other}
            aria-invalid={otherError || undefined}
            aria-describedby={otherError ? errorId : undefined}
            onChange={(event) => {
              setOther(event.target.value)
              setOtherError(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose(true)
              }
            }}
          />
          <button type="submit" className="qt-tray__set">
            Set
          </button>
          {otherError ? (
            <span className="qt-tray__error" id={errorId} role="alert">
              Enter an amount like 2.50
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}
