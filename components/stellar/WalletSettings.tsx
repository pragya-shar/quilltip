'use client'

import { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import Link from 'next/link'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { FlowFeedback } from '@/lib/feedback/flow-feedback'
import {
  Wallet,
  Copy,
  Check,
  AlertCircle,
  DollarSign,
  ArrowUpRight,
  Loader2,
  PlugZap,
  Power,
} from 'lucide-react'
import { WalletTooltip } from '@/components/guide/WalletTooltip'
import { toast } from 'sonner'
import { useWallet } from '@/components/providers/WalletProvider'
import { InstallWalletDialog } from '@/components/stellar/InstallWalletDialog'
import { LegalLinks } from '@/components/legal/LegalLinks'
import {
  NO_WALLET_AVAILABLE_ERROR_CODE,
  ALBEDO_INSECURE_LOCALHOST_ERROR_CODE,
} from '@/lib/stellar/wallet-adapter'

interface WalletSettingsProps {
  walletAddress?: string | null
  onAddressChange?: (address: string) => void
  isOwnProfile: boolean
  className?: string
}

export function WalletSettings({
  walletAddress,
  onAddressChange,
  isOwnProfile,
  className = '',
}: WalletSettingsProps) {
  const updateProfile = useMutation(api.users.updateProfile)
  const { isLoading, connect, disconnect } = useWallet({
    activateOnMount: true,
  })
  const [isCopied, setIsCopied] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [walletFeedback, setWalletFeedback] = useState<FlowFeedback | null>(
    null
  )

  const handleCopy = async () => {
    if (!walletAddress) return

    try {
      await navigator.clipboard.writeText(walletAddress)
      setIsCopied(true)
      setWalletFeedback(null)
      toast.success('Wallet address copied to clipboard')
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      setWalletFeedback({
        variant: 'destructive',
        title: 'Failed to copy address',
        detail: 'Copy the address manually or try again.',
      })
      toast.error('Failed to copy address')
    }
  }

  const handleConnectWallet = async () => {
    setIsConnecting(true)
    setWalletFeedback(null)
    try {
      const success = await connect()
      if (success) {
        // Get publicKey from wallet adapter after successful connection
        const { walletAdapter } = await import('@/lib/stellar/wallet-adapter')
        const connectedKey = await walletAdapter.getPublicKey()

        if (connectedKey) {
          await updateProfile({
            stellarAddress: connectedKey,
          })
          onAddressChange?.(connectedKey)
          setWalletFeedback(null)
          toast.success('Wallet connected and saved successfully!')
        }
      } else {
        setWalletFeedback({
          variant: 'destructive',
          title: 'Failed to connect wallet',
          detail: 'Try again or choose a different wallet extension.',
        })
        toast.error('Failed to connect wallet')
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to connect and save wallet address'

      if (message.startsWith(`${NO_WALLET_AVAILABLE_ERROR_CODE}:`)) {
        setInstallDialogOpen(true)
        return
      }

      if (message.startsWith(`${ALBEDO_INSECURE_LOCALHOST_ERROR_CODE}:`)) {
        return
      }

      setWalletFeedback({
        variant: 'destructive',
        title: 'Failed to connect wallet',
        detail: message,
      })
      toast.error(message)
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnectWallet = async () => {
    // Prevent double-click
    if (isConnecting) return

    setIsConnecting(true)
    setWalletFeedback(null)

    try {
      // Step 1: Update database FIRST (ensures source of truth is updated)
      await updateProfile({
        stellarAddress: null,
      })

      // Step 2: Clear local wallet state AFTER DB confirms
      disconnect()

      // Step 3: Notify parent component for immediate UI update
      onAddressChange?.('')
      setWalletFeedback(null)

      toast.success('Wallet disconnected successfully')
    } catch (error) {
      console.error('[WalletSettings] Failed to disconnect wallet:', error)

      // Provide specific error messages
      if (error instanceof Error) {
        if (error.message.includes('Not authenticated')) {
          setWalletFeedback({
            variant: 'destructive',
            title: 'Session expired',
            detail: 'Please refresh and try again.',
          })
          toast.error('Session expired. Please refresh and try again.')
        } else if (
          error.message.includes('network') ||
          error.message.includes('fetch')
        ) {
          setWalletFeedback({
            variant: 'destructive',
            title: 'Network error',
            detail: 'Check your connection and try again.',
          })
          toast.error('Network error. Check your connection and try again.')
        } else {
          setWalletFeedback({
            variant: 'destructive',
            title: 'Disconnect failed',
            detail: error.message,
          })
          toast.error(`Disconnect failed: ${error.message}`)
        }
      } else {
        setWalletFeedback({
          variant: 'destructive',
          title: 'Failed to disconnect wallet',
          detail: 'Please try again.',
        })
        toast.error('Failed to disconnect wallet. Please try again.')
      }

      // Don't clear local state if DB update failed
      // This keeps UI in sync with actual DB state
    } finally {
      setIsConnecting(false)
    }
  }

  if (!isOwnProfile && !walletAddress) {
    return (
      <Alert className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          This user hasn&apos;t set up their Stellar wallet yet.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <>
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Stellar Wallet
            <WalletTooltip concept="stellar" />
            <WalletTooltip concept="testnet" />
          </CardTitle>
          <CardDescription>
            {isOwnProfile
              ? 'Manage your Stellar testnet wallet for sending and receiving practice tips'
              : 'Send testnet tips directly to this user&apos;s Stellar wallet'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {walletFeedback && (
            <Alert
              variant={
                walletFeedback.variant === 'destructive'
                  ? 'destructive'
                  : 'default'
              }
            >
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{walletFeedback.title}</AlertTitle>
              {walletFeedback.detail ? (
                <AlertDescription>{walletFeedback.detail}</AlertDescription>
              ) : null}
            </Alert>
          )}
          {isOwnProfile && (
            <Alert className="border-info/50 bg-info">
              <AlertCircle className="h-4 w-4 text-info-foreground" />
              <AlertDescription className="text-info-foreground">
                <strong>This wallet is for receiving tips.</strong> When readers
                tip your articles, payments come here. To send tips to other
                authors, you&apos;ll connect your wallet extension directly on
                their articles.
              </AlertDescription>
            </Alert>
          )}

          {isOwnProfile ? (
            <>
              {!walletAddress ? (
                <div className="space-y-4">
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Connect your Stellar testnet wallet to send and receive
                      practice tips
                    </AlertDescription>
                  </Alert>

                  <Button
                    onClick={handleConnectWallet}
                    disabled={isConnecting || isLoading}
                    className="w-full"
                    size="lg"
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Connecting Wallet...
                      </>
                    ) : (
                      <>
                        <PlugZap className="w-4 h-4 mr-2" />
                        Connect Stellar Wallet
                      </>
                    )}
                  </Button>

                  <div className="text-center text-sm text-muted-foreground">
                    Need a wallet?{' '}
                    <Link
                      href="/guide"
                      className="text-info-foreground hover:underline"
                    >
                      Follow our setup guide
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Connected State */}
                  <div className="p-4 bg-success border border-success/50 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-sm font-medium text-success-foreground">
                          Wallet Connected
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Your Wallet Address
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          value={walletAddress || ''}
                          readOnly
                          className="font-mono text-xs"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={handleCopy}
                        >
                          {isCopied ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <Alert>
                    <DollarSign className="h-4 w-4" />
                    <AlertDescription>
                      You can send and receive tips with this wallet. You can
                      change it anytime by disconnecting and connecting a
                      different account.
                    </AlertDescription>
                  </Alert>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() =>
                        walletAddress &&
                        window.open(
                          `https://stellar.expert/explorer/testnet/account/${walletAddress}`,
                          '_blank'
                        )
                      }
                      disabled={!walletAddress}
                    >
                      <ArrowUpRight className="h-4 w-4 mr-2" />
                      View on Explorer
                    </Button>
                    <Button
                      onClick={handleDisconnectWallet}
                      disabled={isConnecting}
                      variant="outline"
                      className="flex-1"
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Disconnecting...
                        </>
                      ) : (
                        <>
                          <Power className="w-4 h-4 mr-2" />
                          Disconnect
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>User&apos;s Wallet Address</Label>
                <div className="flex gap-2">
                  <Input
                    value={walletAddress || ''}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button variant="outline" size="icon" onClick={handleCopy}>
                    {isCopied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() =>
                  walletAddress &&
                  window.open(
                    `https://stellar.expert/explorer/testnet/account/${walletAddress}`,
                    '_blank'
                  )
                }
                disabled={!walletAddress}
              >
                <ArrowUpRight className="h-4 w-4 mr-2" />
                View on Stellar Explorer
              </Button>

              <Alert>
                <DollarSign className="h-4 w-4" />
                <AlertDescription>
                  Tips sent to this wallet go directly to the user with minimal
                  platform fees.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {isOwnProfile && (
            <div className="pt-4 mt-2 border-t border-border">
              <LegalLinks linkClassName="text-muted-foreground hover:text-foreground text-xs" />
            </div>
          )}
        </CardContent>
      </Card>

      <InstallWalletDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
      />
    </>
  )
}
