'use client'

/**
 * The quick tip for the tip dialog (issue #448 mounts it). Loads the tab
 * library, wallet and payment code with `import()` when it renders, so the
 * article page's first load stays free of them. Props: `TabTipActionProps`.
 */
import dynamic from 'next/dynamic'
import { TabSkeleton } from './TabSkeleton'
import type { TabTipActionProps } from './TabTipAction'
import './tab.css'

const TabTipActionLive = dynamic(
  () =>
    import('./TabTipActionLive').then((m) => ({ default: m.TabTipActionLive })),
  { ssr: false, loading: () => <TabSkeleton lines={2} /> }
)

export function LazyTabTipAction(props: TabTipActionProps) {
  return <TabTipActionLive {...props} />
}
