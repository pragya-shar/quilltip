'use client'

/**
 * The page's tip basket (lib/tip/v2/basket.ts), bound to the signed-in
 * account. Light: no payment code, so the basket button can render early.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '@/components/providers/AuthContext'
import { basketStore, type BasketState } from '@/lib/tip/v2/basket'

const SERVER: BasketState = { items: [], submissionId: null, sent: null }

export function useTipBasket() {
  const { user } = useAuth()
  const store = basketStore()
  const owner = user?._id ?? null
  useEffect(() => {
    store.setOwner(owner)
  }, [owner, store])
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => SERVER
  )
  return { store, state, signedIn: owner !== null }
}
