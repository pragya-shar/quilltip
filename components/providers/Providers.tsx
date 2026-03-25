'use client'

import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import { WalletProvider } from './WalletProvider'
import { ThemeProvider } from './ThemeProvider'
import { Toaster } from '@/components/ui/sonner'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'

/**
 * Global Providers
 *
 * Wraps the application with ConvexAuthProvider for authentication,
 * Convex database access, and Stellar wallet connection.
 * Provides real-time subscriptions and type-safe queries throughout the app.
 */

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

interface ProvidersProps {
  children: React.ReactNode
}

const WalletErrorFallback = (
  <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg text-center">
    <p className="text-yellow-800">Wallet connection unavailable.</p>
    <p className="text-sm text-yellow-600 mt-1">
      You can still browse content.
    </p>
  </div>
)

export default function Providers({ children }: ProvidersProps) {
  return (
    <ConvexAuthProvider client={convex}>
      <ThemeProvider>
        <ErrorBoundary fallback={WalletErrorFallback}>
          <WalletProvider>
            {children}
            <Toaster />
          </WalletProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </ConvexAuthProvider>
  )
}
