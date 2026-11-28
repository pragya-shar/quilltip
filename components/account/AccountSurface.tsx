'use client'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { SETTINGS_PATH } from '@/lib/navigation/siteNavigation'

const ACCOUNT_SECTIONS = [
  { href: '/dashboard/wallet', label: 'Wallet' },
  { href: '/dashboard/tab', label: 'Tab' },
  { href: '/dashboard/stats', label: 'Stats' },
  { href: '/dashboard/feedback', label: 'Feedback' },
  { href: SETTINGS_PATH, label: 'Settings' },
] as const

/**
 * Scrolls the row, never the page, so the link is fully in view. No
 * animation: it runs before the first paint.
 */
function revealInRow(row: HTMLElement, link: HTMLElement) {
  const box = link.getBoundingClientRect()
  const frame = row.getBoundingClientRect()
  // The row's inline padding is the room its links' focus ring needs.
  const room = parseFloat(getComputedStyle(row).paddingInlineStart) || 0
  // Rounded up: some engines keep whole-pixel scroll positions.
  if (box.right > frame.right - room) {
    row.scrollLeft += Math.ceil(box.right - frame.right + room)
  } else if (box.left < frame.left + room) {
    row.scrollLeft -= Math.ceil(frame.left + room - box.left)
  }
}

export function AccountSurface({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const pathname = usePathname()
  const row = useRef<HTMLElement>(null)
  // More sections than fit a phone: the current one is shown on load and
  // after each move between sections (the row stays mounted), and again
  // once the web fonts, which widen the links, have loaded.
  useLayoutEffect(() => {
    const element = row.current
    if (!element) return
    const reveal = () => {
      if (element.scrollWidth <= element.clientWidth) return
      const current = element.querySelector<HTMLElement>(
        'a[aria-current="page"]'
      )
      if (current) revealInRow(element, current)
    }
    reveal()
    let live = true
    void document.fonts?.ready.then(() => {
      if (live) reveal()
    })
    return () => {
      live = false
    }
  }, [pathname])
  return (
    <>
      <a className="account-skip" href="#account-content">
        Skip to account content
      </a>
      <AppNavigation />
      <div className="account-surface pt-16">
        <main
          id="account-content"
          className="account-folio account-folio-under-header"
        >
          <nav
            ref={row}
            className="account-nav"
            aria-label="Account sections"
            // Chromium leaves a partly hidden link where it is on focus.
            onFocus={(event) => {
              if (event.target !== event.currentTarget) {
                revealInRow(event.currentTarget, event.target)
              }
            }}
          >
            {ACCOUNT_SECTIONS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
              >
                {label}
              </Link>
            ))}
            {user?.username && (
              <span className="account-name">@{user.username}</span>
            )}
          </nav>
          {children}
        </main>
        <footer className="account-footer">
          <Link href="/articles">
            Back to articles <ArrowRight aria-hidden="true" size={17} />
          </Link>
          <span>Your reading. Your support.</span>
        </footer>
      </div>
    </>
  )
}
