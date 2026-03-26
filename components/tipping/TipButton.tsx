'use client'

import { useState } from 'react'
import { useMutation } from 'convex/react'
import { useAuth } from '@/components/providers/AuthContext'
import { useWallet } from '@/components/providers/WalletProvider'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Coins, Heart, Loader2, Wallet } from 'lucide-react'
import { WalletTooltip } from '@/components/guide/WalletTooltip'
import Link from 'next/link'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { stellarClient } from '@/lib/stellar/client'
import {
  TIP_PRESETS_ARTICLE,
  TIP_MIN_CENTS,
  TIP_MIN_USD,
  TIP_MAX_CENTS,
  TIP_MAX_USD,
} from '@/lib/constants'

interface TipButtonProps {
  articleId: Id<'articles'>
  authorName: string
  authorStellarAddress?: string | null // Author's Stellar address for direct tips
  className?: string
}

export function TipButton({
  articleId,
  authorName,
  authorStellarAddress,
  className = '',
}: TipButtonProps) {
  const { isAuthenticated } = useAuth()
  const { isConnected, publicKey, signTransaction, connect } = useWallet()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const sendTip = useMutation(api.tips.sendTip)

  const handleTip = async () => {
    // Check authentication and wallet connection
    if (!isAuthenticated) {
      toast.error('Please sign in to send tips')
      router.push('/auth/signin')
      return
    }

    if (!isConnected || !publicKey) {
      toast.error('Please connect your Stellar wallet to send tips')
      return
    }

    const amountCents = selectedAmount || parseFloat(customAmount) * 100

    if (!amountCents || amountCents < TIP_MIN_CENTS) {
      toast.error('Please select or enter a valid amount')
      return
    }

    if (amountCents > TIP_MAX_CENTS) {
      toast.error(`Maximum tip amount is $${TIP_MAX_USD.toFixed(0)}`)
      return
    }

    // Require author to have Stellar address configured for real tips
    if (!authorStellarAddress) {
      toast.error(
        'Author has not set up their Stellar wallet for receiving tips'
      )
      return
    }

    setIsLoading(true)

    try {
      // Build Stellar transaction using user's wallet address
      const transactionData = await stellarClient.buildTipTransaction(
        publicKey,
        {
          tipper: publicKey,
          articleId: articleId.toString(),
          authorAddress: authorStellarAddress,
          amountCents,
        }
      )

      // Sign transaction with wallet
      const signedXDR = await signTransaction(transactionData.xdr)
      // Submit transaction to Stellar network
      const receipt = await stellarClient.submitTipTransaction(signedXDR)

      // Record tip in Convex for analytics/UI (with Stellar transaction hash)
      await sendTip({
        articleId,
        amountUsd: amountCents / 100,
        message: `Stellar tip: ${receipt.transactionHash}`,
      })

      // Close modal first to prevent it from interfering with toast
      setIsOpen(false)
      setSelectedAmount(null)
      setCustomAmount('')

      // Show success toast after modal closes
      toast.success(
        `Successfully tipped ${authorName} $${(amountCents / 100).toFixed(2)} via Stellar!`,
        {
          description: receipt.transactionHash
            ? `Transaction: ${receipt.transactionHash.slice(0, 8)}...`
            : undefined,
          action: receipt.transactionHash
            ? {
                label: 'View',
                onClick: () =>
                  window.open(
                    `https://stellar.expert/explorer/testnet/tx/${receipt.transactionHash}`,
                    '_blank'
                  ),
              }
            : undefined,
        }
      )
    } catch (error) {
      console.error('Stellar tip error:', error)

      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send tip'

      // Check for wallet signature rejection
      if (
        errorMessage.includes('User declined') ||
        errorMessage.includes('rejected')
      ) {
        toast.error('Transaction cancelled by user')
        // Reset state for user cancellation
      } else {
        // Show error toast
        toast.error('Transaction failed', {
          description: errorMessage,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      {/* Tip Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 transition-all transform hover:scale-105 shadow-lg ${className}`}
      >
        <Coins className="w-4 h-4" />
        <span className="font-medium">Tip Author</span>
      </button>

      {/* Tip Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-popover text-popover-foreground rounded-xl shadow-xl border border-border max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Support {authorName}</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>

            <p className="text-muted-foreground mb-4">
              Show your appreciation with a micro-tip. 97.5% goes directly to
              the author!
            </p>

            {/* Wallet Setup Guide (shown when not connected) */}
            {!isConnected && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                <p>Connect your Stellar wallet to send tips to {authorName}.</p>
                <p className="mt-1">
                  New to crypto?{' '}
                  <Link
                    href="/guide"
                    className="text-amber-700 underline font-medium hover:text-amber-900"
                  >
                    Follow our setup guide
                  </Link>
                </p>
              </div>
            )}

            {/* Preset Amounts */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {TIP_PRESETS_ARTICLE.map((amount) => (
                <button
                  key={amount.cents}
                  onClick={() => {
                    setSelectedAmount(amount.cents)
                    setCustomAmount('')
                  }}
                  className={`relative px-4 py-3 rounded-lg border-2 transition-all ${
                    selectedAmount === amount.cents
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-border hover:border-orange-300'
                  }`}
                >
                  {amount.popular && (
                    <span className="absolute -top-2 left-1/2 transform -translate-x-1/2 px-2 py-0.5 bg-orange-500 text-white text-xs rounded-full">
                      Popular
                    </span>
                  )}
                  <span className="font-semibold">{amount.label}</span>
                </button>
              ))}
            </div>

            {/* Custom Amount */}
            <div className="mb-6">
              <label
                htmlFor="tip-custom-amount"
                className="block text-sm font-medium text-foreground mb-2"
              >
                Or enter custom amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <input
                  id="tip-custom-amount"
                  type="number"
                  min={TIP_MIN_USD}
                  max={TIP_MAX_USD}
                  step="0.01"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value)
                    setSelectedAmount(null)
                  }}
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-2 border border-input bg-background text-foreground rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Minimum: ${TIP_MIN_USD.toFixed(2)} • Maximum: $
                {TIP_MAX_USD.toFixed(2)}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setIsOpen(false)}
                disabled={isLoading}
                className="flex-1 px-4 py-2 border border-input bg-background text-foreground rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>

              {!isConnected ? (
                <button
                  onClick={async () => {
                    try {
                      await connect()
                      toast.success('Wallet connected successfully!')
                    } catch {
                      toast.error('Failed to connect wallet')
                    }
                  }}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Wallet className="w-4 h-4" />
                  <span>Connect Wallet</span>
                </button>
              ) : (
                <button
                  onClick={handleTip}
                  disabled={isLoading || (!selectedAmount && !customAmount)}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <Heart className="w-4 h-4" />
                      <span>Send Tip</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Wallet Connection Status */}
            {isConnected && publicKey && (
              <div className="text-xs text-green-600 text-center mt-4">
                <p className="flex items-center justify-center gap-1">
                  <Wallet className="w-3 h-3" />
                  Connected: {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
                </p>
              </div>
            )}

            {/* Info */}
            <p className="text-xs text-muted-foreground text-center mt-2 flex items-center justify-center gap-1">
              Powered by Stellar <WalletTooltip concept="stellar" /> • Instant
              settlement • Low fees
            </p>
          </div>
        </div>
      )}
    </>
  )
}
