'use client'

import Link from 'next/link'
import type { RefObject } from 'react'
import { useAuth } from '@/components/providers/AuthContext'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { AuthActionsSkeleton } from './AuthActionsSkeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { isProtectedPath } from '@/lib/navigation/protectedRoutes'
import {
  getAccountNavigationLinks,
  PRIMARY_NAVIGATION_LINKS,
  SUPPORT_PATH,
} from '@/lib/navigation/siteNavigation'
import { UserAvatar } from '@/components/ui/user-avatar'

/**
 * The small-screen navigation sheet. AppNavigation loads it on demand (on
 * idle, hover, focus or the first press), so the dialog code is not part of a
 * page's first load. The trigger lives in AppNavigation; focus returns to it
 * when the sheet closes.
 */
export function AppMobileMenu({
  open,
  onOpenChange,
  pathname,
  triggerRef,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pathname: string
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const { user, isAuthenticated, isLoading, signOut } = useAuth()
  const authPending =
    isLoading || (!isAuthenticated && isProtectedPath(pathname))
  const accountLinks = getAccountNavigationLinks(user?.username)
  const currentPage = (href: string) =>
    pathname === href ? ('page' as const) : undefined
  const closeMenu = () => onOpenChange(false)
  const displayName = user?.name?.trim() || user?.username || 'Your account'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="app-mobile-menu site-chrome"
        onCloseAutoFocus={(event) => {
          // There is no Radix trigger, so return focus to the header button.
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <SheetTitle>Find your way</SheetTitle>
        <SheetDescription>Reading, writing, and your account.</SheetDescription>
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
              <p className="app-mobile-identity">
                <UserAvatar
                  src={user?.avatar}
                  alt=""
                  name={displayName}
                  className="app-account-avatar"
                  fallbackClassName="app-account-avatar-fallback"
                />
                <span>
                  <strong>{displayName}</strong>
                  {user?.username && <small>@{user.username}</small>}
                </span>
              </p>
              {accountLinks.map(({ href, label }) => (
                <Link
                  key={label}
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
              <Link
                href={SUPPORT_PATH}
                aria-current={currentPage(SUPPORT_PATH)}
                onClick={closeMenu}
              >
                Help &amp; support
              </Link>
            </div>
          )}
        </nav>
        <div className="app-menu-theme">
          <span>Appearance</span>
          <ThemeToggle />
        </div>
      </SheetContent>
    </Sheet>
  )
}
