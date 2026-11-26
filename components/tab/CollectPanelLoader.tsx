'use client'

/** Loads the writer's collect panel with `import()` on the stats page. */
import dynamic from 'next/dynamic'
import { TabSkeleton } from './TabSkeleton'
import './tab.css'

const CollectPanelLive = dynamic(
  () =>
    import('./CollectPanelLive').then((m) => ({ default: m.CollectPanelLive })),
  { ssr: false, loading: () => <TabSkeleton lines={3} /> }
)

export function CollectPanelLoader() {
  return (
    <div className="tab-ui">
      <CollectPanelLive />
    </div>
  )
}
