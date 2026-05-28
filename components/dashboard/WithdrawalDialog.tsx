'use client'

import { useEffect, useState, type RefObject } from 'react'
import { Loader2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isValidStellarAccountId } from '@/lib/stellar/is-valid-stellar-account-id'
import { TESTNET_WITHDRAWAL_NOTE } from '@/lib/copy/network-status'

export type WithdrawalDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableBalanceUsd: number
  minWithdrawalUsd: number
  savedStellarAddress?: string | null
  onWithdraw: (args: {
    amountUsd: number
    stellarAddress: string
  }) => Promise<void>
  triggerRef: RefObject<HTMLButtonElement | null>
}

export function WithdrawalDialog({
  open,
  onOpenChange,
  availableBalanceUsd,
  minWithdrawalUsd,
  savedStellarAddress,
  onWithdraw,
  triggerRef,
}: WithdrawalDialogProps) {
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [stellarAddress, setStellarAddress] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setWithdrawAmount('')
      setStellarAddress(savedStellarAddress ?? '')
    }
  }, [open, savedStellarAddress])

  const handleOpenChange = (next: boolean) => {
    if (!next && isSubmitting) return
    onOpenChange(next)
  }

  const trimmedAddress = (stellarAddress || savedStellarAddress || '').trim()
  const showAddressError =
    trimmedAddress.length > 0 && !isValidStellarAccountId(trimmedAddress)

  const handleSubmit = async () => {
    const amount = parseFloat(withdrawAmount)

    if (!amount || amount < minWithdrawalUsd) {
      toast.error(
        `Minimum withdrawal amount is $${minWithdrawalUsd.toFixed(2)}`
      )
      return
    }

    if (!isValidStellarAccountId(trimmedAddress)) {
      toast.error('Please enter a valid Stellar address')
      return
    }

    if (amount > availableBalanceUsd) {
      toast.error('Insufficient balance')
      return
    }

    setIsSubmitting(true)
    try {
      await onWithdraw({
        amountUsd: amount,
        stellarAddress: trimmedAddress,
      })
      onOpenChange(false)
    } catch {
      // Parent shows toast for mutation errors
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!open) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          triggerRef.current?.focus()
        }}
        onInteractOutside={(e) => {
          if (isSubmitting) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isSubmitting) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Withdraw Testnet Earnings</DialogTitle>
          <DialogDescription>
            Send testnet XLM to your Stellar wallet
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="withdraw-amount"
              className="block text-sm font-medium text-foreground mb-2"
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
                onChange={(e) => setWithdrawAmount(e.target.value)}
                disabled={isSubmitting}
                className="w-full pl-8 pr-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={`${minWithdrawalUsd.toFixed(2)}`}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Available: ${availableBalanceUsd.toFixed(2)} | Min: $
              {minWithdrawalUsd.toFixed(2)}
            </p>
          </div>

          <div>
            <label
              htmlFor="stellar-address"
              className="block text-sm font-medium text-foreground mb-2"
            >
              Stellar Address
            </label>
            <input
              id="stellar-address"
              type="text"
              value={stellarAddress || savedStellarAddress || ''}
              onChange={(e) => setStellarAddress(e.target.value)}
              aria-invalid={showAddressError}
              className={`w-full px-3 py-2 border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/50 ${
                showAddressError
                  ? 'border-destructive focus:ring-destructive'
                  : 'border-input focus:ring-ring'
              }`}
              placeholder="G..."
              readOnly={!!savedStellarAddress}
              disabled={isSubmitting}
            />
            {showAddressError ? (
              <p className="text-xs text-destructive mt-1" role="alert">
                Invalid Stellar address
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                {savedStellarAddress
                  ? 'Using your saved wallet address from Wallet settings'
                  : 'Enter your Stellar wallet address'}
              </p>
            )}
          </div>

          <div className="bg-info border border-info/50 rounded-lg p-3">
            <p className="text-sm text-info-foreground">
              {TESTNET_WITHDRAWAL_NOTE} Transaction fees are covered by
              Quilltip.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-3 sm:gap-0">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 border border-input bg-background text-foreground rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed sm:flex-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={
              isSubmitting ||
              !withdrawAmount ||
              !trimmedAddress ||
              !isValidStellarAccountId(trimmedAddress)
            }
            className="flex-1 px-4 py-2 bg-brand text-brand-foreground rounded-lg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 sm:flex-none"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4" />
                Withdraw
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
