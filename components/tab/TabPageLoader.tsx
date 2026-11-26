'use client'

/**
 * The tab page entry. Every tab, payment and wallet module loads through
 * this `import()` when the reader opens the page, never in a first load
 * (scripts/perf).
 */
import dynamic from 'next/dynamic'
import { TAB_PAGE } from '@/lib/copy/tab'
import { TabSkeleton } from './TabSkeleton'
import './tab.css'

const TabHomeLive = dynamic(
  () => import('./TabHomeLive').then((m) => ({ default: m.TabHomeLive })),
  { ssr: false, loading: () => <TabSkeleton /> }
)

export function TabPageLoader() {
  return (
    <div className="tab-ui">
      <div className="account-heading">
        <h1>{TAB_PAGE.title}</h1>
        <p>{TAB_PAGE.intro}</p>
      </div>
      <TabHomeLive />
    </div>
  )
}
