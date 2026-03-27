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

  const withdrawEarnings = useMutation(api.tips.withdrawEarnings)

  useEffect(() => {
    if (open) {
      setWithdrawAmount('')
      setStellarAddress(savedStellarAddress ?? '')
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
        `Withdrawal initiated! $${amount.toFixed(2)} will be sent to your Stellar wallet shortly.`
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
          <DialogTitle>Withdraw Earnings</DialogTitle>
          <DialogDescription>Withdraw to your Stellar wallet</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="withdraw-amount"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Amount (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
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
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                placeholder={`${MIN_WITHDRAWAL_USD.toFixed(2)}`}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Available: ${availableBalanceUsd.toFixed(2)} | Min: $
              {MIN_WITHDRAWAL_USD.toFixed(2)}
            </p>
          </div>

          <div>
            <label
              htmlFor="stellar-address"
              className="block text-sm font-medium text-gray-700 mb-2"
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 read-only:bg-gray-50"
              placeholder="G..."
            />
            <p className="text-xs text-gray-500 mt-1">
              {savedStellarAddress
                ? 'Using your saved wallet address from Wallet settings'
                : 'Enter your Stellar wallet address'}
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              Withdrawals are processed instantly on the Stellar network.
              Transaction fees are covered by Quilltip.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-3 sm:gap-0">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={isWithdrawing}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed sm:flex-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={
              isWithdrawing ||
              !withdrawAmount ||
              !effectiveAddress.startsWith('G')
            }
            className="flex-1 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 sm:flex-none"
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
