'use client'

import { XlmAmount } from '@/components/payments'
import type { ProgressFigures } from '@/lib/nft/v2-flow'
import { NFT_COPY } from '@/lib/copy/nft-v2'

export function Figures({ figures }: { figures: ProgressFigures }) {
  const percent = Number(
    (BigInt(figures.total) * BigInt(1000)) / BigInt(figures.threshold)
  )
  const shown = Math.min(percent, 1000) / 10
  return (
    <div className="nft-v2-figures">
      <p className="nft-v2-figures-line">
        <XlmAmount amount={figures.total} />
        <span className="nft-muted"> of </span>
        <XlmAmount amount={figures.threshold} />
        <span className="nft-muted"> tipped</span>
      </p>
      <div
        className="nft-progress"
        role="progressbar"
        aria-label={NFT_COPY.progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(shown)}
        aria-valuetext={`${shown.toFixed(0)}% of the mint threshold`}
      >
        <div className="nft-progress-fill" style={{ width: `${shown}%` }} />
      </div>
      <p className="nft-v2-note">{NFT_COPY.directTipsOnly}</p>
    </div>
  )
}
