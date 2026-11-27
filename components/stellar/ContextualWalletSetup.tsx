'use client'

import { useRef, useState } from 'react'
import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import { Loader2, PlugZap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InstallWalletDialog } from '@/components/stellar/InstallWalletDialog'
import { useWallet } from '@/components/providers/WalletProvider'
import type { FlowFeedback } from '@/lib/feedback/flow-feedback'
import { describeConnectFailure } from '@/lib/stellar/v2/wallet-errors'
import { useWalletOwnership } from '@/hooks/useWalletOwnership'
import { cn } from '@/lib/utils'

export type WalletSetupMode = 'send' | 'receive'

export interface ContextualWalletSetupProps {
  mode: WalletSetupMode
  recipientLabel?: string
  onAddressSaved?: (address: string) => void
  onConnected?: () => void
  showHelp?: boolean
  className?: string
}

function getHeadline(mode: WalletSetupMode, recipientLabel?: string): string {
  if (mode === 'send') {
    return recipientLabel
      ? `Connect to tip ${recipientLabel}`
      : 'Connect to send a tip'
  }
  return 'Set up your receiving wallet'
}

function getBody(mode: WalletSetupMode): string {
  if (mode === 'send') {
    return "You'll sign the tip in your Stellar wallet."
  }
  return 'Published articles can receive tips after this Stellar testnet wallet is saved.'
}

export function ContextualWalletSetup({
  mode,
  recipientLabel,
  onAddressSaved,
  onConnected,
  className,
  showHelp = true,
}: ContextualWalletSetupProps) {
  const ownership = useWalletOwnership()
  const { isLoading, isRestoring, connect } = useWallet({
    activateOnMount: true,
  })
  const [isConnecting, setIsConnecting] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const connectButtonRef = useRef<HTMLButtonElement>(null)
  const [feedback, setFeedback] = useState<FlowFeedback | null>(null)

  const handleConnect = async () => {
    if (isConnecting) return
    setIsConnecting(true)
    setFeedback(null)
    try {
      // false: the reader closed the wallet picker. Nothing to report.
      if (!(await connect())) return

      if (mode === 'receive') {
        // Linking needs proof that this wallet holds the address.
        const result = await ownership.verify()
        if (!result) return
        onAddressSaved?.(result.address)
        toast.success('Wallet verified. Tips now go to this address.')
      } else {
        toast.success('Wallet connected successfully!')
      }

      onConnected?.()
    } catch (error) {
      const failure = describeConnectFailure(error)
      if (failure.action === 'install') {
        setInstallDialogOpen(true)
        return
      }
      if (failure.action === 'ignore') return
      const { title, detail } = failure.message

      setFeedback({
        variant: 'destructive',
        title,
        detail,
      })
      toast.error(title, { description: detail })
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
        {mode === 'receive' &&
          ownership.status === 'error' &&
          ownership.error && (
            <div className="wallet-connection-notice" role="alert">
              <strong>{ownership.error.title}</strong>
              <p>{ownership.error.detail}</p>
            </div>
          )}
        {feedback && (
          <div className="wallet-connection-notice" role="alert">
            <strong>{feedback.title}</strong>
            {feedback.detail && <p>{feedback.detail}</p>}
          </div>
        )}

        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {getHeadline(mode, recipientLabel)}
          </p>
          <p className="text-sm text-muted-foreground">{getBody(mode)}</p>
        </div>

        <Button
          ref={connectButtonRef}
          type="button"
          onClick={() => void handleConnect()}
          aria-disabled={isConnecting || isLoading || isRestoring || undefined}
          className="w-full"
          size="lg"
        >
          {isConnecting || isLoading || isRestoring ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {isRestoring && !isConnecting
                ? 'Checking your wallet…'
                : 'Connecting wallet...'}
            </>
          ) : (
            <>
              <PlugZap className="w-4 h-4 mr-2" />
              Connect wallet
            </>
          )}
        </Button>

        {showHelp && <WalletSetupHelp receiving={mode === 'receive'} />}
      </div>

      <InstallWalletDialog
        returnFocusRef={connectButtonRef}
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
      />
    </>
  )
}
