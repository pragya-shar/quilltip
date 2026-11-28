// next/navigation for the system fixture: the pathname from the address.
export const usePathname = () => location.pathname
export const useSearchParams = () => new URLSearchParams(location.search)
export const useRouter = () => ({
  push: (href: string) => location.assign(href),
  replace: (href: string) => location.replace(href),
  refresh: () => {},
  back: () => history.back(),
  prefetch: () => {},
})
