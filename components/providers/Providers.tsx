'use client'

import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import dynamic from 'next/dynamic'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { WalletErrorFallback } from '@/components/error/WalletErrorFallback'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { WalletActivationProvider } from './WalletActivationContext'
import { WalletProvider } from './WalletProvider'
import { AuthSessionProvider } from './AuthContext'

// Toasts only follow an action, so the toaster is not part of the first load.
// Sonner keeps toasts raised before it mounts and shows them once it does.
const Toaster = dynamic(
  () => import('@/components/ui/sonner').then((mod) => mod.Toaster),
  { ssr: false }
)

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
