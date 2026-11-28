'use client'

import { useActivity } from '@/hooks/payments/useActivity'
import { useBalance } from '@/hooks/payments/useBalance'
import { useNow } from '@/hooks/payments/useNow'
import { BalanceScreen } from './BalanceScreen'

/** The balance screen on the reader's live balance and tips. */
export function BalanceScreenLive() {
  const balance = useBalance()
  const activity = useActivity('reader')
  const now = useNow()
  return <BalanceScreen balance={balance} activity={activity} now={now} />
}
