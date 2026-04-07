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

  const addressForSubmit = stellarAddress || savedStellarAddress || ''

  const handleSubmit = async () => {
    const amount = parseFloat(withdrawAmount)

    if (!amount || amount < minWithdrawalUsd) {
      toast.error(
        `Minimum withdrawal amount is $${minWithdrawalUsd.toFixed(2)}`
      )
      return
    }

    if (!addressForSubmit || !addressForSubmit.startsWith('G')) {
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
        stellarAddress: addressForSubmit,
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
          <DialogTitle>Withdraw Earnings</DialogTitle>
          <DialogDescription>Withdraw to your Stellar wallet</DialogDescription>
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
              className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/50"
              placeholder="G..."
              readOnly={!!savedStellarAddress}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {savedStellarAddress
                ? 'Using your saved wallet address from Wallet settings'
                : 'Enter your Stellar wallet address'}
            </p>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Withdrawals are processed instantly on the Stellar network.
              Transaction fees are covered by Quilltip.
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
              !addressForSubmit ||
              !addressForSubmit.startsWith('G')
            }
            className="flex-1 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 sm:flex-none"
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
