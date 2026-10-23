'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Menu } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { AuthActionsSkeleton } from './AuthActionsSkeleton'
import { AccountNavigationMenu } from './AccountNavigationMenu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { isProtectedPath } from '@/lib/navigation/protectedRoutes'
import {
  getAccountNavigationLinks,
  PRIMARY_NAVIGATION_LINKS,
} from '@/lib/navigation/siteNavigation'

export default function AppNavigation() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPath, setMenuPath] = useState(pathname)
  const authPending =
    isLoading || (!isAuthenticated && isProtectedPath(pathname))
  const accountLinks = getAccountNavigationLinks(user?.username)
  const currentPage = (href: string) =>
    pathname === href ? ('page' as const) : undefined
  const closeMenu = () => setMenuOpen(false)

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
            />
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link className="app-nav-action" href="/register">
                Sign up <span aria-hidden>↗</span>
              </Link>
            </>
          )}
        </nav>
        <Sheet
          open={menuOpen && menuPath === pathname}
          onOpenChange={(open) => {
            setMenuPath(pathname)
            setMenuOpen(open)
          }}
        >
          <SheetTrigger asChild>
            <button
              type="button"
              className="app-menu-trigger"
              aria-label="Open navigation menu"
            >
              <Menu size={22} aria-hidden />
              <span>Menu</span>
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="app-mobile-menu site-chrome">
            <SheetTitle>Find your way</SheetTitle>
            <SheetDescription>
              Reading, writing, and your account.
            </SheetDescription>
            <LandingWordmark onClick={closeMenu} />
            <nav aria-label="Mobile navigation">
              {PRIMARY_NAVIGATION_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={currentPage(href)}
                  onClick={closeMenu}
                >
                  {label}
                </Link>
              ))}
              {authPending ? (
                <AuthActionsSkeleton />
              ) : isAuthenticated ? (
                <div className="app-mobile-account">
                  {accountLinks.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      aria-current={currentPage(href)}
                      onClick={closeMenu}
                    >
                      {label}
                    </Link>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu()
                      void signOut()
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <div className="app-mobile-account">
                  <Link href="/login" onClick={closeMenu}>
                    Log in
                  </Link>
                  <Link
                    href="/register"
                    className="app-nav-action"
                    onClick={closeMenu}
                  >
                    Sign up <span aria-hidden>↗</span>
                  </Link>
                </div>
              )}
              <Link href="/support" onClick={closeMenu}>
                Help &amp; support
              </Link>
            </nav>
            <div className="app-menu-theme">
              <span>Appearance</span>
              <ThemeToggle />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}
