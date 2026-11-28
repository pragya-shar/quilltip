'use client'

import { useId } from 'react'
import { TestnetLabel } from '@/components/payments'
import { NFT_COPY } from '@/lib/copy/nft-v2'

/**
 * The NFT section when this deployment cannot mint or show a v2 NFT: payments
 * v2 is off, or no Article NFT contract is set. It keeps the section's
 * heading so the article details never show an empty space.
 */
export function NftUnavailableView({ embedded }: { embedded: boolean }) {
  const headingId = useId()
  return (
    <section
      className={`nft-panel nft-v2 ${embedded ? '' : 'nft-panel-standalone'}`}
      aria-labelledby={headingId}
    >
      <header className="nft-v2-header">
        <h5 id={headingId} className="nft-panel-title">
          {NFT_COPY.sectionTitle}
        </h5>
        <TestnetLabel />
      </header>
      <p className="nft-muted">{NFT_COPY.offline}</p>
    </section>
  )
}
