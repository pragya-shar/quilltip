'use client'

import Link from 'next/link'
import type { WalletSettingsProps } from '@/components/stellar/WalletSettingsShared'
import { OwnerWalletSettings } from '@/components/stellar/OwnerWalletSettings'

export function WalletSettings(props: WalletSettingsProps) {
  if (!props.isOwnProfile)
    return (
      <div className={props.className}>
        <h2>Stellar Wallet</h2>
        <p>
          {props.walletAddress
            ? 'This writer has a receiving wallet.'
            : `${props.profileDisplayName || 'This author'} hasn't connected a wallet yet, so in-app tipping isn't available.`}
        </p>
        {props.profileUsername && (
          <Link
            href={`/${encodeURIComponent(props.profileUsername)}?tab=articles`}
          >
            Browse articles
          </Link>
        )}
        <Link href="/wallet/practice#wallet-help">Learn how tipping works</Link>
      </div>
    )
  return <OwnerWalletSettings {...props} />
}
