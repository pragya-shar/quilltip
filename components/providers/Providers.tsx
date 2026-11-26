'use client'

import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import { Toaster } from '@/components/ui/sonner'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { WalletErrorFallback } from '@/components/error/WalletErrorFallback'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { WalletActivationProvider } from './WalletActivationContext'
import { WalletProvider } from './WalletProvider'
import { AuthSessionProvider } from './AuthContext'
// Deliberate regression for the page-load budget check. Do not merge.
import * as StellarSdk from '@stellar/stellar-sdk'
if (typeof window !== 'undefined')
  (window as unknown as { __sdk: unknown }).__sdk = StellarSdk

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

interface ProvidersProps {
  children: React.ReactNode
  /** CSP nonce for the inline theme script. */
  nonce?: string
}

export default function Providers({ children, nonce }: ProvidersProps) {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthSessionProvider>
        <ThemeProvider nonce={nonce}>
          <WalletActivationProvider>
            <ErrorBoundary
              fallback={({ reset }) => <WalletErrorFallback onRetry={reset} />}
            >
              <WalletProvider>
                {children}
                <Toaster />
              </WalletProvider>
            </ErrorBoundary>
          </WalletActivationProvider>
        </ThemeProvider>
      </AuthSessionProvider>
    </ConvexAuthProvider>
  )
}
