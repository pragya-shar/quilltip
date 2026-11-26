'use client'

import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useWallet } from '@/components/providers/WalletProvider'
import {
  describeConnectFailure,
  type WalletMessage,
} from '@/lib/stellar/v2/wallet-errors'
import { useWalletOwnership } from '@/hooks/useWalletOwnership'

const STEP_COPY = {
  challenge: 'Preparing the request…',
  sign: 'Approve the request in your wallet…',
  verify: 'Checking the signature…',
} as const

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-6)}`

/**
 * The writer's receiving address and its proof of ownership. Tips go only to
 * a verified address; verifying asks the connected wallet to sign a short
 * message (or, for wallets that cannot sign messages, a transaction that is
 * never submitted).
 */
export function ReceivingWalletVerification({
  onVerified,
}: {
  onVerified?: (address: string) => void
}) {
  const link = useQuery(api.walletLink.getMyWalletLink)
  const {
    isConnected,
    isLoading: walletLoading,
    publicKey,
    connect,
  } = useWallet({
    activateOnMount: true,
  })
  const ownership = useWalletOwnership()
  const [connectError, setConnectError] = useState<WalletMessage | null>(null)
  const busy = ['challenge', 'sign', 'verify'].includes(ownership.status)

  useEffect(() => {
    if (ownership.status === 'verified' && ownership.result) {
      onVerified?.(ownership.result.address)
    }
  }, [ownership.status, ownership.result, onVerified])

  async function connectAndVerify() {
    if (busy) return
    setConnectError(null)
    if (!isConnected) {
      try {
        if (!(await connect())) return
      } catch (error) {
        const failure = describeConnectFailure(error)
        if (failure.action === 'install') {
          setConnectError({
            title: 'No Stellar wallet found',
            detail:
              'Install Varial (formerly Freighter) or xBull in this browser, then try again.',
          })
        } else if (failure.action === 'show') {
          setConnectError(failure.message)
        }
        return
      }
    }
    await ownership.verify()
  }

  if (link === undefined) {
    return (
      <p className="account-muted" role="status">
        Loading your receiving address…
      </p>
    )
  }
  if (link === null) return null

  const linked = link.address
  const verified = link.state === 'verified'
  const connectedDiffers = !!publicKey && !!linked && publicKey !== linked
  const actionLabel = !isConnected
    ? 'Connect wallet to verify'
    : linked && !connectedDiffers && !verified
      ? 'Verify with wallet'
      : `Verify ${publicKey ? short(publicKey) : 'this wallet'}`
  const showAction = !verified || connectedDiffers

  return (
    <div className="wallet-verification" aria-busy={busy}>
      <div className="wallet-verification-head">
        <span className="wallet-verification-label">Receiving address</span>
        {linked && (
          <span
            className="account-badge wallet-verification-badge"
            data-state={verified ? 'verified' : 'unverified'}
          >
            {verified ? 'Verified' : 'Not verified'}
          </span>
        )}
      </div>
      {linked ? (
        <p className="wallet-verification-address">{linked}</p>
      ) : (
        <p className="account-muted">No receiving address yet.</p>
      )}
      <p className="account-muted wallet-verification-explainer">
        {verified
          ? connectedDiffers
            ? 'Your connected wallet is a different account. Verify it to receive tips there instead.'
            : 'Tips to your writing go to this address.'
          : linked
            ? 'Verify this address to receive new tips. Tips you already received stay in your history.'
            : 'Connect the wallet that should receive tips, then approve a short message in it.'}{' '}
        {showAction &&
          'Signing proves the wallet is yours. It does not move funds.'}
      </p>
      {showAction && (
        <button
          type="button"
          className="account-primary wallet-verification-action"
          // Disabled only while the wallet runtime loads; nothing has focus
          // then. While verifying it stays focusable for the status text.
          disabled={walletLoading && !busy}
          aria-disabled={busy || undefined}
          aria-describedby="wallet-verification-status"
          onClick={() => void connectAndVerify()}
        >
          {busy
            ? 'Verifying…'
            : walletLoading
              ? 'Loading wallet…'
              : actionLabel}
        </button>
      )}
      <p
        id="wallet-verification-status"
        className="wallet-verification-status"
        role="status"
        aria-live="polite"
      >
        {busy
          ? STEP_COPY[ownership.status as keyof typeof STEP_COPY]
          : ownership.status === 'verified' && ownership.result
            ? `Verified. Tips now go to ${short(ownership.result.address)}.`
            : ''}
      </p>
      {(connectError ??
        (ownership.status === 'error' ? ownership.error : null)) && (
        <div className="account-notice" role="alert">
          <strong>{(connectError ?? ownership.error)!.title}.</strong>{' '}
          {(connectError ?? ownership.error)!.detail}
        </div>
      )}
    </div>
  )
}
