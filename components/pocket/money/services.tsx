'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useConvex } from 'convex/react'
import type { AddMoneyServices } from '@/lib/addMoney/services'

/**
 * The services the Add money, quick tips and turn off sheets use. A
 * fixture provides its own (an emulated wallet and chain); the app loads
 * the live ones with the sheet, so the Stellar client and the wallet kit
 * never reach a first load.
 */
export const AddMoneyServicesContext = createContext<AddMoneyServices | null>(
  null
)

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; services: AddMoneyServices }
  | { status: 'failed' }

/** The provided services, or the live ones once loaded. */
export function useAddMoneyServices(): Loaded {
  const provided = useContext(AddMoneyServicesContext)
  const convex = useConvex()
  const [live, setLive] = useState<Loaded>({ status: 'loading' })
  useEffect(() => {
    if (provided) return
    // No backend client (a page rendered without one): nothing to load.
    if (!convex) {
      setLive({ status: 'failed' })
      return
    }
    let alive = true
    import('@/lib/addMoney/live/services')
      .then((m) => {
        if (alive)
          setLive({ status: 'ready', services: m.createLiveServices(convex) })
      })
      .catch(() => alive && setLive({ status: 'failed' }))
    return () => {
      alive = false
    }
  }, [provided, convex])
  return provided ? { status: 'ready', services: provided } : live
}

export function AddMoneyServicesProvider({
  services,
  children,
}: {
  services: AddMoneyServices
  children: ReactNode
}) {
  return (
    <AddMoneyServicesContext.Provider value={services}>
      {children}
    </AddMoneyServicesContext.Provider>
  )
}
