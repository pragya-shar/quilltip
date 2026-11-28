'use client'

import type { TabServices } from '@/lib/tab-ui/types'
import {
  settlementHealth,
  tabPaused,
  tabStatusView,
} from '@/lib/tab-ui/tab-status'
import { useDeviceKey } from './useDeviceKey'
import { useLedgerClock } from './useLedgerClock'

/**
 * Everything the reader's tab screens read: the wallet and account gate, the
 * tab (`getMyTab`), recent tab tips, the chain configuration, the ledger
 * clock and this browser's quick-tip key.
 */
export function useReaderTab(services: TabServices) {
  const access = services.useWalletAccess()
  const tab = services.useMyTab()
  const activity = services.useMyTabTips()
  const chainConfig = services.useChainConfig()
  const tabSettlement = services.useTabSettlement()
  const { clock, failed: clockFailed } = useLedgerClock(services)
  const device = useDeviceKey(services, tab, clock, access.address, clockFailed)
  return {
    access,
    tab,
    activity,
    chainConfig,
    tabSettlement,
    clock,
    clockFailed,
    device,
    status: tabStatusView({ tab, chainConfig, clock, now: services.now() }),
    settlement: settlementHealth(activity, services.now(), tabSettlement),
    paused: tabPaused(chainConfig),
  }
}

export type ReaderTab = ReturnType<typeof useReaderTab>
