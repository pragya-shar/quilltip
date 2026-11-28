'use client'

import { useActivity } from '@/hooks/payments/useActivity'
import { useEarnings } from '@/hooks/payments/useEarnings'
import { useNow } from '@/hooks/payments/useNow'
import { EarningsScreen } from './EarningsScreen'

/** The earnings screen on the writer's live earnings and tips. */
export function EarningsScreenLive() {
  const earnings = useEarnings()
  const activity = useActivity('writer')
  const now = useNow()
  return <EarningsScreen earnings={earnings} activity={activity} now={now} />
}
