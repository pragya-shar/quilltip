'use client'

import { useSyncExternalStore } from 'react'
import { toastStore, type ToastItem } from '../toast'
import { Toast } from './Toast'

const none: readonly ToastItem[] = []

/**
 * Where toasts appear: mounted once by the shell, before any toast, so the
 * live regions exist when a toast arrives and screen readers announce it.
 */
export function ToastRegion() {
  const items = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.get,
    () => none
  )
  const polite = items.filter((item) => item.tone !== 'failure')
  const urgent = items.filter((item) => item.tone === 'failure')
  return (
    <div className="qt-toasts">
      <div role="alert" aria-live="assertive" className="qt-toasts__list">
        {urgent.map((item) => (
          <Toast key={item.id} item={item} />
        ))}
      </div>
      <div role="status" aria-live="polite" className="qt-toasts__list">
        {polite.map((item) => (
          <Toast key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
