'use client'

import { TabServicesContext } from '@/hooks/tab/TabServicesContext'
import { useLiveTabServices } from '@/hooks/tab/useLiveTabServices'
import { TabHome } from './TabHome'

/** The tab home with the app's services (Convex, wallet, Stellar RPC). */
export function TabHomeLive() {
  const services = useLiveTabServices()
  return (
    <TabServicesContext.Provider value={services}>
      <TabHome />
    </TabServicesContext.Provider>
  )
}
