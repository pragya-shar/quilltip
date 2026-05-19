'use client'

import dynamic from 'next/dynamic'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import { Toaster } from '@/components/ui/sonner'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import {
  WalletActivationProvider,
  useWalletActivation,
} from './WalletActivationContext'

const LazyWalletProvider = dynamic(
  () =>
    import('./WalletProvider').then((mod) => ({ default: mod.WalletProvider })),
  { ssr: false }
)

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

interface ProvidersProps {
  children: React.ReactNode
}

const WalletErrorFallback = (
  <div className="p-4 border border-border bg-muted rounded-lg text-center">
    <p className="text-foreground">Wallet connection unavailable.</p>
    <p className="text-sm text-muted-foreground mt-1">
      You can still browse content.
    </p>
  </div>
)

function WalletBoundary({ children }: { children: React.ReactNode }) {
  const { isWalletActive } = useWalletActivation()

  if (!isWalletActive) {
    return <>{children}</>
  }

  return <LazyWalletProvider>{children}</LazyWalletProvider>
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <ConvexAuthProvider client={convex}>
      <ThemeProvider>
        <WalletActivationProvider>
          <ErrorBoundary fallback={WalletErrorFallback}>
            <WalletBoundary>
              {children}
              <Toaster />
            </WalletBoundary>
          </ErrorBoundary>
        </WalletActivationProvider>
      </ThemeProvider>
    </ConvexAuthProvider>
  )
}
