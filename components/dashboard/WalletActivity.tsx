'use client'

import { WalletTipHistory } from '@/components/account/WalletTipHistory'
import { useTipActivity } from '@/hooks/convex/useTipActivity'

export function WalletActivity() {
  const activity = useTipActivity()
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
  return <WalletTipHistory items={activity.items} />
}
