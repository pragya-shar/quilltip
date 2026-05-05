'use client'

import { useState } from 'react'
import { useWallet } from '@/components/providers/WalletProvider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InstallWalletDialog } from '@/components/stellar/InstallWalletDialog'
import {
  Copy,
  ExternalLink,
  Wallet,
  RefreshCw,
  Loader2,
  Power,
} from 'lucide-react'
import { toast } from 'sonner'
import { NO_WALLET_AVAILABLE_ERROR_CODE } from '@/lib/stellar/wallet-adapter'

interface WalletStatusProps {
  className?: string
}

export function WalletStatus({ className }: WalletStatusProps) {
  const {
    isConnected,
    isLoading,
    publicKey,
    network,
    networkPassphrase,
    selectedWallet,
    error,
    connect,
    disconnect,
    refreshConnection,
  } = useWallet()
  const [isConnecting, setIsConnecting] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)

  const handleConnect = async () => {
    setIsConnecting(true)
    try {
      await connect()
      toast.success('Wallet connected successfully!')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to connect wallet'

      if (message.startsWith(`${NO_WALLET_AVAILABLE_ERROR_CODE}:`)) {
        setInstallDialogOpen(true)
        return
      }

      toast.error(
        message
      )
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = () => {
    disconnect()
    toast.success('Wallet disconnected')
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied to clipboard!')
    } catch {
      toast.error('Failed to copy')
    }
  }

  const openInExplorer = (address: string) => {
    const explorerUrl =
      network === 'TESTNET'
        ? `https://stellar.expert/explorer/testnet/account/${address}`
        : `https://stellar.expert/explorer/public/account/${address}`
    window.open(explorerUrl, '_blank')
  }

  // Wallet selection will happen via modal

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <Wallet className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h3 className="font-semibold text-red-900">
                Wallet Connection Error
              </h3>
              <p className="text-sm text-red-600">{error}</p>
            </div>
            <Button variant="outline" onClick={refreshConnection}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!isConnected) {
    return (
      <>
        <Card className={className}>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center space-y-4 text-center">
              <Wallet className="w-12 h-12 text-muted-foreground" />
              <div>
                <h3 className="font-semibold">Wallet Not Connected</h3>
                <p className="text-sm text-muted-foreground">
                  Connect your Stellar wallet to start tipping authors
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Supports Freighter, xBull, Albedo, Rabet, and more
                </p>
              </div>
              <Button
                onClick={handleConnect}
                disabled={isConnecting || isLoading}
                className="w-full max-w-xs"
              >
                {isConnecting || isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Wallet className="w-4 h-4 mr-2" />
                    Connect Wallet
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <InstallWalletDialog
          open={installDialogOpen}
          onOpenChange={setInstallDialogOpen}
        />
      </>
    )
  }

  return (
    <>
      <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <div className="w-8 h-8 bg-green-100 dark:bg-green-950/50 rounded-full flex items-center justify-center">
            <Wallet className="w-4 h-4 text-green-800 dark:text-green-300" />
          </div>
          <div className="flex flex-col">
            <span>Wallet Connected</span>
            {selectedWallet && (
              <span className="text-sm font-normal text-muted-foreground">
                via {selectedWallet.name}
              </span>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div>
            <span className="text-sm font-medium text-muted-foreground">
              Address
            </span>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 text-sm bg-muted px-2 py-1 rounded truncate">
                {publicKey}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => publicKey && copyToClipboard(publicKey)}
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => publicKey && openInExplorer(publicKey)}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {network && (
            <div>
              <span className="text-sm font-medium text-muted-foreground">
                Network
              </span>
              <div className="mt-1">
                <Badge
                  variant={network === 'TESTNET' ? 'secondary' : 'default'}
                  className="capitalize"
                >
                  {network.toLowerCase()}
                </Badge>
              </div>
            </div>
          )}

          {networkPassphrase && (
            <div>
              <span className="text-sm font-medium text-muted-foreground">
                Network Passphrase
              </span>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 text-xs bg-muted px-2 py-1 rounded truncate">
                  {networkPassphrase}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(networkPassphrase)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshConnection}
            className="flex-1"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Connection
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            className="flex-1"
          >
            <Power className="w-4 h-4 mr-2" />
            Disconnect
          </Button>
        </div>
      </CardContent>
      </Card>

      <InstallWalletDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
      />
    </>
  )
}
