'use client'

import { AlertCircle } from 'lucide-react'

export function navigateToWalletTab() {
  const walletTab = document.querySelector(
    '[data-tab="wallet"]'
  ) as HTMLButtonElement | null
  if (walletTab) walletTab.click()
}

export function WalletSetupNotice() {
  return (
    <div className="bg-warning border border-warning/50 rounded-lg p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-warning-foreground mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-warning-foreground mb-1">
            Stellar Wallet Not Configured
          </h3>
          <p className="text-sm text-warning-foreground mb-3">
            Please set up your Stellar wallet in the Wallet tab to enable
            withdrawals.
          </p>
          <button
            type="button"
            onClick={navigateToWalletTab}
            className="text-sm font-medium text-warning-foreground hover:text-warning-foreground/80 underline"
          >
            Go to Wallet Settings →
          </button>
        </div>
      </div>
    </div>
  )
}
