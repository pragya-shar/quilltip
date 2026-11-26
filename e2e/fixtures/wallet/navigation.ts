export const usePathname = () => location.pathname
export const useSearchParams = () => new URLSearchParams(location.search)
export const useRouter = () => ({
  push: (href: string) => history.pushState(null, '', href),
  replace: (href: string) => history.replaceState(null, '', href),
  refresh: () => {},
  back: () => history.back(),
  prefetch: () => {},
})
