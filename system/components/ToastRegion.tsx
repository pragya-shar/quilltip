'use client'

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
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
 *
 * The region is one element for the life of the page. Opening or closing a
 * modal moves that element in the document; React never remounts it, so a
 * toast keeps its time left, does not animate in again, and is not
 * announced twice.
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
  const anchor = useRef<HTMLDivElement>(null)
  // Created after hydration: the server draws only the anchor.
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = document.createElement('div')
    node.className = 'qt-toasts'
    setRegion(node)
    return () => node.remove()
  }, [])
  useLayoutEffect(() => {
    if (!region) return
    const parent = host ?? anchor.current
    if (parent && region.parentNode !== parent) parent.append(region)
  }, [host, region])

  const polite = items.filter((item) => item.tone !== 'failure')
  const urgent = items.filter((item) => item.tone === 'failure')
  return (
    <>
      <div ref={anchor} className="qt-toasts-anchor" />
      {region
        ? createPortal(
            <>
              <div
                role="alert"
                aria-live="assertive"
                className="qt-toasts__list"
              >
                {urgent.map((item) => (
                  <Toast key={item.id} item={item} />
                ))}
              </div>
              <div role="status" aria-live="polite" className="qt-toasts__list">
                {polite.map((item) => (
                  <Toast key={item.id} item={item} />
                ))}
              </div>
            </>,
            region
          )
        : null}
    </>
  )
}
