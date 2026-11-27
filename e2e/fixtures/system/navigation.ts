import { useSyncExternalStore } from 'react'

// next/navigation for the system fixture: the pathname from the address,
// read again on popstate (a test moves it with history.pushState and a
// popstate event, as a client navigation would).
const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener)
  return () => window.removeEventListener('popstate', listener)
}
export const usePathname = () =>
  useSyncExternalStore(
    subscribe,
    () => location.pathname,
    () => '/'
  )
export const useSearchParams = () => new URLSearchParams(location.search)
export const useRouter = () => ({
  push: (href: string) => location.assign(href),
  replace: (href: string) => location.replace(href),
  refresh: () => {},
  back: () => history.back(),
  prefetch: () => {},
})
