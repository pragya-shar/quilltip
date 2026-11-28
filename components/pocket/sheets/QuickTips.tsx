'use client'

import '../money/addMoney.css'
import type { SheetBodyProps } from '@/shell/sheets/types'
import type { Money } from '@/lib/payments/types'
import { QuickTipsFlow } from '../money/QuickTipsFlow'
import { useAddMoneyServices } from '../money/services'

export type QuickTipsProps = {
  /** The tip the reader wanted, when a tip opened the sheet. */
  tip?: Money
  /** The server refused the last tip for the approval's limit. */
  limitReached?: boolean
  /** The title's verb, read before the sheet opened. */
  verb?: 'set-up' | 'renew'
} | null

/** The quick tips sheet's body (shell/sheets/pocket.ts). */
export default function QuickTipsSheet({
  props,
  close,
}: SheetBodyProps<QuickTipsProps>) {
  const loaded = useAddMoneyServices()
  if (loaded.status === 'failed')
    return (
      <p className="qt-add__body">
        This did not load. Check your connection, then try again.
      </p>
    )
  if (loaded.status === 'loading')
    return <p className="qt-add__body qt-add__status">Checking this device.</p>
  return (
    <QuickTipsFlow
      services={loaded.services}
      tip={props?.tip ?? null}
      limitReached={props?.limitReached ?? false}
      close={close}
    />
  )
}
