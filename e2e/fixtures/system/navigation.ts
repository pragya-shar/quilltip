import { useSyncExternalStore } from 'react'

// next/navigation for the system fixture: the pathname from the address,
// read again on popstate (a test moves it with history.pushState and a
// popstate event, as a client navigation would), and after
// history.replaceState, which Next.js follows as a change of path too.
const REPLACED = 'fixture:replacestate'
if (typeof window !== 'undefined') {
  const replace = history.replaceState.bind(history)
  history.replaceState = (...args: Parameters<History['replaceState']>) => {
    replace(...args)
    window.dispatchEvent(new Event(REPLACED))
  }
}
const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener)
  window.addEventListener(REPLACED, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(REPLACED, listener)
  }
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
  // Recorded, so a test sees which links prefetched and when.
  prefetch: (href: string) => {
    const page = window as unknown as { __prefetched?: string[] }
    ;(page.__prefetched ??= []).push(href)
  },
})
