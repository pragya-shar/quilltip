import { AppLink as Link } from './AppLink'
import type { ReactNode } from 'react'
import { cx } from '../cx'

type TextLinkProps = {
  href: string
  /** inline: underlined inside text. standalone: "Read more", row actions. */
  variant?: 'inline' | 'standalone'
  /** Opens another site: a new tab, no referrer, and a word for screen readers. */
  external?: boolean
  /** false for a link to a page of the other root layout (a legacy page):
   * that is a full page load, and a prefetch would only fetch the other
   * layout's assets. */
  prefetch?: false
  className?: string
  children: ReactNode
}

/** A link in words. Internal links use client navigation. */
export function TextLink({
  href,
  variant = 'inline',
  external,
  prefetch,
  className,
  children,
}: TextLinkProps) {
  const props = { className: cx('qt-link', className), 'data-variant': variant }
  if (external) {
    return (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <span className="qt-visually-hidden"> (opens another site)</span>
      </a>
    )
  }
  return (
    <Link
      {...props}
      href={href}
      prefetch={prefetch === false ? false : undefined}
    >
      {children}
    </Link>
  )
}
