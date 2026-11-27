'use client'

import { TabServicesContext } from '@/hooks/tab/TabServicesContext'
import { useLiveTabServices } from '@/hooks/tab/useLiveTabServices'
import type { LazyTabTipProps } from './LazyTabTipAction'
import { TabTipAction } from './TabTipAction'
import { TabTipDialogSection } from './TabTipDialogSection'

export function TabTipActionLive(props: LazyTabTipProps) {
  const services = useLiveTabServices()
  return (
    <TabServicesContext.Provider value={services}>
      {props.layout === 'dialog' ? (
        <TabTipDialogSection {...props} />
      ) : (
        <TabTipAction {...props} />
      )}
    </TabServicesContext.Provider>
  )
}
