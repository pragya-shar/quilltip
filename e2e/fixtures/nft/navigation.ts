import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}

export const usePathname = () => location.pathname
export const useSearchParams = () =>
  new URLSearchParams(useSyncExternalStore(subscribe, () => location.search))
