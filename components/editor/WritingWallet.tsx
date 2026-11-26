'use client'
import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useWallet } from '@/components/providers/WalletProvider'
import { describeConnectFailure } from '@/lib/stellar/v2/wallet-errors'
export function WritingWallet({
  onSaved,
}: {
  onSaved: (address: string) => void
}) {
  const { connect, isLoading } = useWallet({ activateOnMount: true })
  const updateProfile = useMutation(api.users.updateProfile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function connectReceivingWallet() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (!(await connect())) return
      const { wallet } = await import('@/lib/stellar/v2/wallet-kit')
      const address = wallet.getConnection()?.address ?? null
      if (!address)
        throw new Error('Your wallet did not return an address. Try again.')
      await updateProfile({ stellarAddress: address })
      onSaved(address)
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
        Save a Stellar testnet wallet so readers can send tips when you publish.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="wide"
        disabled={busy || isLoading}
        onClick={() => void connectReceivingWallet()}
      >
        {busy || isLoading ? 'Connecting wallet…' : 'Connect wallet'}
      </button>
      <WalletSetupHelp receiving />
    </section>
  )
}
