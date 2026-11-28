// next/navigation for the server render of /signin: no router.
export const usePathname = () => '/signin'
export const useSearchParams = () => new URLSearchParams()
export const useRouter = () => ({
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  prefetch: () => {},
})
