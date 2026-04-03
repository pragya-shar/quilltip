'use client'

import { useEffect, useState, type RefObject } from 'react'
import { toast } from 'sonner'
import { WithdrawalDialogView } from '@/components/dashboard/WithdrawalDialogView'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  /** Button that opens the dialog; focus returns here after close (Radix has no DialogTrigger). */
  triggerRef?: RefObject<HTMLButtonElement | null>
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

  if (!open) {
    return null
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

  const handleOpenChange = (next: boolean) => {
    if (!next && isSubmitting) return
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault()
            triggerRef.current.focus()
          }
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
        <WithdrawalDialogView
          minWithdrawalUsd={minWithdrawalUsd}
          availableBalanceUsd={availableBalanceUsd}
          savedStellarAddress={savedStellarAddress}
          withdrawAmount={withdrawAmount}
          onWithdrawAmountChange={setWithdrawAmount}
          stellarAddress={stellarAddress}
          onStellarAddressChange={setStellarAddress}
          addressForSubmit={addressForSubmit}
          isSubmitting={isSubmitting}
          onCancel={() => handleOpenChange(false)}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
