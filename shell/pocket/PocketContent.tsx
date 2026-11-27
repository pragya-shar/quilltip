'use client'

import { Button } from '@/system/components/Button'
import { EmptyState } from '@/system/components/EmptyState'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { TestnetNote } from '@/system/components/TestnetNote'
import { BalanceIcon } from '@/system/icons'
import { POCKET } from '../navigation'
import { useBalanceReading } from '../balance'

/**
 * What the Pocket holds, until the Money surface replaces this file's body:
 * the spendable figure (from the shell's balance source), a way to sign in
 * when signed out, and the testnet line. Add money, Withdraw and activity
 * arrive with the Money surface.
 */
export function PocketContent() {
  const reading = useBalanceReading()
  if (reading.auth === 'signed-out') {
    return (
      <div className="qt-pocket">
        <EmptyState
          icon={BalanceIcon}
          title="Sign in to tip and keep your lines."
          action={
            <Button variant="primary" href={POCKET.signIn}>
              Sign in
            </Button>
          }
        />
        <TestnetNote />
      </div>
    )
  }
  return (
    <div className="qt-pocket">
      <MoneyFigure
        value={reading.available}
        status={reading.auth === 'loading' ? 'loading' : reading.status}
        size="xl"
        label="Ready to tip"
      />
      <EmptyState title="Your money activity shows up here." />
      <TestnetNote />
    </div>
  )
}
