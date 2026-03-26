'use client'

import { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import {
  useAuthorEarnings,
  useUserByUsername,
  useUserReceivedTips,
} from '@/hooks/convex'
import {
  Coins,
  TrendingUp,
  Clock,
  DollarSign,
  Loader2,
  Wallet,
  AlertCircle,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { useAuth } from '@/components/providers/AuthContext'
import { MIN_WITHDRAWAL_USD } from '@/lib/constants'

export function EarningsDashboard() {
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [stellarAddress, setStellarAddress] = useState('')
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)

  const { user: currentUser } = useAuth()

  // Fetch earnings data
  const earnings = useAuthorEarnings()
  const recentTips = useUserReceivedTips()
  const userProfile = useUserByUsername(currentUser?.username)

  // Withdrawal mutations
  const withdrawEarnings = useMutation(api.tips.withdrawEarnings)

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount)

    if (!amount || amount < MIN_WITHDRAWAL_USD) {
      toast.error(
        `Minimum withdrawal amount is $${MIN_WITHDRAWAL_USD.toFixed(2)}`
      )
      return
    }

    if (!stellarAddress || !stellarAddress.startsWith('G')) {
      toast.error('Please enter a valid Stellar address')
      return
    }

    if (earnings && amount > earnings.availableBalanceUsd) {
      toast.error('Insufficient balance')
      return
    }

    setIsWithdrawing(true)
    try {
      // Initiate withdrawal - this automatically schedules confirmation
      await withdrawEarnings({
        amountUsd: amount,
        stellarAddress: stellarAddress,
      })

      // Show success
      toast.success(
        `Withdrawal initiated! $${amount.toFixed(2)} will be sent to your Stellar wallet shortly.`
      )
      setShowWithdrawModal(false)
      setWithdrawAmount('')
      setStellarAddress('')

      // Note: The confirmWithdrawal is automatically scheduled by the backend
      // In production, this would be triggered by a webhook from Stellar
    } catch (error) {
      console.error('Withdrawal error:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to process withdrawal'
      )
    } finally {
      setIsWithdrawing(false)
    }
  }

  // Loading state
  if (earnings === undefined || recentTips === undefined) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6"
            >
              <Skeleton className="h-4 w-24 mb-4" />
              <Skeleton className="h-8 w-20 mb-2" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // No earnings yet
  if (!earnings) {
    return (
      <div className="space-y-6">
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-12 text-center">
          <Coins className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No earnings yet
          </h3>
          <p className="text-muted-foreground">
            Start earning by sharing great content that readers love!
          </p>
        </div>
      </div>
    )
  }

  // Get last withdrawal date from earnings
  const lastWithdrawal = earnings.lastWithdrawalAt

  return (
    <div className="space-y-6">
      {/* Wallet Setup Notice */}
      {userProfile && !userProfile.stellarAddress && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-yellow-900 mb-1">
                Stellar Wallet Not Configured
              </h3>
              <p className="text-sm text-yellow-800 mb-3">
                Please set up your Stellar wallet in the Wallet tab to enable
                withdrawals.
              </p>
              <button
                onClick={() => {
                  // Navigate to wallet tab
                  const walletTab = document.querySelector(
                    '[data-tab="wallet"]'
                  ) as HTMLButtonElement
                  if (walletTab) walletTab.click()
                }}
                className="text-sm font-medium text-yellow-900 hover:text-yellow-700 underline"
              >
                Go to Wallet Settings →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">Total Earned</span>
            <DollarSign className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            ${earnings.totalEarnedUsd.toFixed(2)}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {earnings.tipCount} tips received
          </p>
        </div>

        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">Available Balance</span>
            <Coins className="w-5 h-5 text-yellow-500" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            ${earnings.availableBalanceUsd.toFixed(2)}
          </p>
          <button
            onClick={() => {
              if (!userProfile?.stellarAddress) {
                // Navigate to wallet tab
                const walletTab = document.querySelector(
                  '[data-tab="wallet"]'
                ) as HTMLButtonElement
                if (walletTab) walletTab.click()
              } else {
                setStellarAddress(userProfile.stellarAddress)
                setShowWithdrawModal(true)
              }
            }}
            disabled={earnings.availableBalanceUsd < MIN_WITHDRAWAL_USD}
            className="mt-3 w-full px-3 py-1.5 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-sm rounded-lg hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Wallet className="w-4 h-4" />
            {!userProfile?.stellarAddress ? 'Set Up Wallet' : 'Withdraw'}
          </button>
        </div>

        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">Total Withdrawn</span>
            <Clock className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            ${earnings.withdrawnUsd.toFixed(2)}
          </p>
          {lastWithdrawal && (
            <p className="text-sm text-muted-foreground mt-1">
              Last: {new Date(lastWithdrawal).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {/* Monthly Earnings Chart */}
      {earnings.monthlyEarnings &&
        Object.keys(earnings.monthlyEarnings).length > 0 && (
          <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
            <h3 className="text-lg font-semibold mb-4">Monthly Earnings</h3>
            <div className="grid grid-cols-6 gap-2">
              {Object.entries(earnings.monthlyEarnings)
                .sort(([a], [b]) => b.localeCompare(a))
                .slice(0, 6)
                .reverse()
                .map(([month, amount]) => (
                  <div key={month} className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">
                      {month}
                    </div>
                    <div className="bg-gradient-to-t from-yellow-400 to-orange-500 rounded-lg p-2">
                      <p className="text-sm font-semibold text-white">
                        ${(amount as number).toFixed(0)}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

      {/* Top Articles */}
      {earnings.topArticles && earnings.topArticles.length > 0 && (
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border">
          <div className="p-6 border-b">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-500" />
              Top Earning Articles
            </h3>
          </div>
          <div className="divide-y">
            {earnings.topArticles.slice(0, 5).map((article, index) => (
              <div key={article.articleId} className="p-4 hover:bg-muted/50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">
                        #{index + 1}
                      </span>
                      <h4 className="font-medium text-foreground">
                        {article.title}
                      </h4>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {article.tipCount} tips
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-foreground">
                      ${article.earnings.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Tips */}
      {recentTips && recentTips.length > 0 && (
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border">
          <div className="p-6 border-b">
            <h3 className="text-lg font-semibold">Recent Tips</h3>
          </div>
          <div className="divide-y">
            {recentTips.slice(0, 10).map((tip) => (
              <div key={tip._id} className="p-4 hover:bg-muted/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">
                      {tip.tipper?.name || tip.tipper?.username || 'Anonymous'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      tipped on &ldquo;{tip.articleTitle}&rdquo;
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-green-600">
                      +${tip.amountUsd.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(tip.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Withdrawal Modal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-popover text-popover-foreground rounded-lg shadow-xl border border-border w-full max-w-md">
            <div className="p-6 border-b border-border">
              <h3 className="text-lg font-semibold">Withdraw Earnings</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Withdraw to your Stellar wallet
              </p>
            </div>

            <div className="p-6 space-y-4">
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
                    max={earnings.availableBalanceUsd}
                    step="0.01"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder={`${MIN_WITHDRAWAL_USD.toFixed(2)}`}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Available: ${earnings.availableBalanceUsd.toFixed(2)} | Min: $
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
                  value={stellarAddress || userProfile?.stellarAddress || ''}
                  onChange={(e) => setStellarAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="G..."
                  readOnly={!!userProfile?.stellarAddress}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {userProfile?.stellarAddress
                    ? 'Using your saved wallet address from Wallet settings'
                    : 'Enter your Stellar wallet address'}
                </p>
              </div>

              {/* Info Box */}
              <div className="bg-muted border border-border rounded-lg p-3">
                <p className="text-sm text-foreground">
                  Withdrawals are processed instantly on the Stellar network.
                  Transaction fees are covered by Quilltip.
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-border flex gap-3">
              <button
                onClick={() => setShowWithdrawModal(false)}
                className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleWithdraw}
                disabled={isWithdrawing || !withdrawAmount || !stellarAddress}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
