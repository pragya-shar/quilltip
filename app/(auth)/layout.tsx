import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { ArrowRight } from '@/components/landing/LandingIcons'
import { AccountIllustrations } from '@/components/auth/AccountIllustrations'
import { EarlySubmitScript } from '@/components/auth/EarlySubmitScript'
import { ForgetWalletWhenSignedOut } from '@/components/auth/ForgetWalletWhenSignedOut'
import { NONCE_HEADER } from '@/lib/security/contentSecurityPolicy'
import '@/components/auth/account.css'

export default async function AuthLayout({
  children,
}: {
  children: ReactNode
}) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined
  return (
    <div className="account-page">
      {/* Holds a submit made before the page scripts run. */}
      <EarlySubmitScript nonce={nonce} />
      <AccountIllustrations />
      <ForgetWalletWhenSignedOut />
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
