'use client'

import { XlmAmount } from '@/components/payments'
import type { ProgressFigures } from '@/lib/nft/v2-flow'
import { NFT_COPY } from '@/lib/copy/nft-v2'

/**
 * The tipped total against the threshold, with a bar. `line` is off when
 * the threshold notice above already states the figures.
 */
export function Figures({
  figures,
  line = true,
}: {
  figures: ProgressFigures
  line?: boolean
}) {
  const percent = Number(
    (BigInt(figures.total) * BigInt(1000)) / BigInt(figures.threshold)
  )
  const shown = Math.min(percent, 1000) / 10
  return (
    <div className="nft-v2-figures">
      {line ? (
        <p className="nft-v2-figures-line">
          <XlmAmount amount={figures.total} />
          <span className="nft-muted"> of </span>
          <XlmAmount amount={figures.threshold} />
          <span className="nft-muted"> tipped</span>
        </p>
      ) : null}
      <div
        className="nft-progress"
        role="progressbar"
        aria-label={NFT_COPY.progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(shown)}
        aria-valuetext={`${shown.toFixed(0)}% of the mint threshold`}
      >
        <div
          className="nft-progress-fill nft-v2-fill"
          style={{ transform: `scaleX(${shown / 100})` }}
        />
      </div>
      <p className="nft-v2-note">{NFT_COPY.directTipsOnly}</p>
    </div>
  )
}
