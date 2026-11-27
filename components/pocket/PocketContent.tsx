'use client'

import { Button } from '@/system/components/Button'
import { EmptyState } from '@/system/components/EmptyState'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { TestnetNote } from '@/system/components/TestnetNote'
import { BalanceIcon } from '@/system/icons'
import { POCKET } from '@/shell/navigation'
import { useBalanceReading } from '@/shell/balance'

/**
 * What the Pocket holds: the one component the shell renders in the phone
 * sheet, the desktop panel and the /pocket page. This file is the Pocket
 * surface's (F2) to replace: keep the export name `PocketContent`, a client
 * component with no props. Until then it shows the spendable figure (from
 * the shell's balance source), a way to sign in when signed out, and the
 * testnet line.
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
