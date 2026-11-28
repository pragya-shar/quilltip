'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import { useWallet } from '@/components/providers/WalletProvider'
import { ContextualWalletSetup } from '@/components/stellar/ContextualWalletSetup'
import { networkLabelLowercase } from '@/lib/copy/network-status'
import { ReceivingWalletVerification } from '@/components/stellar/ReceivingWalletVerification'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import type { WalletSettingsProps } from '@/components/stellar/WalletSettingsShared'

export function OwnerWalletSettings({
  walletAddress,
  onAddressChange,
  className = '',
}: WalletSettingsProps) {
  const updateProfile = useMutation(api.users.updateProfile)
  const { isConnected, isRestoring, lastUsed, publicKey, network, disconnect } =
    useWallet({
      activateOnMount: true,
    })
  // The wallet can be on another account than the saved one. Tips, tab
  // payments and NFT actions are signed by the saved (verified) address and
  // refuse another account before the wallet is asked, so say so here first.
  const otherAccount =
    isConnected && publicKey && walletAddress && publicKey !== walletAddress
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const mounted = useRef(true)
  const lastUsedId = useId()
  const removeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const busy = removing
  const appNetwork = networkLabelLowercase()
  const explorerNetwork =
    appNetwork === 'mainnet'
      ? 'public'
      : appNetwork === 'testnet'
        ? 'testnet'
        : null

  async function removeAddress() {
    if (busy) return
    setRemoving(true)
    setError(null)
    setFeedback(null)
    try {
      await updateProfile({ stellarAddress: null })
      if (!mounted.current) return
      onAddressChange?.(null)
      setConfirmRemove(false)
      setFeedback(
        'Receiving address removed. Your wallet connection is unchanged.'
      )
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Couldn’t remove the address. Please try again.'
        )
    } finally {
      if (mounted.current) setRemoving(false)
    }
  }
  async function copyAddress() {
    if (!walletAddress) return
    try {
      await navigator.clipboard.writeText(walletAddress)
      if (mounted.current) {
        setFeedback('Receiving address copied.')
        setError(null)
      }
    } catch {
      if (mounted.current)
        setError('Couldn’t copy the address. You can select and copy it below.')
    }
  }
  return (
    <section
      className={`account-wallet-settings ${className}`}
      aria-labelledby="wallet-connection-title"
    >
      <div className="account-connection">
        <div className="account-connection-summary">
          <div className="account-connection-heading">
            <h2 id="wallet-connection-title">Your wallet</h2>
            <span className="account-badge">
              {isRestoring
                ? 'Checking…'
                : isConnected
                  ? 'Connected'
                  : 'Not connected'}
            </span>
          </div>
          <p>
            {walletAddress
              ? isConnected || isRestoring
                ? 'Your receiving address is saved.'
                : 'Your receiving address is saved. You can receive tips while disconnected.'
              : 'Connect to send tips. Save a receiving address to receive them.'}
          </p>
          <span className="account-network">
            Stellar {appNetwork}
            {appNetwork === 'testnet' ? ' · Test funds only' : ''}
          </span>
          {isConnected && publicKey && (
            <p className="account-key">
              <span>
                Connected wallet{network ? ` (${network.toLowerCase()})` : ''}
              </span>
              <span>{publicKey}</span>
            </p>
          )}
          {lastUsed && !isConnected && (
            <p id={lastUsedId} className="account-key">
              <span>Last used: {lastUsed.walletName}</span>
              <span>{lastUsed.address}</span>
            </p>
          )}
          {otherAccount && (
            <p className="account-key-mismatch">
              This is not your saved address. Tips, tab payments and NFT actions
              are signed by{' '}
              <span className="account-key-short">
                {walletAddress.slice(0, 4)}…{walletAddress.slice(-4)}
              </span>
              , so switch your wallet to that account first.
            </p>
          )}
        </div>
        <div className="account-connection-actions">
          {isConnected ? (
            <button
              className="account-text-link"
              disabled={busy}
              onClick={() => {
                disconnect()
                setError(null)
                setFeedback(
                  'Wallet disconnected. Your saved receiving address is unchanged.'
                )
              }}
            >
              Disconnect wallet
            </button>
          ) : (
            <ContextualWalletSetup
              mode="send"
              className="account-connect"
              showHelp={false}
              describedBy={lastUsed ? lastUsedId : undefined}
            />
          )}
        </div>
      </div>
      <details className="account-address-editor">
        <summary>
          {walletAddress
            ? 'Manage receiving address'
            : 'Add a receiving address'}
        </summary>
        <div className="account-address-content">
          <p className="account-muted">
            This is where tips to your writing are sent. Connecting a wallet
            does not change it until you verify the connected wallet.
          </p>
          <ReceivingWalletVerification
            onVerified={(address) => onAddressChange?.(address)}
          />
          {walletAddress && (
            <div className="account-address-actions">
              <button
                className="account-text-link"
                onClick={() => void copyAddress()}
              >
                Copy saved address
              </button>
              {explorerNetwork && (
                <a
                  className="account-text-link"
                  href={`https://stellar.expert/explorer/${explorerNetwork}/account/${encodeURIComponent(walletAddress)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Explorer
                </a>
              )}
              <button
                ref={removeButton}
                className="account-text-link"
                disabled={busy}
                onClick={() => {
                  setError(null)
                  setConfirmRemove(true)
                }}
              >
                Remove receiving address
              </button>
            </div>
          )}
        </div>
      </details>
      <WalletSetupHelp receiving />
      {error && !confirmRemove && (
        <p className="account-notice" role="alert">
          {error}
        </p>
      )}
      {feedback && (
        <p className="account-feedback" role="status">
          {feedback}
        </p>
      )}
      <Dialog
        open={confirmRemove}
        onOpenChange={(open) => {
          if (!removing) {
            setConfirmRemove(open)
            setError(null)
          }
        }}
      >
        <DialogContent
          className="account-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            removeButton.current?.focus()
          }}
          onEscapeKeyDown={(event) => {
            if (removing) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (removing) event.preventDefault()
          }}
        >
          <DialogTitle>Remove receiving address?</DialogTitle>
          <DialogDescription className="account-muted">
            Your writing won’t receive new tips until you save another address.
            This does not disconnect your wallet or change past tips.
          </DialogDescription>
          {error && (
            <p role="alert" className="account-notice">
              {error}
            </p>
          )}
          <div className="account-address-actions">
            <button
              className="account-primary"
              disabled={removing}
              onClick={() => void removeAddress()}
            >
              {removing ? 'Removing…' : 'Remove address'}
            </button>
            <button
              className="account-text-link"
              disabled={removing}
              onClick={() => {
                setConfirmRemove(false)
                setError(null)
              }}
            >
              Keep address
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
