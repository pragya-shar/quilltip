import type { AnchorHTMLAttributes, Ref } from 'react'

// next/link for the system fixture: a plain link (full page loads), and the
// link status the navigation reads, never pending here.
export default function FixtureLink({
  prefetch,
  scroll,
  replace,
  ref,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  prefetch?: boolean
  scroll?: boolean
  replace?: boolean
  ref?: Ref<HTMLAnchorElement>
}) {
  void prefetch
  void scroll
  void replace
  // Children come through props, as with next/link.
  // eslint-disable-next-line jsx-a11y/anchor-has-content
  return <a ref={ref} {...props} />
}

export const useLinkStatus = () => ({ pending: false })
