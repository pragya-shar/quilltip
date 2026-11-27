'use client'

import '../pocket.css'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { TestnetNote } from '@/system/components/TestnetNote'
import { TextLink } from '@/system/components/TextLink'
import type { SheetBodyProps } from '@/shell/sheets/types'
import { MoneyActPanel } from '../MoneyActPanel'
import { usePocketSource } from '@/lib/pocket/source'

/**
 * Withdraw a writer's earnings: exactly what is ready to withdraw, never
 * tips still on their way (declared in shell/sheets/pocket.ts). The balance
 * links here only once the money layer can withdraw; until then the
 * body says what is and is not possible today.
 */
export default function WithdrawBody({ close }: SheetBodyProps<unknown>) {
  const source = usePocketSource()
  const earnings = source.useEarnings()
  const act = source.useWithdraw()
  const ready = earnings.status === 'ready'
  return (
    <div className="qt-pocket__sheet">
      <MoneyFigure
        value={ready ? earnings.available : null}
        status={
          ready
            ? 'ready'
            : earnings.status === 'loading'
              ? 'loading'
              : 'unavailable'
        }
        size="l"
        label="Ready to withdraw. Tips on their way are not included."
        unavailableText="Not available right now"
      />
      <MoneyActPanel
        act={act}
        onDone={close}
        unbuilt={
          <>
            <p className="qt-pocket__plain">
              You cannot withdraw from here yet. Withdrawing to a Stellar
              testnet wallet arrives in a later update; your earnings stay here,
              ready.
            </p>
            <p className="qt-pocket__plain">
              Until then,{' '}
              <TextLink href="/dashboard/stats">
                collect them on the current earnings page
              </TextLink>
              .
            </p>
          </>
        }
      />
      <TestnetNote />
    </div>
  )
}
