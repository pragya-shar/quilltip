'use client'

// Full navigation remounts the failed provider tree; client routing cannot recover it.
/* eslint-disable @next/next/no-html-link-for-pages */

import { FailurePageShell } from './FailurePageShell'

export function WalletErrorFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <main>
      <FailurePageShell
        label="Connection interrupted"
        heading={
          <h1 className="failure-heading">Wallet connection unavailable.</h1>
        }
        description="Try connecting again, or reload the reading room to continue browsing."
        actions={
          <>
            <button type="button" className="failure-action" onClick={onRetry}>
              Try again
            </button>
            <a href="/articles" className="failure-link">
              Browse articles
            </a>
            <a href="/" className="failure-link">
              Go home
            </a>
          </>
        }
      />
    </main>
  )
}
