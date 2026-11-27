'use client'

import { Button } from '@/system/components/Button'
import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Notice } from '@/system/components/Notice'
import { AddIcon, PendingIcon } from '@/system/icons'
import { sheetStack } from '@/shell/sheetStack'
import { warmSheet } from '@/shell/sheets/preload'
import { ADD_MONEY_SHEET, EXACT_AMOUNT_SHEET } from './sheetIds'
import { usePocketSource } from './source'
import type { BalanceView } from './types'

/**
 * What the person can tip with now: one figure, exactly as the money layer
 * writes it, with the exact token amount one tap away. Tips on their way
 * out are said in words beside it (they are already out of it), never as a
 * second balance. Add money appears only once the money layer can add money
 * ; until then a line says how money arrives.
 */
export function SpendableSection({
  balance,
  compact,
}: {
  balance: BalanceView
  /** A writer: the earnings below lead, so this figure is smaller. */
  compact: boolean
}) {
  const source = usePocketSource()
  const addMoney = source.useAddMoney()
  const status =
    balance.status === 'loading'
      ? 'loading'
      : balance.status === 'unavailable' || balance.status === 'signed-out'
        ? 'unavailable'
        : 'ready'
  const available = status === 'ready' ? balance.available : null
  // The money layer says which figure is converted at today's price; the screen
  // never decides it.
  const converted = available?.converted === true
  const exact = status === 'ready' ? balance.exact : null
  const outgoing =
    status === 'ready' && balance.pending && balance.pending.cents > 0
      ? balance.pending
      : null
  const figure = (
    <MoneyFigure
      value={available}
      status={status}
      size={compact ? 'm' : 'xl'}
      label="Ready to tip"
      unavailableText="Not available right now"
    />
  )
  return (
    <section className="qt-pocket__spend" aria-label="Ready to tip">
      {converted && exact ? (
        // A converted figure is a button: it opens the exact token amount
        // with an explanation.
        <button
          type="button"
          className="qt-pocket__figure-button"
          aria-haspopup="dialog"
          {...warmSheet(EXACT_AMOUNT_SHEET)}
          onClick={() => sheetStack.open(EXACT_AMOUNT_SHEET)}
        >
          {figure}
          <span className="qt-visually-hidden">. Show the exact amount</span>
        </button>
      ) : (
        figure
      )}
      {converted ? (
        <p className="qt-pocket__fine">
          Held in Lumens. The dollar figure moves with the price.
        </p>
      ) : null}
      {outgoing ? (
        <p className="qt-pocket__line">
          <Icon icon={PendingIcon} size={16} />
          <span>
            <MoneyFigure value={outgoing} size="s" /> in tips on its way to
            writers. It is already taken out of what you can tip.
          </span>
        </p>
      ) : null}
      {balance.status === 'closing' ? (
        <Notice tone="pending">
          Your balance is being withdrawn. Tipping is paused until it finishes.
        </Notice>
      ) : null}
      {addMoney ? (
        <Button
          variant={compact ? 'secondary' : 'primary'}
          icon={AddIcon}
          {...warmSheet(ADD_MONEY_SHEET)}
          onClick={() => sheetStack.open(ADD_MONEY_SHEET)}
        >
          Add money
        </Button>
      ) : status === 'ready' ? (
        <p className="qt-pocket__fine">
          New accounts get $5 of testnet practice money. More ways to add money
          come later.
        </p>
      ) : null}
    </section>
  )
}
