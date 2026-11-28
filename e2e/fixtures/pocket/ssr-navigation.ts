// next/navigation for the server render of /pocket: no address, no router.
export const usePathname = () => '/pocket'
export const useSearchParams = () => new URLSearchParams()
export const useRouter = () => ({
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  prefetch: () => {},
})
