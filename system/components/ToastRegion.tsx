'use client'

import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { modalStack } from '../modalStack'
import { toastStore, type ToastItem } from '../toast'
import { Toast } from './Toast'

const none: readonly ToastItem[] = []

/**
 * Where toasts appear: mounted once by the shell, before any toast, so the
 * live regions exist when a toast arrives and screen readers announce it.
 * While a sheet or dialog is open, the region moves into it: a modal makes
 * the rest of the page inert and covers it in the top layer.
 */
export function ToastRegion() {
  const items = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.get,
    () => none
  )
  const host = useSyncExternalStore(
    modalStack.subscribe,
    modalStack.top,
    () => null
  )
  const polite = items.filter((item) => item.tone !== 'failure')
  const urgent = items.filter((item) => item.tone === 'failure')
  const region = (
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
  return host ? createPortal(region, host) : region
}
