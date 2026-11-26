'use client'

import { useEffect, useRef } from 'react'
import { useQuery } from 'convex/react'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import { wallet } from '@/lib/stellar/v2/wallet-kit'
import {
  useWalletOwnership,
  walletProofInFlight,
} from '@/hooks/useWalletOwnership'

/**
 * Re-verifies a receiving address linked before proof was required. When the
 * signed-in writer connects the wallet that holds their unverified address,
 * it asks that wallet to sign the proof once. Renders nothing.
 */
export function WalletReverify() {
  const link = useQuery(api.walletLink.getMyWalletLink)
  const ownership = useWalletOwnership()
  const asked = useRef(new Set<string>())
  const linkRef = useRef(link)
  const verifyRef = useRef(ownership.verify)
  useEffect(() => {
    linkRef.current = link
    verifyRef.current = ownership.verify
  }, [link, ownership.verify])

  useEffect(
    () =>
      wallet.subscribe((event) => {
        if (event.type !== 'connected') return
        const current = linkRef.current
        const address = event.connection.address
        if (
          !current ||
          current.state !== 'unverified' ||
          current.address !== address ||
          asked.current.has(address)
        ) {
          return
        }
        asked.current.add(address)
        // A verify button that started this connect runs its own proof right
        // after it; wait a turn and leave that one alone.
        setTimeout(() => {
          if (walletProofInFlight()) return
          toast.info('Verify your receiving address', {
            description:
              'Approve the request in your wallet to keep receiving tips. Signing does not move funds.',
          })
          void verifyRef.current().then((result) => {
            if (result) toast.success('Receiving address verified')
          })
        }, 0)
      }),
    []
  )

  return null
}
