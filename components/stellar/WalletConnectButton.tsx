'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWallet } from '@/components/providers/WalletProvider'
import { Wallet, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  } = useWallet()
  const [isConnecting, setIsConnecting] = useState(false)

  const handleConnect = async () => {
    if (isConnected) {
      disconnect()
      return
    }

    setIsConnecting(true)
    try {
      await connect()
    } catch (error) {
      console.error('Failed to connect wallet:', error)
    } finally {
      setIsConnecting(false)
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`
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

  // Wallet selection will happen via modal, no need for install check
  // The modal will show available wallets

  // Show error state
  if (error) {
    return (
      <Button
        onClick={handleConnect}
        size={size}
        variant="outline"
        className={cn('text-red-600 border-red-300', className)}
      >
        <AlertCircle className="w-4 h-4 mr-2" />
        Wallet Error
      </Button>
    )
  }

  // Show connected state
  if (isConnected && publicKey) {
    return (
      <Button
        onClick={handleConnect}
        size={size}
        variant="outline"
        className={cn('gap-2', className)}
      >
        <CheckCircle className="w-4 h-4 text-green-600" />
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
      </Button>
    )
  }

  // Show connect button
  return (
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
  )
}
