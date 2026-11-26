'use client'

import { PaymentNotice } from '@/components/payments'
import type { NftPanel } from '@/lib/nft/v2-flow'
import { NFT_COPY } from '@/lib/copy/nft-v2'
import { MintAreaView } from './MintAreaView'
import { Figures } from './Figures'

export function ProgressView({
  panel,
  busy,
  onMint,
  onCheckAgain,
}: {
  panel: Extract<NftPanel, { kind: 'progress' }>
  busy: boolean
  onMint: () => void
  onCheckAgain: () => void
}) {
  const { progress, mint } = panel
  return (
    <div className="nft-v2-body">
      {/* Below the threshold the kit's notice states the figures (spec 5.10). */}
      {progress && !progress.reached ? (
        <PaymentNotice
          kind="nft-threshold"
          tipped={progress.total}
          threshold={progress.threshold}
        />
      ) : null}
      {progress ? <Figures figures={progress} line={progress.reached} /> : null}
      {progress?.reached && mint.kind === 'none' ? (
        <p className="nft-muted">{NFT_COPY.reachedReader}</p>
      ) : null}
      {!busy ? (
        <MintAreaView mint={mint} onMint={onMint} onCheckAgain={onCheckAgain} />
      ) : null}
    </div>
  )
}
