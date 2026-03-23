'use client'

import { useState, useEffect } from 'react'
import { useMutation } from 'convex/react'
import { useAuth } from '@/components/providers/AuthContext'
import { useWallet } from '@/components/providers/WalletProvider'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Coins, Heart, Loader2, Wallet } from 'lucide-react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { stellarClient } from '@/lib/stellar/client'
import {
  generateHighlightId,
  formatTipAmount,
} from '@/lib/stellar/highlight-utils'
import {
  TIP_PRESETS_HIGHLIGHT,
  TIP_MIN_CENTS,
  TIP_MAX_CENTS,
  TIP_MIN_USD,
  TIP_MAX_USD,
} from '@/lib/constants'

interface HighlightTipButtonProps {
  articleId: Id<'articles'>
  articleSlug: string
  authorName: string
  authorStellarAddress?: string | null
  highlightText: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
  className?: string
  onSuccess?: () => void
}

export function HighlightTipButton({
  articleId,
  articleSlug,
  authorName,
  authorStellarAddress,
  highlightText,
  startOffset,
  endOffset,
  startContainerPath,
  endContainerPath,
  className = '',
  onSuccess,
}: HighlightTipButtonProps) {
  const { isAuthenticated } = useAuth()
  const { isConnected, publicKey, signTransaction, connect } = useWallet()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const createHighlightTip = useMutation(api.highlightTips.create)

  // Close modal on Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isLoading])

  const handleTip = async () => {
    // Check authentication
    if (!isAuthenticated) {
      toast.error('Please sign in to send tips')
      router.push('/login')
      return
    }

    // Check wallet connection
    if (!isConnected || !publicKey) {
      toast.error('Please connect your Stellar wallet to send tips')
      return
    }

    // Check author has Stellar address
    if (!authorStellarAddress) {
      toast.error('Author has not set up their Stellar wallet yet')
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

    setIsLoading(true)

    try {
      // Generate deterministic highlight ID
      const highlightId = await generateHighlightId(
        articleSlug,
        highlightText,
        startOffset,
        endOffset
      )

      // Build Stellar transaction
      const transactionData = await stellarClient.buildHighlightTipTransaction(
        publicKey,
        {
          highlightId,
          articleId: articleId.toString(), // Use Convex ID (alphanumeric, Symbol-safe) to match article tipping
          authorAddress: authorStellarAddress,
          amountCents,
        }
      )

      // Sign transaction with wallet
      const signedXDR = await signTransaction(transactionData.xdr)

      // Submit transaction to Stellar network
      const receipt = await stellarClient.submitTipTransaction(signedXDR)

      // Record tip in Convex
      await createHighlightTip({
        highlightId,
        articleId,
        highlightText,
        startOffset,
        endOffset,
        startContainerPath,
        endContainerPath,
        amountCents,
        stellarTxId: receipt.transactionHash ?? '',
        stellarMemo: highlightId,
        stellarNetwork: 'TESTNET',
        stellarLedger: undefined,
        stellarFeeCharged: undefined,
        stellarSourceAccount: publicKey,
        stellarDestinationAccount: authorStellarAddress,
        stellarAmountXlm: (transactionData.stroops / 10_000_000).toString(),
        contractTipId: receipt.tipId,
        platformFee: transactionData.platformFee,
        authorShare: transactionData.authorReceived,
      })

      // Close modal first
      setIsOpen(false)
      setSelectedAmount(null)
      setCustomAmount('')

      // Show success toast
      toast.success(
        `Successfully tipped ${authorName} ${formatTipAmount(amountCents)} for this highlight!`,
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

      // Call success callback
      if (onSuccess) {
        onSuccess()
      }
    } catch (error) {
      console.error('Highlight tip error:', error)

      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send tip'

      // Check for wallet signature rejection
      if (
        errorMessage.includes('User declined') ||
        errorMessage.includes('rejected')
      ) {
        toast.error('Transaction cancelled by user')
      } else {
        toast.error('Transaction failed', {
          description: errorMessage,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Truncate long text for display
  const displayText =
    highlightText.length > 60
      ? highlightText.slice(0, 60) + '...'
      : highlightText

  return (
    <>
      {/* Tip Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 transition-all transform hover:scale-105 shadow-md text-sm ${className}`}
        title="Tip this highlight"
      >
        <Coins className="w-3.5 h-3.5" />
        <span className="font-medium">Tip Highlight</span>
      </button>

      {/* Tip Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="highlight-tip-dialog-title"
        >
          {/* Backdrop — interactive button so a11y rules are satisfied */}
          <button
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              if (!isLoading) setIsOpen(false)
            }}
            aria-label="Close dialog"
            tabIndex={-1}
          />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 id="highlight-tip-dialog-title" className="text-xl font-bold">
                Tip Highlight
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Highlight Preview */}
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-gray-700 italic">
                &ldquo;{displayText}&rdquo;
              </p>
            </div>

            <p className="text-gray-600 mb-4">
              Tip {authorName} for this specific insight. 97.5% goes directly to
              the author!
            </p>

            {/* Wallet Setup Guide */}
            {!isConnected && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                <p>Connect your Stellar wallet to tip this highlight.</p>
              </div>
            )}

            {/* Preset Amounts */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {TIP_PRESETS_HIGHLIGHT.map((amount) => (
                <button
                  key={amount.cents}
                  onClick={() => {
                    setSelectedAmount(amount.cents)
                    setCustomAmount('')
                  }}
                  className={`relative px-4 py-3 rounded-lg border-2 transition-all ${
                    selectedAmount === amount.cents
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-200 hover:border-orange-300'
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
                htmlFor="highlight-tip-custom-amount"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Or enter custom amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                  $
                </span>
                <input
                  id="highlight-tip-custom-amount"
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
                  className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Minimum: ${TIP_MIN_USD.toFixed(2)} • Maximum: $
                {TIP_MAX_USD.toFixed(2)}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setIsOpen(false)}
                disabled={isLoading}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
            <p className="text-xs text-gray-500 text-center mt-2">
              Powered by Stellar • Instant settlement • Low fees
            </p>
          </div>
        </div>
      )}
    </>
  )
}
