'use client'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthContext'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { resolveSignedInProfilePath } from '@/lib/profile/profileDestination'

export function AccountSurface({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return (
    <div className="account-surface">
      <a className="account-skip" href="#account-content">
        Skip to wallet
      </a>
      <header className="account-header">
        <LandingWordmark />
        <div className="account-context">
          Your account <span>Private to you</span>
        </div>
        {user?.username && (
          <Link
            className="account-text-link account-profile-link"
            href={resolveSignedInProfilePath(
              user.username,
              new URLSearchParams()
            )}
          >
            View public profile <ArrowRight aria-hidden="true" size={22} />
          </Link>
        )}
      </header>
      <main id="account-content" className="account-folio">
        <nav className="account-nav" aria-label="Account sections">
          <Link href="/dashboard/wallet" aria-current="page">
            Wallet
          </Link>
          <Link href="/dashboard/stats">Stats</Link>
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
  )
}
