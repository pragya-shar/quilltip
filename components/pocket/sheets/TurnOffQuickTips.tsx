'use client'

import '../money/addMoney.css'
import type { SheetBodyProps } from '@/shell/sheets/types'
import { TurnOffFlow } from '../money/TurnOffFlow'
import { useAddMoneyServices } from '../money/services'

export type TurnOffProps = {
  keyId: number
  /** This browser holds the approval. */
  here: boolean
}

/** The turn off sheet's body (shell/sheets/pocket.ts). */
export default function TurnOffSheet({
  props,
  close,
}: SheetBodyProps<TurnOffProps>) {
  const loaded = useAddMoneyServices()
  if (loaded.status === 'failed')
    return (
      <p className="qt-add__body">
        This did not load. Check your connection, then try again.
      </p>
    )
  if (loaded.status === 'loading')
    return <p className="qt-add__body qt-add__status">Checking.</p>
  return (
    <TurnOffFlow services={loaded.services} keyId={props.keyId} close={close} />
  )
}
