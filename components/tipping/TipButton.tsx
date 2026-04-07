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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface TipButtonProps {
  articleId: Id<'articles'>
  authorName: string
  authorStellarAddress?: string | null
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

  const handleOpenChange = (open: boolean) => {
    if (!open && isLoading) return
    setIsOpen(open)
  }

  const handleTip = async () => {
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

    if (!authorStellarAddress) {
      toast.error(
        'Author has not set up their Stellar wallet for receiving tips'
      )
      return
    }

    setIsLoading(true)

    try {
      const transactionData = await stellarClient.buildTipTransaction(
        publicKey,
        {
          tipper: publicKey,
          articleId: articleId.toString(),
          authorAddress: authorStellarAddress,
          amountCents,
        }
      )

      const signedXDR = await signTransaction(transactionData.xdr)
      const receipt = await stellarClient.submitTipTransaction(signedXDR)

      await sendTip({
        articleId,
        amountUsd: amountCents / 100,
        message: `Stellar tip: ${receipt.transactionHash}`,
      })

      setIsOpen(false)
      setSelectedAmount(null)
      setCustomAmount('')

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

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`focus-ring inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 transition-all transform hover:scale-105 shadow-lg ${className}`}
        >
          <Coins className="w-4 h-4" />
          <span className="font-medium">Tip Author</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="top-auto bottom-0 left-1/2 max-h-[min(90dvh,calc(100%-2rem))] max-w-md translate-x-[-50%] translate-y-0 gap-4 overflow-y-auto rounded-b-none rounded-t-xl border border-border bg-popover p-6 shadow-xl data-[state=closed]:slide-out-to-bottom-[48%] data-[state=open]:slide-in-from-bottom-[48%] sm:top-[50%] sm:bottom-auto sm:max-h-[min(90dvh,100%)] sm:translate-y-[-50%] sm:rounded-xl sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]"
        onInteractOutside={(e) => {
          if (isLoading) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isLoading) e.preventDefault()
        }}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl font-bold">
            Support {authorName}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Show your appreciation with a micro-tip. 97.5% goes directly to the
            author!
          </DialogDescription>
        </DialogHeader>

        {!isConnected && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
            <p>Connect your Stellar wallet to send tips to {authorName}.</p>
            <p className="mt-1">
              New to crypto?{' '}
              <Link
                href="/guide"
                className="focus-ring rounded text-amber-700 underline font-medium hover:text-amber-900"
              >
                Follow our setup guide
              </Link>
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {TIP_PRESETS_ARTICLE.map((amount) => (
            <button
              key={amount.cents}
              type="button"
              onClick={() => {
                setSelectedAmount(amount.cents)
                setCustomAmount('')
              }}
              disabled={isLoading}
              className={`focus-ring relative px-4 py-3 rounded-lg border-2 transition-all disabled:opacity-50 ${
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

        <div>
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
              disabled={isLoading}
              placeholder="0.00"
              className="focus-ring w-full pl-8 pr-4 py-2 border border-input bg-background text-foreground rounded-lg disabled:opacity-50"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Minimum: ${TIP_MIN_USD.toFixed(2)} • Maximum: $
            {TIP_MAX_USD.toFixed(2)}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
            className="focus-ring flex-1 px-4 py-2 border border-input bg-background text-foreground rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>

          {!isConnected ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  await connect()
                  toast.success('Wallet connected successfully!')
                } catch {
                  toast.error('Failed to connect wallet')
                }
              }}
              disabled={isLoading}
              className="focus-ring flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Wallet className="w-4 h-4" />
              <span>Connect Wallet</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleTip}
              disabled={isLoading || (!selectedAmount && !customAmount)}
              className="focus-ring flex-1 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

        {isConnected && publicKey && (
          <div className="text-xs text-green-800 dark:text-green-300 text-center">
            <p className="flex items-center justify-center gap-1">
              <Wallet className="w-3 h-3" />
              Connected: {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
          Powered by Stellar <WalletTooltip concept="stellar" /> • Instant
          settlement • Low fees
        </p>
      </DialogContent>
    </Dialog>
  )
}
