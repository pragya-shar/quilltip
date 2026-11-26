'use client'

import { TabServicesContext } from '@/hooks/tab/TabServicesContext'
import { useLiveTabServices } from '@/hooks/tab/useLiveTabServices'
import { TabTipAction, type TabTipActionProps } from './TabTipAction'

export function TabTipActionLive(props: TabTipActionProps) {
  const services = useLiveTabServices()
  return (
    <TabServicesContext.Provider value={services}>
      <TabTipAction {...props} />
    </TabServicesContext.Provider>
  )
}
