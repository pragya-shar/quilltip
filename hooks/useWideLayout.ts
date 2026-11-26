'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(min-width: 768px)'

function subscribe(listener: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

/** True at 768 px and wider: the basket opens from the right, not the bottom. */
export function useWideLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true
  )
}
