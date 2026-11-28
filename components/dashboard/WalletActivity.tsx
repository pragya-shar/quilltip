'use client'

import { useQuery } from 'convex/react'
import { WalletTipHistory } from '@/components/account/WalletTipHistory'
import { api } from '@/convex/_generated/api'
import { useTipActivity } from '@/hooks/convex/useTipActivity'
import { tabIsShort } from '@/lib/tab-ui/tab-short'

export function WalletActivity() {
  const activity = useTipActivity()
  // The tab page's query (`getMyTab`): null with no tab, so nothing waits.
  const tab = useQuery(api.tabs.getMyTab, {})
  if (activity.status === 'loading')
    return (
      <section
        className="account-tip-history"
        aria-labelledby="tip-history-title"
      >
        <h2 id="tip-history-title">Tip history</h2>
        <p role="status" className="account-muted">
          Loading your tips…
        </p>
      </section>
    )
  return (
    <WalletTipHistory items={activity.items} readerTabShort={tabIsShort(tab)} />
  )
}
