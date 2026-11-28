import { WalletTipHistory } from '@/components/account/WalletTipHistory'
import type { useTipActivity } from '@/hooks/convex/useTipActivity'
import { tabIsShort } from '@/lib/tab-ui/tab-short'
import type { MyTab } from '@/lib/tab-ui/types'

/**
 * The wallet page's tip history once the tips and the reader's tab are both
 * known. An accepted tab tip's wording depends on the tab (#643), so the
 * history waits for it: a short tab never shows the timed wording first.
 */
export function WalletActivityView({
  activity,
  tab,
}: {
  activity: ReturnType<typeof useTipActivity>
  /** `getMyTab`: undefined while loading, null with no tab. */
  tab: Pick<MyTab, 'status' | 'available'> | null | undefined
}) {
  if (activity.status === 'loading' || tab === undefined)
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
