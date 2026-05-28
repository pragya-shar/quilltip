'use client'

import { useState, useRef } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import {
  useAuthorEarnings,
  useUserByUsername,
  useUserReceivedTips,
} from '@/hooks/convex'
import { AlertCircle, CheckCircle2, Coins, X } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAuth } from '@/components/providers/AuthContext'
import { MIN_WITHDRAWAL_USD } from '@/lib/constants'
import { TipHistory } from '@/components/dashboard/TipHistory'
import { WithdrawalDialog } from '@/components/dashboard/WithdrawalDialog'
import { EarningsStats } from '@/components/dashboard/EarningsStats'
import { EarningsDashboardSkeleton } from '@/components/dashboard/EarningsDashboardSkeleton'

type WithdrawalOutcome =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

export function EarningsDashboard() {
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [withdrawalOutcome, setWithdrawalOutcome] =
    useState<WithdrawalOutcome | null>(null)
  const [withdrawalDialogError, setWithdrawalDialogError] = useState<
    string | null
  >(null)
  const withdrawTriggerRef = useRef<HTMLButtonElement>(null)

  const { user: currentUser } = useAuth()

  const earnings = useAuthorEarnings()
  const recentTips = useUserReceivedTips()
  const userProfile = useUserByUsername(currentUser?.username)

  const withdrawEarnings = useMutation(api.tips.withdrawEarnings)

  const handleWithdrawFromDialog = async (args: {
    amountUsd: number
    stellarAddress: string
  }) => {
    try {
      await withdrawEarnings({
        amountUsd: args.amountUsd,
        stellarAddress: args.stellarAddress,
      })
      const successMessage = `Withdrawal initiated! $${args.amountUsd.toFixed(2)} in testnet XLM will be sent to your Stellar wallet, typically within seconds on testnet.`
      setWithdrawalDialogError(null)
      setWithdrawalOutcome({ kind: 'success', message: successMessage })
      toast.success(successMessage)
    } catch (error) {
      console.error('Withdrawal error:', error)
      const message =
        error instanceof Error ? error.message : 'Failed to process withdrawal'
      setWithdrawalOutcome({ kind: 'error', message })
      setWithdrawalDialogError(message)
      toast.error(message)
      throw error
    }
  }

  if (earnings === undefined || recentTips === undefined) {
    return <EarningsDashboardSkeleton />
  }

  if (!earnings) {
    return (
      <div className="space-y-6">
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-12 text-center">
          <Coins className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No testnet tips yet
          </h3>
          <p className="text-muted-foreground">
            Share great content and receive practice tips on Stellar testnet.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {withdrawalOutcome && (
        <div className="flex items-start gap-2">
          <Alert
            variant={
              withdrawalOutcome.kind === 'error' ? 'destructive' : 'default'
            }
            className={
              withdrawalOutcome.kind === 'success'
                ? 'flex-1 border-success/50 bg-success/10'
                : 'flex-1'
            }
          >
            {withdrawalOutcome.kind === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-success-foreground" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertTitle>
              {withdrawalOutcome.kind === 'success'
                ? 'Withdrawal initiated'
                : 'Withdrawal failed'}
            </AlertTitle>
            <AlertDescription>{withdrawalOutcome.message}</AlertDescription>
          </Alert>
          <button
            type="button"
            onClick={() => setWithdrawalOutcome(null)}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss withdrawal message"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <EarningsStats
        earnings={earnings}
        userProfile={userProfile}
        minWithdrawalUsd={MIN_WITHDRAWAL_USD}
        onOpenWithdrawModal={() => {
          setWithdrawalDialogError(null)
          setShowWithdrawModal(true)
        }}
        withdrawTriggerRef={withdrawTriggerRef}
      />

      <TipHistory tips={recentTips} />

      <WithdrawalDialog
        open={showWithdrawModal}
        onOpenChange={setShowWithdrawModal}
        availableBalanceUsd={earnings.availableBalanceUsd}
        minWithdrawalUsd={MIN_WITHDRAWAL_USD}
        savedStellarAddress={userProfile?.stellarAddress}
        onWithdraw={handleWithdrawFromDialog}
        triggerRef={withdrawTriggerRef}
        externalError={withdrawalDialogError}
      />
    </div>
  )
}
