'use client'

import Link from 'next/link'
import { useAuth } from '@/components/providers/AuthContext'
import { ArrowUpRight } from './LandingIcons'
import { LandingWordmark } from './LandingWordmark'

export function LandingNavigation() {
  const { isAuthenticated } = useAuth()
  return (
    <header className="site-header">
      <LandingWordmark />
      <nav aria-label="Main navigation">
        <Link className="nav-link optional-nav" href="/articles">
          Articles
        </Link>
        <Link className="nav-link" href="/library">
          Your library
        </Link>
        <Link className="nav-link" href="/write">
          Writing desk
        </Link>
        {isAuthenticated ? (
          <Link className="nav-signup" href="/profile">
            Account <ArrowUpRight size={16} aria-hidden />
          </Link>
        ) : (
          <>
            <Link className="nav-link login-link" href="/login">
              Log in
            </Link>
            <Link className="nav-signup" href="/register">
              Sign up <ArrowUpRight size={16} aria-hidden />
            </Link>
          </>
        )}
      </nav>
    </header>
  )
}
