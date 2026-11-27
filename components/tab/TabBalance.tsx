import { TestnetLabel, XlmAmount } from '@/components/payments'
import { TAB_BALANCE } from '@/lib/copy/tab'
import type { TabBalances } from '@/lib/tab-ui/tab-status'

/**
 * The three tab figures, from indexed chain values. While the tab is
 * closing, the free figure is what comes back, not what quick tips can use.
 */
export function TabBalance({
  balances,
  closing = false,
}: {
  balances: TabBalances
  closing?: boolean
}) {
  return (
    <section className="tab-section" aria-labelledby="tab-balance-title">
      <h2 id="tab-balance-title" className="sr-only">
        {TAB_BALANCE.heading}
      </h2>
      <dl className="tab-figures">
        <div
          className="tab-figure"
          data-primary={closing ? undefined : ''}
          data-closing={closing || undefined}
        >
          <dt>{closing ? TAB_BALANCE.closingFree : TAB_BALANCE.free}</dt>
          <dd>
            <XlmAmount amount={balances.free} />
            <span className="tab-figure-note">
              {closing ? TAB_BALANCE.closingFreeNote : TAB_BALANCE.freeNote}
            </span>
          </dd>
        </div>
        <div className="tab-figure">
          <dt>{TAB_BALANCE.settling}</dt>
          <dd>
            <XlmAmount amount={balances.committed} />
            <span className="tab-figure-note">{TAB_BALANCE.settlingNote}</span>
          </dd>
        </div>
        <div className="tab-figure">
          <dt>{TAB_BALANCE.confirmed}</dt>
          <dd>
            <XlmAmount amount={balances.confirmed} />
            <span className="tab-figure-note">{TAB_BALANCE.confirmedNote}</span>
          </dd>
        </div>
      </dl>
      <TestnetLabel detail />
    </section>
  )
}
