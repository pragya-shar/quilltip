'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(min-width: 64rem)'

/** True from 1024 px: the rail and the Pocket panel replace bar and sheet. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(QUERY)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
