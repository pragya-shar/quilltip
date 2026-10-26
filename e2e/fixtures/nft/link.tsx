import type { AnchorHTMLAttributes } from 'react'

// Keep profile pagination mounted, like Next Link, without a Next router.
export default function FixtureLink({
  children,
  href,
  onClick,
  scroll,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { scroll?: boolean }) {
  // Next-only navigation options must not become DOM attributes.
  void scroll
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event)
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target ||
          props.download
        )
          return
        const next = new URL(event.currentTarget.href)
        if (
          next.origin === location.origin &&
          next.pathname === location.pathname &&
          next.searchParams.get('state') === 'profile-pagination'
        ) {
          event.preventDefault()
          history.pushState(null, '', next)
          window.dispatchEvent(new PopStateEvent('popstate'))
        }
      }}
    >
      {children}
    </a>
  )
}
