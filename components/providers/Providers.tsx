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

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

interface ProvidersProps {
  children: React.ReactNode
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthSessionProvider>
        <ThemeProvider>
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
