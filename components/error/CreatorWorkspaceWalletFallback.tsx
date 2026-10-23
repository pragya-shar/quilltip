'use client'

import Link from 'next/link'

export function CreatorWorkspaceWalletFallback() {
  return (
    <div className="rounded-lg border border-border bg-muted p-4">
      <p className="font-medium text-foreground">Wallet panel unavailable.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Open wallet settings to manage tip payouts.
      </p>
      <Link
        href="/dashboard/wallet"
        className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Wallet settings
      </Link>
    </div>
  )
}
