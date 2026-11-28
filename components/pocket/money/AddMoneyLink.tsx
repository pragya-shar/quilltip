'use client'

import type { ReactNode } from 'react'
import { AppLink } from '@/system/components/AppLink'
import { sheetStack } from '@/shell/sheetStack'
import { declaredSheet } from '@/shell/sheets'
import { warmSheet } from '@/shell/sheets/preload'
import { ADD_MONEY_PAGE, ADD_MONEY_SHEET } from '../sheetIds'

/**
 * "Add testnet money" as a real link to the page that adds money, so it
 * works with no script; once the Add money sheet is known, a press opens
 * the sheet over what the reader is doing instead.
 */
export function AddMoneyLink({ children }: { children: ReactNode }) {
  return (
    <AppLink
      href={ADD_MONEY_PAGE}
      className="qt-button"
      data-variant="secondary"
      data-size="m"
      {...warmSheet(ADD_MONEY_SHEET)}
      onClick={(event) => {
        if (!declaredSheet(ADD_MONEY_SHEET)) return
        event.preventDefault()
        sheetStack.open(ADD_MONEY_SHEET)
      }}
    >
      <span className="qt-button__label">{children}</span>
    </AppLink>
  )
}
