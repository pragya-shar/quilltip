'use client'

import { createContext, useContext } from 'react'
import dynamic from 'next/dynamic'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { WalletErrorFallback } from '@/components/error/WalletErrorFallback'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { WalletActivationProvider } from './WalletActivationContext'
import { WalletProvider } from './WalletProvider'
import { AuthSessionProvider } from './AuthContext'

// The toaster (sonner, about 9.5 KB gzip) loads after the page, starting at
// hydration rather than at the first toast. sonner replays toasts raised
// before it subscribed, and the Toaster holds every toast until its empty
// live region has existed for two frames, so none is lost and none arrives
// together with the region that announces it (review of #503;
// components/ui/sonner.tsx). Its empty region is no longer in the server HTML.
const Toaster = dynamic(
  () => import('@/components/ui/sonner').then((mod) => mod.Toaster),
  { ssr: false }
)
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

/**
 * What a client component needs to write an inline script into the server
 * HTML: the request's CSP nonce and the script text. The root layout passes
 * both in, so the text is not part of the client bundle
 * (components/layout/AppNavigation.tsx).
 */
interface EarlyScripts {
  nonce?: string
  menu?: string
}

const EarlyScriptContext = createContext<EarlyScripts>({})

export function useEarlyScripts(): EarlyScripts {
  return useContext(EarlyScriptContext)
}

interface ProvidersProps {
  children: React.ReactNode
  /** CSP nonce for the inline theme and early-menu scripts. */
  nonce?: string
  /** Text of the early-menu script (lib/navigation/earlyMenu.ts). */
  earlyMenuScript?: string
}

export default function Providers({
  children,
  nonce,
  earlyMenuScript,
}: ProvidersProps) {
  return (
    <EarlyScriptContext.Provider value={{ nonce, menu: earlyMenuScript }}>
      <ConvexAuthProvider client={convex}>
        <AuthSessionProvider>
          <ThemeProvider nonce={nonce}>
            <WalletActivationProvider>
              <ErrorBoundary
                fallback={({ reset }) => (
                  <WalletErrorFallback onRetry={reset} />
                )}
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
    </EarlyScriptContext.Provider>
  )
}
