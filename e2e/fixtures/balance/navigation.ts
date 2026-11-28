/** A `next/navigation` stand-in whose pathname follows client navigation. */
import { useSyncExternalStore } from 'react'

const EVENT = 'fixture-navigate'

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener)
  window.addEventListener('popstate', listener)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('popstate', listener)
  }
}

export function navigate(href: string) {
  history.pushState(null, '', href)
  window.dispatchEvent(new Event(EVENT))
}

export const usePathname = () =>
  useSyncExternalStore(
    subscribe,
    () => location.pathname,
    () => '/'
  )
export const useSearchParams = () => new URLSearchParams(location.search)
export const useRouter = () => ({
  push: navigate,
  replace: (href: string) => history.replaceState(null, '', href),
  refresh: () => {},
  back: () => history.back(),
  prefetch: () => {},
})
