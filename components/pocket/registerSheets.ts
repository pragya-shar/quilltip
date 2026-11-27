'use client'

import { registerSheet } from '@/shell/sheetRegistry'
import { AddMoneySheet, type AddMoneyProps } from './AddMoneySheet'
import { ReceiptSheet, type ReceiptProps } from './ReceiptSheet'
import { ADD_MONEY_SHEET, RECEIPT_SHEET, WITHDRAW_SHEET } from './sheetIds'
import { WithdrawSheet } from './WithdrawSheet'

/** Adds the Pocket's sheets to the shell's stack, once. */
let registered = false
export function registerPocketSheets() {
  if (registered) return
  registered = true
  registerSheet<AddMoneyProps>(ADD_MONEY_SHEET, AddMoneySheet)
  registerSheet<unknown>(WITHDRAW_SHEET, WithdrawSheet)
  registerSheet<ReceiptProps>(RECEIPT_SHEET, ReceiptSheet)
}
