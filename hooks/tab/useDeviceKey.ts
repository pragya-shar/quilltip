'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LocalSessionKeyInfo, SessionKeyScope } from '@/lib/stellar/v2/tab'
import { noteSeenKeyIds, seenKeyIds } from '@/lib/tab-ui/device-memory'
import { deviceKeyView, type DeviceKeyView } from '@/lib/tab-ui/key-plan'
import type { LedgerClock, MyTab, TabServices } from '@/lib/tab-ui/types'

export type DeviceKey = {
  /** Undefined while the key store loads. */
  view: DeviceKeyView | undefined
  scope: SessionKeyScope | null
  localKeys: LocalSessionKeyInfo[] | null | undefined
  /** Re-reads this browser's keys (after a key operation). */
  refresh(): Promise<void>
}

/**
 * This browser's quick-tip key against `getMyTab().keys`. Binds pending keys
 * to their on-chain ids as soon as Convex lists them (README: `bindKeyIds`
 * after `getMyTab`), and notes the bound ids for the "gone" state.
 */
export function useDeviceKey(
  services: TabServices,
  tab: MyTab | null | undefined,
  clock: LedgerClock | null,
  /** The verified address, used when there is no tab yet. */
  address: string | null
): DeviceKey {
  const config = services.config()
  const reader = tab?.readerAddress ?? address
  const scope = useMemo<SessionKeyScope | null>(
    () =>
      config && reader
        ? { tabContractId: config.tabContractId, readerAddress: reader }
        : null,
    [config?.tabContractId, reader] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const [localKeys, setLocalKeys] = useState<
    LocalSessionKeyInfo[] | null | undefined
  >(undefined)

  const refresh = useCallback(async () => {
    if (!scope) return
    try {
      const keys = await services.keyStore().list(scope)
      setLocalKeys(keys.map((k) => k.info))
    } catch {
      // STORAGE_UNAVAILABLE or CRYPTO_UNAVAILABLE: no key can live here.
      setLocalKeys(null)
    }
  }, [scope, services])

  const serverKeyIds = tab?.keys
    .map((k) => `${k.keyId}:${k.publicKey ?? ''}:${k.revoked}`)
    .join(',')
  useEffect(() => {
    if (!scope) return
    if (!tab) {
      void refresh()
      return
    }
    let alive = true
    void (async () => {
      try {
        const bound = await services.keyStore().bindKeyIds(
          scope,
          tab.keys.map((k) => ({ keyId: k.keyId, publicKey: k.publicKey }))
        )
        const held = await services.keyStore().list(scope)
        noteSeenKeyIds(
          scope.tabContractId,
          scope.readerAddress,
          [...bound, ...held].flatMap((k) => k.info.keyIds)
        )
        if (alive) setLocalKeys(held.map((k) => k.info))
      } catch {
        if (alive) setLocalKeys(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [scope, serverKeyIds, services, refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  // Another browser tab may add or stop a key; re-read on focus.
  useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const view = useMemo<DeviceKeyView | undefined>(() => {
    if (tab === undefined || !scope || localKeys === undefined) return undefined
    return deviceKeyView({
      serverKeys: tab?.keys ?? [],
      localKeys,
      currentLedger: clock?.sequence ?? 0,
      seenKeyIds: seenKeyIds(scope.tabContractId, scope.readerAddress),
    })
  }, [tab, scope, localKeys, clock?.sequence])

  return { view, scope, localKeys, refresh }
}
