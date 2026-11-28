import { TestnetLabel } from '@/components/payments'
import { TAB_HISTORY } from '@/lib/copy/tab'
import type { MyTabTips } from '@/lib/tab-ui/types'
import { TabTipRow } from './TabTipRow'

/** Recent tab tips, newest first, with each receipt's settlement status. */
export function TabTipHistory({
  activity,
  tabShort = false,
}: {
  activity: MyTabTips | null
  /** The open tab is short: accepted tips wait for a top-up (#643). */
  tabShort?: boolean
}) {
  const tips = activity?.tips ?? []
  return (
    <section className="tab-section" aria-labelledby="tab-history-title">
      <header>
        <h2 id="tab-history-title" className="tab-section-title">
          {TAB_HISTORY.heading}
        </h2>
        {tips.length > 0 ? <TestnetLabel /> : null}
      </header>
      {tips.length > 0 ? (
        <ul className="tab-list">
          {tips.map((tip) => (
            <li key={tip.receiptId}>
              <TabTipRow tip={tip} tabShort={tabShort} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="tab-subtle">{TAB_HISTORY.empty}</p>
      )}
    </section>
  )
}
