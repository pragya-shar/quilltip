'use client'

import { createContext, useContext } from 'react'
import type { TabServices } from '@/lib/tab-ui/types'

/** Supplies `TabServices` to the tab screens: live in the app, stubbed in fixtures. */
export const TabServicesContext = createContext<TabServices | null>(null)

export function useTabServices(): TabServices {
  const services = useContext(TabServicesContext)
  if (!services) {
    throw new Error('Tab screens need a TabServicesContext provider.')
  }
  return services
}
