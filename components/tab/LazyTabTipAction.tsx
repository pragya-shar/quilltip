'use client'

/**
 * The quick tip from the tab. Loads the tab library, wallet and payment code
 * with `import()` when it renders, so the article page's first load stays
 * free of them.
 *
 * - `layout="dialog"`: the tip dialog's "from your tab" section, sending the
 *   dialog's amount (`TabTipDialogProps`).
 * - otherwise: the standalone quick tip with its own presets
 *   (`TabTipActionProps`).
 */
import dynamic from 'next/dynamic'
import { TabSkeleton } from './TabSkeleton'
import { TabTipDialogSkeleton } from './TabTipDialogSkeleton'
import type { TabTipActionProps } from './TabTipAction'
import type { TabTipDialogProps } from './TabTipDialogSection'
import './tab.css'

export type LazyTabTipProps =
  | (TabTipActionProps & { layout?: 'standalone' })
  | (TabTipDialogProps & { layout: 'dialog' })

const load = () =>
  import('./TabTipActionLive').then((m) => ({ default: m.TabTipActionLive }))

const TabTipActionLive = dynamic(load, {
  ssr: false,
  loading: () => <TabSkeleton lines={2} />,
})
const TabTipDialogLive = dynamic(load, {
  ssr: false,
  loading: () => <TabTipDialogSkeleton />,
})

export function LazyTabTipAction(props: LazyTabTipProps) {
  return props.layout === 'dialog' ? (
    <TabTipDialogLive {...props} />
  ) : (
    <TabTipActionLive {...props} />
  )
}
