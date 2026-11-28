'use client'

import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useTipActivity } from '@/hooks/convex/useTipActivity'
import { WalletActivityView } from './WalletActivityView'

export function WalletActivity() {
  const activity = useTipActivity()
  // The tab page's query (`getMyTab`): null with no tab, so nothing waits.
  const tab = useQuery(api.tabs.getMyTab, {})
  return <WalletActivityView activity={activity} tab={tab} />
}
