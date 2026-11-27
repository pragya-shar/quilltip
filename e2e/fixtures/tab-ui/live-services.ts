/**
 * Stands in for `hooks/tab/useLiveTabServices` on the dialog page: the tip
 * dialog's lazy tab section gets the fixture's services (session.ts), so it
 * talks to the stand-in backend instead of Convex and Stellar RPC.
 */
import type { TabServices } from '../../../lib/tab-ui/types'
import { services } from './session'

export function useLiveTabServices(): TabServices {
  return services
}

export function liveTabConfig() {
  return services.config()
}
