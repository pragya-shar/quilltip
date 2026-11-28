'use client'

import { useSyncExternalStore } from 'react'
import { Icon } from '@/system/components/Icon'
import { OfflineIcon } from '@/system/icons'

function subscribe(change: () => void) {
  window.addEventListener('online', change)
  window.addEventListener('offline', change)
  return () => {
    window.removeEventListener('online', change)
    window.removeEventListener('offline', change)
  }
}

/**
 * "Offline. Reading still works." while the browser has no connection. It
 * floats over the top edge and never pushes the text down; the server
 * render and a reader with no script never show it.
 */
export function OfflineNote() {
  const offline = useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false
  )
  if (!offline) return null
  return (
    <p className="qt-today__offline" role="status">
      <Icon icon={OfflineIcon} size={16} />
      Offline. Reading still works.
    </p>
  )
}
