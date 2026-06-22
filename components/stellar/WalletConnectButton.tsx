'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWallet } from '@/components/providers/WalletProvider'
import { useWalletActivation } from '@/components/providers/WalletActivationContext'
import {
  Wallet,
  Loader2,
  AlertCircle,
  CheckCircle,
  Copy,
  ExternalLink,
  Power,
  ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { InstallWalletDialog } from '@/components/stellar/InstallWalletDialog'
import {
  NO_WALLET_AVAILABLE_ERROR_CODE,
  ALBEDO_INSECURE_LOCALHOST_ERROR_CODE,
} from '@/lib/stellar/wallet-adapter'

interface WalletConnectButtonProps {
  className?: string
  size?: 'sm' | 'default' | 'lg'
  variant?: 'default' | 'outline' | 'secondary' | 'ghost'
}

export function WalletConnectButton({
  className,
  size = 'default',
  variant = 'default',
}: WalletConnectButtonProps) {
  const {
    isConnected,
    isLoading,
    publicKey,
    network,
    error,
    selectedWallet,
    connect,
    disconnect,
  } = useWallet({ activateOnMount: true })
  const { activateWallet } = useWalletActivation()
  const [isConnecting, setIsConnecting] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)

  const handleConnect = async () => {
    activateWallet()
    setIsConnecting(true)
    try {
      await connect()
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

      toast.error(message)
    } finally {
      setIsConnecting(false)
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Wallet address copied to clipboard')
    } catch {
      toast.error('Failed to copy address')
    }
  }

  const openInExplorer = (address: string) => {
    const explorerUrl =
      network === 'TESTNET'
        ? `https://stellar.expert/explorer/testnet/account/${address}`
        : `https://stellar.expert/explorer/public/account/${address}`
    window.open(explorerUrl, '_blank')
  }

  const handleDisconnect = () => {
    disconnect()
    toast.success('Wallet disconnected')
  }

  // Show loading state
  if (isLoading) {
    return (
      <Button
        disabled
        size={size}
        variant={variant}
        className={className}
        aria-busy
        aria-label="Wallet loading"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
      </Button>
    )
  }

  // Show error state
  if (error) {
    return (
      <Button
        onClick={handleConnect}
        size={size}
        variant="outline"
        className={cn(
          'text-destructive border-destructive/50',
          className
        )}
      >
        <AlertCircle className="w-4 h-4 mr-2" />
        Wallet Error
      </Button>
    )
  }

  // Show connected state
  if (isConnected && publicKey) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size={size}
            variant="outline"
            className={cn('gap-2', className)}
            aria-label="Open wallet menu"
          >
            <CheckCircle className="w-4 h-4 text-success-foreground" />
            <div className="flex flex-col items-start">
              <span className="text-sm font-medium">
                {formatAddress(publicKey)}
              </span>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {selectedWallet && <span>{selectedWallet.name}</span>}
                {network && selectedWallet && <span>•</span>}
                {network && (
                  <span className="capitalize">{network.toLowerCase()}</span>
                )}
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="font-normal">
            <span className="text-xs text-muted-foreground">Address</span>
            <p className="mt-1 font-mono text-xs break-all">{publicKey}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copyToClipboard(publicKey)}>
            <Copy className="w-4 h-4" />
            Copy address
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openInExplorer(publicKey)}>
            <ExternalLink className="w-4 h-4" />
            View on explorer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={handleDisconnect}
            className="text-destructive focus:text-destructive"
          >
            <Power className="w-4 h-4" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Show connect button
  return (
    <>
      <Button
        onClick={handleConnect}
        disabled={isConnecting}
        size={size}
        variant={variant}
        className={className}
      >
        {isConnecting ? (
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

      <InstallWalletDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
      />
    </>
  )
}
