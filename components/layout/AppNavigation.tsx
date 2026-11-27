'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Menu } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { AuthActionsSkeleton } from './AuthActionsSkeleton'
import { AccountNavigationMenu } from './AccountNavigationMenu'
import { AppMobileMenu } from './AppMobileMenu'
import { isProtectedPath } from '@/lib/navigation/protectedRoutes'
import {
  getAccountNavigationLinks,
  PRIMARY_NAVIGATION_LINKS,
} from '@/lib/navigation/siteNavigation'

const noSubscription = () => () => {}

export default function AppNavigation() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth()
  const pathname = usePathname()
  const menuId = useId()
  const menuRef = useRef<HTMLDialogElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuPath = useRef(pathname)
  // False in the server HTML and while hydrating, true after. Until then the
  // browser derives the button's expanded state from `popovertarget`.
  const scriptsActive = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  )

  const openMenu = () => {
    const dialog = menuRef.current
    if (!dialog || dialog.open) return
    // A popover opened before the scripts ran becomes the modal dialog in
    // the same frame, keeping the reader's place in it.
    const focused = document.activeElement
    const wasPopover = dialog.matches(':popover-open')
    if (wasPopover) dialog.hidePopover()
    dialog.showModal()
    if (wasPopover && focused instanceof HTMLElement && dialog.contains(focused))
      focused.focus()
    setMenuOpen(true)
  }

  useEffect(() => {
    if (menuRef.current?.matches(':popover-open')) openMenu()
    // Runs once, when the scripts take over.
  }, [])

  useEffect(() => {
    // Leaving the page closes the menu, as every link in it does.
    if (menuPath.current === pathname) return
    menuPath.current = pathname
    menuRef.current?.close()
  }, [pathname])

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
          aria-expanded={scriptsActive ? menuOpen : undefined}
          data-state={menuOpen ? 'open' : 'closed'}
          popoverTarget={menuId}
          popoverTargetAction="show"
          onClick={(event) => {
            // The scripts open the modal dialog instead of the popover.
            event.preventDefault()
            openMenu()
          }}
        >
          <Menu size={22} aria-hidden />
          <span>Menu</span>
        </button>
        <AppMobileMenu
          id={menuId}
          dialogRef={menuRef}
          pathname={pathname}
          onClose={() => {
            setMenuOpen(false)
            menuTriggerRef.current?.focus()
          }}
        />
      </div>
    </header>
  )
}
