'use client'

import { useId, useState } from 'react'
import { Button } from '@/system/components/Button'
import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Notice } from '@/system/components/Notice'
import { TestnetNote } from '@/system/components/TestnetNote'
import { AddIcon, PendingIcon } from '@/system/icons'
import { sheetStack } from '@/shell/sheetStack'
import { ADD_MONEY_SHEET } from './sheetIds'
import { usePocketSource } from './source'
import type { BalanceView } from './types'

/** Whole-dollar digits in a display string ("≈ $1,254.66" has four): a
 * figure that long shrinks to fit a 360 px column. Layout only. */
function wholeDigits(display: string): number {
  const whole = display.split('.')[0] ?? ''
  return whole.replace(/\D/g, '').length
}

/**
 * What the person can tip with now: one figure. Tips on their way out are
 * said in words beside it (they are already out of it), never as a second
 * balance. A converted figure carries "≈"; the exact token amount is one tap
 * away. Testnet is said here, under the first figure.
 */
export function SpendableSection({
  balance,
  authLoading,
  compact,
  quietAdd,
}: {
  balance: BalanceView
  /** Who is here is not known yet. */
  authLoading: boolean
  /** A writer: the earnings below lead, so this figure is smaller. */
  compact: boolean
  /** A writer with money to withdraw: Withdraw is the one primary action. */
  quietAdd: boolean
}) {
  const { format } = usePocketSource()
  const [showExact, setShowExact] = useState(false)
  const exactId = useId()
  const status =
    authLoading || balance.status === 'loading'
      ? 'loading'
      : balance.status === 'unavailable' || balance.status === 'signed-out'
        ? 'unavailable'
        : 'ready'
  const available = status === 'ready' ? balance.available : null
  const estimate = available?.display.startsWith('≈') ?? false
  const exact = status === 'ready' ? balance.exact : null
  const outgoing =
    status === 'ready' && balance.pending && balance.pending.cents > 0
      ? balance.pending
      : null
  return (
    <section
      className="qt-pocket__spend"
      aria-label="Ready to tip"
      data-long={
        available && wholeDigits(available.display) >= 3 ? '' : undefined
      }
    >
      <MoneyFigure
        value={available}
        status={status}
        size={compact ? 'm' : 'xl'}
        label="Ready to tip"
        unavailableText="Not available right now"
      />
      {estimate ? (
        <div className="qt-pocket__estimate">
          <p className="qt-pocket__fine">An estimate at today&rsquo;s price.</p>
          {exact ? (
            <>
              <button
                type="button"
                className="qt-pocket__reveal"
                aria-expanded={showExact}
                aria-controls={exactId}
                onClick={() => setShowExact((on) => !on)}
              >
                {showExact ? 'Hide exact amount' : 'Show exact amount'}
              </button>
              <p id={exactId} className="qt-pocket__fine" hidden={!showExact}>
                Held as{' '}
                <span className="qt-pocket__token">
                  {format.token(exact.available)}
                </span>{' '}
                on Stellar testnet.
              </p>
            </>
          ) : null}
        </div>
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
      <Button
        variant={quietAdd ? 'secondary' : 'primary'}
        icon={AddIcon}
        onClick={() => sheetStack.open(ADD_MONEY_SHEET)}
      >
        Add money
      </Button>
      <TestnetNote />
    </section>
  )
}
