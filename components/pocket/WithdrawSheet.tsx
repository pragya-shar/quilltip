'use client'

import './pocket.css'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Sheet } from '@/system/components/Sheet'
import { TestnetNote } from '@/system/components/TestnetNote'
import { TextLink } from '@/system/components/TextLink'
import type { SheetComponentProps } from '@/shell/sheetRegistry'
import { MoneyActPanel } from './MoneyActPanel'
import { usePocketSource } from './source'

/**
 * Withdraw a writer's earnings: only what is ready to withdraw, never tips
 * still on their way. Until collect exists in the backend (B4) it says what
 * will be possible and where earnings can be collected today.
 */
export function WithdrawSheet({ open, onClose }: SheetComponentProps<unknown>) {
  const source = usePocketSource()
  const earnings = source.useEarnings()
  const act = source.useWithdraw()
  const ready = earnings.status === 'ready'
  return (
    <Sheet open={open} onClose={onClose} title="Withdraw">
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
          size="m"
          label="Ready to withdraw. Tips on their way are not included."
          unavailableText="Not available right now"
        />
        <MoneyActPanel
          act={act}
          onDone={onClose}
          unbuilt={
            <>
              <p className="qt-pocket__plain">
                Soon you can send this to your Stellar testnet wallet from here.
                It arrives in seconds.
              </p>
              <p className="qt-pocket__plain">
                For now,{' '}
                <TextLink href="/dashboard/stats">
                  collect it on the current earnings page
                </TextLink>
                .
              </p>
            </>
          }
        />
        <TestnetNote />
      </div>
    </Sheet>
  )
}
