import type { ReactNode } from 'react'
import { NavBar } from './NavBar'
import { NavRail } from './NavRail'

/**
 * The frame every page of the application renders in: a skip link, the
 * desktop rail, the content, the phone bar, and `beside` (the toast region
 * and the payments shell), which sits next to the content and never wraps
 * it. The frame lives in the root layout, so it does not remount when the
 * page changes. Nothing here suspends: the content arrives in the first
 * response (D19).
 */
export function AppShell({
  children,
  beside,
}: {
  children: ReactNode
  beside?: ReactNode
}) {
  return (
    <div className="qt-shell">
      <a className="qt-skip" href="#content">
        Skip to content
      </a>
      <NavRail />
      <main id="content" className="qt-shell__main" tabIndex={-1}>
        {children}
      </main>
      <NavBar />
      {beside}
    </div>
  )
}
