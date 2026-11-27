'use client'

import { TabServicesContext } from '@/hooks/tab/TabServicesContext'
import { useLiveTabServices } from '@/hooks/tab/useLiveTabServices'
import { CollectPanel } from './CollectPanel'

export function CollectPanelLive() {
  const services = useLiveTabServices()
  return (
    <TabServicesContext.Provider value={services}>
      <CollectPanel />
    </TabServicesContext.Provider>
  )
}
