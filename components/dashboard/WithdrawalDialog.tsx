'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { WithdrawalDialogView } from '@/components/dashboard/WithdrawalDialogView'

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
}

export function WithdrawalDialog({
  open,
  onOpenChange,
  availableBalanceUsd,
  minWithdrawalUsd,
  savedStellarAddress,
  onWithdraw,
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

  return (
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
      onCancel={() => onOpenChange(false)}
      onSubmit={handleSubmit}
    />
  )
}
