'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useWallet } from '@/components/providers/WalletProvider'
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
      if (!(await connect())) throw new Error('Choose a wallet and try again.')
      const { walletAdapter } = await import('@/lib/stellar/wallet-adapter')
      const address = await walletAdapter.getPublicKey()
      if (!address)
        throw new Error('Your wallet did not return an address. Try again.')
      await updateProfile({ stellarAddress: address })
      onSaved(address)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not connect your wallet.'
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
      <Link href="/guide">Wallet guide ↗</Link>
    </section>
  )
}
