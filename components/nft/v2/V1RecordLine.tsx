'use client'

import { NFT_COPY } from '@/lib/copy/nft-v2'

export function V1RecordLine({ label }: { label: string }) {
  return (
    <p className="nft-v2-v1">
      <span className="nft-v2-tag">{label}</span>
      <span className="nft-muted">{NFT_COPY.v1Detail}</span>
    </p>
  )
}
