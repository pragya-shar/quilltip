'use client'

import Link from 'next/link'
import { useEffect, useId, type RefObject } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthContext'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { AuthActionsSkeleton } from './AuthActionsSkeleton'
import { isProtectedPath } from '@/lib/navigation/protectedRoutes'
import {
  getAccountNavigationLinks,
  PRIMARY_NAVIGATION_LINKS,
  SUPPORT_PATH,
} from '@/lib/navigation/siteNavigation'
import { UserAvatar } from '@/components/ui/user-avatar'

/**
 * The small-screen navigation sheet, a native dialog in the server HTML.
 *
 * Before the page scripts run, the header button opens it as a popover
 * (`popovertarget`), so a tap right after the first paint is answered. Once
 * the scripts run, AppNavigation opens it with `showModal()`: focus moves in,
 * the rest of the page is inert, Escape closes it, and focus returns to the
 * header button. A popover the reader opened before then becomes the modal.
 */
export function AppMobileMenu({
  id,
  dialogRef,
  pathname,
  onClose,
}: {
  id: string
  dialogRef: RefObject<HTMLDialogElement | null>
  pathname: string
  /** Runs after the dialog closed (Escape, close button, backdrop, a link). */
  onClose: () => void
}) {
  const { user, isAuthenticated, isLoading, signOut } = useAuth()
  const titleId = useId()
  const descriptionId = useId()
  const authPending =
    isLoading || (!isAuthenticated && isProtectedPath(pathname))
  const accountLinks = getAccountNavigationLinks(user?.username)
  const currentPage = (href: string) =>
    pathname === href ? ('page' as const) : undefined
  const closeMenu = () => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (dialog.open) dialog.close()
    else if (dialog.matches(':popover-open')) dialog.hidePopover()
  }
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    // The backdrop belongs to the dialog element, so a press on it targets
    // the dialog itself, outside the sheet's box. Escape is the keyboard way
    // out, and the close button the visible one.
    const closeOnBackdrop = (event: MouseEvent) => {
      if (event.target !== dialog) return
      const box = dialog.getBoundingClientRect()
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      if (!inside) dialog.close()
    }
    dialog.addEventListener('click', closeOnBackdrop)
    return () => dialog.removeEventListener('click', closeOnBackdrop)
  }, [dialogRef])
  const displayName = user?.name?.trim() || user?.username || 'Your account'

  return (
    <dialog
      ref={dialogRef}
      id={id}
      popover="auto"
      className="app-mobile-menu site-chrome"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={onClose}
    >
      <button
        type="button"
        className="app-mobile-menu-close"
        aria-label="Close"
        popoverTarget={id}
        popoverTargetAction="hide"
        onClick={(event) => {
          event.preventDefault()
          closeMenu()
        }}
      >
        <X size={16} aria-hidden />
      </button>
      <h2 id={titleId}>Find your way</h2>
      <p id={descriptionId}>Reading, writing, and your account.</p>
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
    </dialog>
  )
}
