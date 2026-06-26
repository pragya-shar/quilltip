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
import { ActionableNotice } from '@/components/ui/ActionableNotice'
import type { FlowFeedback } from '@/lib/feedback/flow-feedback'
import {
  Wallet,
  Copy,
  Check,
  AlertCircle,
  ArrowUpRight,
  Loader2,
  Power,
} from 'lucide-react'
import { WalletTooltip } from '@/components/guide/WalletTooltip'
import { toast } from 'sonner'
import { useWallet } from '@/components/providers/WalletProvider'
import { ContextualWalletSetup } from '@/components/stellar/ContextualWalletSetup'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { networkLabelLowercase } from '@/lib/copy/network-status'

interface WalletSettingsProps {
  walletAddress?: string | null
  profileUsername?: string
  onAddressChange?: (address: string) => void
  isOwnProfile: boolean
  profileDisplayName?: string
  className?: string
}

export function WalletSettings({
  walletAddress,
  profileUsername,
  onAddressChange,
  isOwnProfile,
  profileDisplayName,
  className = '',
}: WalletSettingsProps) {
  const updateProfile = useMutation(api.users.updateProfile)
  const { disconnect } = useWallet({
    activateOnMount: true,
  })
  const [isCopied, setIsCopied] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
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

  const handleDisconnectWallet = async () => {
    if (isDisconnecting) return

    setIsDisconnecting(true)
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
      setIsDisconnecting(false)
    }
  }

  if (!isOwnProfile && !walletAddress) {
    return (
      <Card variant="quiet" className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Stellar Wallet
            <WalletTooltip concept="stellar" />
            <WalletTooltip concept="testnet" />
          </CardTitle>
          <CardDescription>
            {profileDisplayName
              ? `${profileDisplayName} hasn't connected a wallet yet, so in-app tipping isn't available.`
              : "This author hasn't connected a wallet yet, so in-app tipping isn't available."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActionableNotice intent="informational">
            You can still read their work. Once they connect a wallet, you can
            tip from any article using &quot;Tip Author&quot;.
          </ActionableNotice>

          <div className="flex flex-col gap-2 sm:flex-row">
            {profileUsername ? (
              <Button asChild className="flex-1">
                <Link href={`/${profileUsername}?tab=articles`}>
                  Browse articles
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" className="flex-1">
              <Link href="/guide">Learn how tipping works</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card variant="quiet" className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Stellar Wallet
            <WalletTooltip concept="stellar" />
            {networkLabelLowercase() === 'testnet' ? (
              <WalletTooltip concept="testnet" />
            ) : null}
          </CardTitle>
          <CardDescription>
            {isOwnProfile
              ? `Manage your Stellar ${networkLabelLowercase()} wallet for sending and receiving tips`
              : 'Copy the wallet address, or tip this author from their articles.'}
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
          {isOwnProfile && walletAddress ? (
            <ActionableNotice intent="informational">
              <strong>This wallet is for receiving tips.</strong> When readers
              tip your articles, payments come here. To send tips to other
              authors, you&apos;ll connect your wallet extension directly on
              their articles.
            </ActionableNotice>
          ) : null}

          {isOwnProfile ? (
            <>
              {!walletAddress ? (
                <ContextualWalletSetup
                  mode="receive"
                  onAddressSaved={(address) => onAddressChange?.(address)}
                />
              ) : (
                <div className="space-y-4">
                  {/* Connected State */}
                  <div className="p-4 bg-success border border-success/50 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
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

                  <ActionableNotice intent="informational">
                    You can send and receive tips with this wallet. You can
                    change it anytime by disconnecting and connecting a
                    different account.
                  </ActionableNotice>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() =>
                        walletAddress &&
                        window.open(
                          `https://stellar.expert/explorer/${
                            networkLabelLowercase() === 'testnet'
                              ? 'testnet'
                              : 'public'
                          }/account/${walletAddress}`,
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
                      disabled={isDisconnecting}
                      variant="outline"
                      className="flex-1"
                    >
                      {isDisconnecting ? (
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
                    `https://stellar.expert/explorer/${
                      networkLabelLowercase() === 'testnet'
                        ? 'testnet'
                        : 'public'
                    }/account/${walletAddress}`,
                    '_blank'
                  )
                }
                disabled={!walletAddress}
              >
                <ArrowUpRight className="h-4 w-4 mr-2" />
                View on Stellar Explorer
              </Button>

              <ActionableNotice intent="informational">
                Want to tip in-app? Open any of their articles and click
                &quot;Tip Author&quot;.
              </ActionableNotice>
            </div>
          )}

          {isOwnProfile && (
            <div className="pt-4 mt-2 border-t border-border">
              <LegalLinks linkClassName="text-muted-foreground hover:text-foreground text-xs" />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
