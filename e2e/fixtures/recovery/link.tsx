import type { AnchorHTMLAttributes } from 'react'

// Next's router is absent in the isolated boundary fixture; navigation stays real.
export default function FixtureLink({
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props}>{children}</a>
}
