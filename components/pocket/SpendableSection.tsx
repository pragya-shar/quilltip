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
import type { BalanceView } from './types'

/**
 * What the person can tip with now: one figure, with money on its way in
 * and tips on their way out said apart from it in words, never as a second
 * or third balance. Converted dollars carry "≈"; the exact token amount is
 * one tap away. Testnet is said here, under the first figure.
 */
export function SpendableSection({
  balance,
  authLoading,
  quietAdd,
}: {
  balance: BalanceView
  /** Who is here is not known yet. */
  authLoading: boolean
  /** A writer with money to withdraw: Withdraw is the main action. */
  quietAdd: boolean
}) {
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
  const arriving =
    status === 'ready' && balance.arriving && balance.arriving.cents > 0
      ? balance.arriving
      : null
  const outgoing =
    status === 'ready' && balance.pending && balance.pending.cents > 0
      ? balance.pending
      : null
  return (
    <section className="qt-pocket__spend" aria-label="Ready to tip">
      <MoneyFigure
        value={available}
        status={status}
        size="xl"
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
                <span className="qt-pocket__token">{exact.available}</span> on
                Stellar testnet.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
      {arriving ? (
        <p className="qt-pocket__line">
          <Icon icon={PendingIcon} size={16} />
          <span>
            <MoneyFigure value={arriving} size="s" /> on its way in. You can tip
            with it once it arrives.
          </span>
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
