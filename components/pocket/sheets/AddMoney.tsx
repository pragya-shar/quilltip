'use client'

import '../money/addMoney.css'
import type { SheetBodyProps } from '@/shell/sheets/types'
import type { Money } from '@/lib/payments/types'
import { AddMoneyFlow } from '../money/AddMoneyFlow'
import { useAddMoneyServices } from '../money/services'

export type AddMoneyProps = {
  /** The tip the balance could not cover, when a tip opened the sheet. */
  need?: Money
} | null

/**
 * The Add money sheet's body (declared in shell/sheets/pocket.ts; the tip
 * bar opens it with `{ need }`). It loads its services with it, so the
 * wallet kit and the Stellar client never reach a first load.
 */
export default function AddMoneySheet({
  props,
  close,
}: SheetBodyProps<AddMoneyProps>) {
  const loaded = useAddMoneyServices()
  if (loaded.status === 'failed')
    return (
      <p className="qt-add__body">
        Adding money did not load. Check your connection, then try again.
      </p>
    )
  if (loaded.status === 'loading')
    return <p className="qt-add__body qt-add__status">Checking your wallet.</p>
  return (
    <AddMoneyFlow
      services={loaded.services}
      need={props?.need ?? null}
      close={close}
    />
  )
}
