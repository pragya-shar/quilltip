'use client'

import '../pocket.css'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { TestnetNote } from '@/system/components/TestnetNote'
import { TextLink } from '@/system/components/TextLink'
import type { SheetBodyProps } from '@/shell/sheets/types'
import { notePress } from './notePress'
import { MoneyActPanel } from '../MoneyActPanel'
import { ADD_MONEY_PAGE } from '../sheetIds'
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
    <div className="qt-pocket__sheet" onPointerDownCapture={notePress}>
      {known && balance.available ? (
        <p className="qt-pocket__plain">
          You have <MoneyFigure value={balance.available} size="s" /> ready to
          tip.
        </p>
      ) : null}
      {need ? (
        <p className="qt-pocket__plain">
          Nothing is sent until you tap Tip again.
        </p>
      ) : null}
      <MoneyActPanel
        act={act}
        onDone={close}
        unbuilt={
          <>
            <p className="qt-pocket__plain">
              You add testnet money from a Stellar wallet on the current balance
              page.
            </p>
            <p className="qt-pocket__plain">
              <TextLink href={ADD_MONEY_PAGE}>Add testnet money</TextLink>
            </p>
          </>
        }
      />
      <TestnetNote />
    </div>
  )
}
