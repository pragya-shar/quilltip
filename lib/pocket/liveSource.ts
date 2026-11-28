'use client'

import { useConvex } from 'convex/react'
import { useActivity } from '@/hooks/payments/useActivity'
import { useBalance } from '@/hooks/payments/useBalance'
import { useEarnings } from '@/hooks/payments/useEarnings'
import { formatMoney, formatTokenAmount } from '@/lib/payments/money'
import { sheetStack } from '@/shell/sheetStack'
import type { MoneyAct, PocketSource } from './source'

const ADD_MONEY_ACT: MoneyAct = {
  label: 'Add money',
  state: { phase: 'idle' },
  start: () => void sheetStack.open('add-money'),
  reset: () => {},
}

/**
 * The balance on the money layer (hooks/payments). Only the balance's own
 * components import this, and they load with the sheet or panel when it
 * opens and with /pocket, never in a public first load. Withdrawing is not
 * in the money layer yet, so that sheet says what will be possible and
 * offers no action.
 */
export const liveSource: PocketSource = {
  // A backend client is there in the app; not in a page rendered without it.
  useWired: () => Boolean(useConvex()),
  format: {
    money: (cents) => formatMoney(cents),
    token: (baseUnits) => formatTokenAmount(baseUnits),
  },
  useBalance,
  useEarnings,
  useActivity,
  // Adding money is its own sheet (components/pocket/sheets/AddMoney.tsx):
  // the act only says that it exists here and opens that sheet.
  useAddMoney: () => ADD_MONEY_ACT,
  useWithdraw: () => null,
}
