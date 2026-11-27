'use client'

import Link from 'next/link'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Menu } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { AuthActionsSkeleton } from './AuthActionsSkeleton'
import { AccountNavigationMenu } from './AccountNavigationMenu'
import { isProtectedPath } from '@/lib/navigation/protectedRoutes'
import { afterLoadWhenIdle } from '@/lib/scheduling/afterLoadWhenIdle'
import {
  getAccountNavigationLinks,
  PRIMARY_NAVIGATION_LINKS,
} from '@/lib/navigation/siteNavigation'

// The small-screen sheet (Radix dialog) is not part of the first load. It is
// fetched when the browser is idle after load if the menu button is shown, or
// on hover, focus or the first press, whichever comes first.
const loadMobileMenu = () => import('./AppMobileMenu')
const preloadMobileMenu = () => {
  void loadMobileMenu()
}
const AppMobileMenu = lazy(() =>
  loadMobileMenu().then((mod) => ({ default: mod.AppMobileMenu }))
)

export default function AppNavigation() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPath, setMenuPath] = useState(pathname)
  const [menuRequested, setMenuRequested] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const sheetOpen = menuOpen && menuPath === pathname

  useEffect(() => {
    // Only screens that show the menu button fetch the sheet ahead of time,
    // and only after the page has loaded, so it never competes with it.
    if (!menuTriggerRef.current?.offsetParent) return
    return afterLoadWhenIdle(preloadMobileMenu)
  }, [])
  const authPending =
    isLoading || (!isAuthenticated && isProtectedPath(pathname))
  const accountLinks = getAccountNavigationLinks(user?.username)
  const currentPage = (href: string) =>
    pathname === href ? ('page' as const) : undefined

  return (
    <header className="app-site-header site-chrome">
      <div className="app-site-header-inner">
        <LandingWordmark />
        <nav className="app-desktop-nav" aria-label="Main navigation">
          {PRIMARY_NAVIGATION_LINKS.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={currentPage(href)}>
              {label}
            </Link>
          ))}
          {authPending ? (
            <AuthActionsSkeleton />
          ) : isAuthenticated ? (
            <AccountNavigationMenu
              links={accountLinks}
              pathname={pathname}
              signOut={signOut}
              user={user}
            />
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link className="app-nav-action" href="/register">
                Sign up <span aria-hidden>↗</span>
              </Link>
            </>
          )}
          <ThemeToggle />
        </nav>
        <button
          ref={menuTriggerRef}
          type="button"
          className="app-menu-trigger"
          aria-label="Open navigation menu"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          data-state={sheetOpen ? 'open' : 'closed'}
          onPointerEnter={preloadMobileMenu}
          onFocus={preloadMobileMenu}
          onClick={() => {
            setMenuRequested(true)
            setMenuPath(pathname)
            setMenuOpen(true)
          }}
        >
          <Menu size={22} aria-hidden />
          <span>Menu</span>
        </button>
        {menuRequested && (
          <Suspense fallback={null}>
            <AppMobileMenu
              open={sheetOpen}
              onOpenChange={(open) => {
                setMenuPath(pathname)
                setMenuOpen(open)
              }}
              pathname={pathname}
              triggerRef={menuTriggerRef}
            />
          </Suspense>
        )}
      </div>
    </header>
  )
}
