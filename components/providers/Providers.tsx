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

// The toaster stays in the first load (about 9.7 KB gzip). Loaded on demand,
// a toast raised before it arrived was shown, but its live region was created
// in the same moment as the toast, which screen readers may not announce
// (review of #503).
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
