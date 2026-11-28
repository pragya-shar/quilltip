'use client'
import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import { useState } from 'react'
import { useWallet } from '@/components/providers/WalletProvider'
import { describeConnectFailure } from '@/lib/stellar/v2/wallet-errors'
import { useWalletOwnership } from '@/hooks/useWalletOwnership'

const STEP_COPY = {
  challenge: 'Preparing the request…',
  sign: 'Approve the request in your wallet…',
  verify: 'Checking the signature…',
} as const
export function WritingWallet({
  onSaved,
}: {
  onSaved: (address: string) => void
}) {
  const { connect, isLoading } = useWallet({ activateOnMount: true })
  const ownership = useWalletOwnership()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function connectReceivingWallet() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (!(await connect())) return
      // Linking needs proof that this wallet holds the address.
      const result = await ownership.verify()
      if (result) onSaved(result.address)
    } catch (e) {
      const failure = describeConnectFailure(e)
      if (failure.action === 'ignore') return
      setError(
        failure.action === 'install'
          ? 'No Stellar wallet found. Install Varial (formerly Freighter) or xBull in this browser, then try again.'
          : `${failure.message.title}. ${failure.message.detail}`
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="drawer-note">
      <strong>Set up your receiving wallet</strong>
      <p>
        Connect the Stellar testnet wallet that should receive tips, then
        approve a short message in it to prove it is yours. Signing does not
        move funds.
      </p>
      {error && <p role="alert">{error}</p>}
      {ownership.status === 'error' && ownership.error && (
        <p role="alert">
          {ownership.error.title}. {ownership.error.detail}
        </p>
      )}
      <p role="status" aria-live="polite" className="drawer-status">
        {ownership.status in STEP_COPY
          ? STEP_COPY[ownership.status as keyof typeof STEP_COPY]
          : ''}
      </p>
      <button
        type="button"
        className="wide"
        disabled={busy || isLoading}
        onClick={() => void connectReceivingWallet()}
      >
        {busy || isLoading ? 'Verifying wallet…' : 'Connect and verify wallet'}
      </button>
      <WalletSetupHelp receiving />
    </section>
  )
}
