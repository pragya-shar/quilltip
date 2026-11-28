'use client'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { AccountSections } from './AccountSections'

export function AccountSurface({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const pathname = usePathname()
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
          <AccountSections pathname={pathname} username={user?.username} />
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
