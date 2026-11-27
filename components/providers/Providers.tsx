'use client'

import { createContext, useContext } from 'react'
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

/**
 * What a client component needs to write an inline script into the server
 * HTML: the request's CSP nonce and the script text. The root layout passes
 * both in, so the text is not part of the client bundle
 * (components/layout/EarlyMenuScript.tsx).
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
