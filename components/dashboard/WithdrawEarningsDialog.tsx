'use client'

import { useEffect, useState, type RefObject } from 'react'
import { useMutation } from 'convex/react'
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
import { api } from '@/convex/_generated/api'
import { MIN_WITHDRAWAL_USD } from '@/lib/constants'
import {
  TESTNET_WITHDRAWAL_NOTE,
  withdrawalAcknowledgementLabel,
  withdrawalFlowNote,
} from '@/lib/copy/network-status'

interface WithdrawEarningsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableBalanceUsd: number
  savedStellarAddress?: string | null
  /** Button that opens the dialog; required so focus returns after close (Radix has no DialogTrigger). */
  triggerRef: RefObject<HTMLButtonElement | null>
}

export function WithdrawEarningsDialog({
  open,
  onOpenChange,
  availableBalanceUsd,
  savedStellarAddress,
  triggerRef,
}: WithdrawEarningsDialogProps) {
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [stellarAddress, setStellarAddress] = useState('')
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const withdrawEarnings = useMutation(api.tips.withdrawEarnings)

  useEffect(() => {
    if (open) {
      setWithdrawAmount('')
      setStellarAddress(savedStellarAddress ?? '')
      setAcknowledged(false)
    }
  }, [open, savedStellarAddress])

  const handleOpenChange = (next: boolean) => {
    if (!next && isWithdrawing) return
    onOpenChange(next)
  }

  const effectiveAddress = (savedStellarAddress ?? stellarAddress).trim()

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount)

    if (!amount || amount < MIN_WITHDRAWAL_USD) {
      toast.error(
        `Minimum withdrawal amount is $${MIN_WITHDRAWAL_USD.toFixed(2)}`
      )
      return
    }

    if (!effectiveAddress || !effectiveAddress.startsWith('G')) {
      toast.error('Please enter a valid Stellar address')
      return
    }

    if (amount > availableBalanceUsd) {
      toast.error('Insufficient balance')
      return
    }

    setIsWithdrawing(true)
    try {
      await withdrawEarnings({
        amountUsd: amount,
        stellarAddress: effectiveAddress,
      })

      toast.success(
        `Withdrawal requested for $${amount.toFixed(2)}. ${withdrawalFlowNote()}`
      )
      onOpenChange(false)
    } catch (error) {
      console.error('Withdrawal error:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to process withdrawal'
      )
    } finally {
      setIsWithdrawing(false)
    }
  }

  const addressReadOnly = !!savedStellarAddress
  const addressDisplay = addressReadOnly ? savedStellarAddress : stellarAddress

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          triggerRef.current?.focus()
        }}
        onInteractOutside={(e) => {
          if (isWithdrawing) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isWithdrawing) e.preventDefault()
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
                min={MIN_WITHDRAWAL_USD}
                max={availableBalanceUsd}
                step="0.01"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                disabled={isWithdrawing}
                className="w-full pl-8 pr-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={`${MIN_WITHDRAWAL_USD.toFixed(2)}`}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Available: ${availableBalanceUsd.toFixed(2)} | Min: $
              {MIN_WITHDRAWAL_USD.toFixed(2)}
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
              value={addressDisplay}
              onChange={(e) => setStellarAddress(e.target.value)}
              readOnly={addressReadOnly}
              disabled={isWithdrawing}
              className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/50"
              placeholder="G..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              {savedStellarAddress
                ? 'Using your saved wallet address from Wallet settings'
                : 'Enter your Stellar wallet address'}
            </p>
          </div>

          <div className="bg-info border border-info/50 rounded-lg p-3">
            <p className="text-sm text-info-foreground">
              {TESTNET_WITHDRAWAL_NOTE} Transaction fees are covered by
              Quilltip.
            </p>
            <p className="mt-2 text-sm text-info-foreground">
              {withdrawalFlowNote()}
            </p>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              disabled={isWithdrawing}
              className="mt-0.5 h-4 w-4 accent-foreground"
            />
            <span>{withdrawalAcknowledgementLabel()}</span>
          </label>
        </div>

        <DialogFooter className="gap-3 sm:gap-0">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={isWithdrawing}
            className="flex-1 px-4 py-2 border border-input bg-background text-foreground rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed sm:flex-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={
              isWithdrawing ||
              !withdrawAmount ||
              !effectiveAddress.startsWith('G') ||
              !acknowledged
            }
            className="flex-1 px-4 py-2 bg-brand text-brand-foreground rounded-lg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 sm:flex-none"
          >
            {isWithdrawing ? (
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
