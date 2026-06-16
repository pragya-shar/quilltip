'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation } from 'convex/react'
import { AlertCircle, Loader2, PlugZap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { InstallWalletDialog } from '@/components/stellar/InstallWalletDialog'
import { useWallet } from '@/components/providers/WalletProvider'
import type { FlowFeedback } from '@/lib/feedback/flow-feedback'
import {
  NO_WALLET_AVAILABLE_ERROR_CODE,
  ALBEDO_INSECURE_LOCALHOST_ERROR_CODE,
} from '@/lib/stellar/wallet-adapter'
import { cn } from '@/lib/utils'

export type WalletSetupMode = 'send' | 'receive'

export interface ContextualWalletSetupProps {
  mode: WalletSetupMode
  recipientLabel?: string
  onAddressSaved?: (address: string) => void
  onConnected?: () => void
  className?: string
}

function getHeadline(mode: WalletSetupMode, recipientLabel?: string): string {
  if (mode === 'send') {
    return recipientLabel
      ? `Connect to tip ${recipientLabel}`
      : 'Connect to send a tip'
  }
  return 'Connect to receive tips'
}

function getBody(mode: WalletSetupMode): string {
  if (mode === 'send') {
    return "You'll sign the tip in your Stellar wallet."
  }
  return 'When readers tip your articles, payments go to this wallet.'
}

export function ContextualWalletSetup({
  mode,
  recipientLabel,
  onAddressSaved,
  onConnected,
  className,
}: ContextualWalletSetupProps) {
  const updateProfile = useMutation(api.users.updateProfile)
  const { isLoading, connect } = useWallet({
    activateOnMount: true,
  })
  const [isConnecting, setIsConnecting] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [feedback, setFeedback] = useState<FlowFeedback | null>(null)

  const handleConnect = async () => {
    setIsConnecting(true)
    setFeedback(null)
    try {
      const success = await connect()
      if (!success) {
        setFeedback({
          variant: 'destructive',
          title: 'Failed to connect wallet',
          detail: 'Try again or choose a different wallet extension.',
        })
        toast.error('Failed to connect wallet')
        return
      }

      if (mode === 'receive') {
        const { walletAdapter } = await import('@/lib/stellar/wallet-adapter')
        const connectedKey = await walletAdapter.getPublicKey()
        if (connectedKey) {
          await updateProfile({ stellarAddress: connectedKey })
          onAddressSaved?.(connectedKey)
          toast.success('Wallet connected and saved successfully!')
        }
      } else {
        toast.success('Wallet connected successfully!')
      }

      onConnected?.()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to connect wallet'

      if (message.startsWith(`${NO_WALLET_AVAILABLE_ERROR_CODE}:`)) {
        setInstallDialogOpen(true)
        return
      }

      if (message.startsWith(`${ALBEDO_INSECURE_LOCALHOST_ERROR_CODE}:`)) {
        return
      }

      setFeedback({
        variant: 'destructive',
        title: 'Failed to connect wallet',
        detail: message,
      })
      toast.error(message)
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <>
      <div
        className={cn(
          'rounded-lg border border-border bg-muted/40 p-4 space-y-3',
          className
        )}
      >
        {feedback && (
          <Alert
            variant={
              feedback.variant === 'destructive' ? 'destructive' : 'default'
            }
          >
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{feedback.title}</AlertTitle>
            {feedback.detail ? (
              <AlertDescription>{feedback.detail}</AlertDescription>
            ) : null}
          </Alert>
        )}

        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {getHeadline(mode, recipientLabel)}
          </p>
          <p className="text-sm text-muted-foreground">{getBody(mode)}</p>
        </div>

        <Button
          type="button"
          onClick={() => void handleConnect()}
          disabled={isConnecting || isLoading}
          className="w-full"
          size="lg"
        >
          {isConnecting || isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Connecting wallet...
            </>
          ) : (
            <>
              <PlugZap className="w-4 h-4 mr-2" />
              Connect wallet
            </>
          )}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Need more help?{' '}
          <Link
            href="/guide"
            className="text-foreground underline underline-offset-2 hover:text-foreground/80"
          >
            Wallet guide
          </Link>
        </p>
      </div>

      <InstallWalletDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
      />
    </>
  )
}
