'use client'

import './pocket.css'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Sheet } from '@/system/components/Sheet'
import { TestnetNote } from '@/system/components/TestnetNote'
import { TextLink } from '@/system/components/TextLink'
import type { SheetComponentProps } from '@/shell/sheetRegistry'
import { MoneyActPanel } from './MoneyActPanel'
import { usePocketSource } from './source'
import type { Money } from './types'

export type AddMoneyProps = {
  /** The tip this person could not afford, when the tip control opened it. */
  need?: Money
} | null

/**
 * Add money, over whatever the person is doing. Until the practice money of
 * slice 2 exists in the backend it says what will be possible, and where
 * money can be added today, with no button that pretends to work. Nothing
 * here sends a tip: after adding, the tip needs its own tap (D15).
 */
export function AddMoneySheet({
  open,
  onClose,
  props,
}: SheetComponentProps<AddMoneyProps>) {
  const source = usePocketSource()
  const balance = source.useBalance()
  const act = source.useAddMoney()
  const need = props?.need ?? null
  const known = balance.status === 'ready' || balance.status === 'none'
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={need ? `Add money to tip ${need.display}` : 'Add money'}
    >
      <div className="qt-pocket__sheet">
        {known && balance.available ? (
          <p className="qt-pocket__plain">
            You have <MoneyFigure value={balance.available} size="s" /> ready to
            tip.
            {need ? ' Nothing is sent until you tap Tip again.' : null}
          </p>
        ) : null}
        <MoneyActPanel
          act={act}
          onDone={onClose}
          unbuilt={
            <>
              <p className="qt-pocket__plain">
                Soon you can add $5 of practice money here, once, at no cost.
                Practice money is Stellar testnet money: it has no value and is
                only for trying Quilltip.
              </p>
              <p className="qt-pocket__plain">
                After that, you can add money from a Stellar testnet wallet you
                connect.
              </p>
              <p className="qt-pocket__plain">
                For now,{' '}
                <TextLink href="/dashboard/tab">
                  add money on the current balance page
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
