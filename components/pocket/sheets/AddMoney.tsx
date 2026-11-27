'use client'

import '../pocket.css'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { TestnetNote } from '@/system/components/TestnetNote'
import { TextLink } from '@/system/components/TextLink'
import type { SheetBodyProps } from '@/shell/sheets/types'
import { MoneyActPanel } from '../MoneyActPanel'
import { usePocketSource } from '@/lib/pocket/source'
import type { Money } from '@/lib/pocket/types'

export type AddMoneyProps = {
  /** The tip this person could not afford, when the tip bar opened it. */
  need?: Money
} | null

/**
 * Add money (declared in shell/sheets/pocket.ts; the tip bar opens it with
 * `{ need }` when the balance is short). Until the money layer can add
 * money it says plainly what is and is not possible on testnet today, with
 * no button that pretends to work. Nothing here sends a tip: after adding,
 * the tip needs its own tap.
 */
export default function AddMoneyBody({
  props,
  close,
}: SheetBodyProps<AddMoneyProps>) {
  const source = usePocketSource()
  const balance = source.useBalance()
  const act = source.useAddMoney()
  const need = props?.need ?? null
  const known = balance.status === 'ready' || balance.status === 'none'
  return (
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
        onDone={close}
        unbuilt={
          <>
            <p className="qt-pocket__plain">
              You cannot add money here yet. New accounts get $5 of testnet
              practice money; adding money from a Stellar testnet wallet comes
              in a later update.
            </p>
            <p className="qt-pocket__plain">
              Until then,{' '}
              <TextLink href="/dashboard/tab">
                add testnet money on the current balance page
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
