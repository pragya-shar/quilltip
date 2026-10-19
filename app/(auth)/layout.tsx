import type { ReactNode } from 'react'
import Link from 'next/link'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { ArrowRight } from '@/components/landing/LandingIcons'
import { AccountIllustrations } from '@/components/auth/AccountIllustrations'
import '@/components/auth/account.css'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="account-page">
      <AccountIllustrations />
      <header className="account-header">
        <LandingWordmark />
        <Link href="/articles">
          Browse articles <ArrowRight size={17} />
        </Link>
      </header>
      {children}
    </div>
  )
}
