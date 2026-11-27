'use client'
import type { ReactNode } from 'react'
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

export function AccountSurface({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const pathname = usePathname()
  return (
    <>
      <a className="account-skip" href="#account-content">
        Skip to account content
      </a>
      <AppNavigation />
      <div className="account-surface ui-light pt-16">
        <main
          id="account-content"
          className="account-folio account-folio-under-header"
        >
          <nav className="account-nav" aria-label="Account sections">
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
