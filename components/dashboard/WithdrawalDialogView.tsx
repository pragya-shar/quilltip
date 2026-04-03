'use client'

import { Loader2, Wallet } from 'lucide-react'
import { DialogFooter } from '@/components/ui/dialog'

export type WithdrawalDialogViewProps = {
  minWithdrawalUsd: number
  availableBalanceUsd: number
  savedStellarAddress?: string | null
  withdrawAmount: string
  onWithdrawAmountChange: (value: string) => void
  stellarAddress: string
  onStellarAddressChange: (value: string) => void
  addressForSubmit: string
  isSubmitting: boolean
  onCancel: () => void
  onSubmit: () => void
}

export function WithdrawalDialogView({
  minWithdrawalUsd,
  availableBalanceUsd,
  savedStellarAddress,
  withdrawAmount,
  onWithdrawAmountChange,
  stellarAddress,
  onStellarAddressChange,
  addressForSubmit,
  isSubmitting,
  onCancel,
  onSubmit,
}: WithdrawalDialogViewProps) {
  return (
    <>
      <div className="space-y-4 py-2">
        <div>
          <label
            htmlFor="withdraw-amount"
            className="mb-2 block text-sm font-medium text-foreground"
          >
            Amount (USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              $
            </span>
            <input
              id="withdraw-amount"
              type="number"
              min={minWithdrawalUsd}
              max={availableBalanceUsd}
              step="0.01"
              value={withdrawAmount}
              onChange={(e) => onWithdrawAmountChange(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-lg border border-input bg-background py-2 pl-8 pr-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={`${minWithdrawalUsd.toFixed(2)}`}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Available: ${availableBalanceUsd.toFixed(2)} | Min: $
            {minWithdrawalUsd.toFixed(2)}
          </p>
        </div>

        <div>
          <label
            htmlFor="stellar-address"
            className="mb-2 block text-sm font-medium text-foreground"
          >
            Stellar Address
          </label>
          <input
            id="stellar-address"
            type="text"
            value={stellarAddress || savedStellarAddress || ''}
            onChange={(e) => onStellarAddressChange(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted"
            placeholder="G..."
            readOnly={!!savedStellarAddress}
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {savedStellarAddress
              ? 'Using your saved wallet address from Wallet settings'
              : 'Enter your Stellar wallet address'}
          </p>
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/40">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            Withdrawals are processed instantly on the Stellar network.
            Transaction fees are covered by Quilltip.
          </p>
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 sm:flex-none"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={
            isSubmitting || !withdrawAmount || !addressForSubmit
          }
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-yellow-400 to-orange-500 px-4 py-2 text-sm font-medium text-white hover:from-yellow-500 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Wallet className="h-4 w-4" />
              Withdraw
            </>
          )}
        </button>
      </DialogFooter>
    </>
  )
}
