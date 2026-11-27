// next/navigation for the Today fixture: the pathname from the address in
// the browser, and Today's path while rendering on the server.
const here = () => (typeof location === 'undefined' ? '/' : location.pathname)
export const usePathname = () => here()
export const useSearchParams = () =>
  new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
export const useRouter = () => ({
  push: (href: string) => location.assign(href),
  replace: (href: string) => location.replace(href),
  refresh: () => {},
  back: () => history.back(),
  prefetch: () => {},
})
