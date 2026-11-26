'use client'

import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PaymentNotice, WalletGate } from '@/components/payments'
import type { MintArea } from '@/lib/nft/v2-flow'
import { ELIGIBILITY_COPY, NFT_COPY, NFT_WALLET_PAGE } from '@/lib/copy/nft-v2'

export function MintAreaView({
  mint,
  onMint,
  onCheckAgain,
}: {
  mint: MintArea
  onMint: () => void
  onCheckAgain: () => void
}) {
  switch (mint.kind) {
    case 'none':
    case 'below':
    case 'pending':
      return null
    case 'checking':
      return (
        <p className="pay-inline-status nft-v2-checking" role="status">
          Checking the mint threshold…
        </p>
      )
    case 'eligible':
      return (
        <div className="nft-v2-action">
          <Button
            type="button"
            className="nft-button nft-v2-primary"
            onClick={onMint}
          >
            {NFT_COPY.mintAction}
          </Button>
          <p className="nft-v2-note">{NFT_COPY.mintHint}</p>
        </div>
      )
    case 'retry-later':
      return (
        <div className="nft-v2-action">
          <p className="nft-muted">
            {mint.retryAfterMs ? NFT_COPY.rateLimited : NFT_COPY.unavailable}
          </p>
          <Button
            type="button"
            variant="outline"
            className="nft-button nft-button-secondary"
            onClick={onCheckAgain}
          >
            <RotateCw aria-hidden="true" className="h-4 w-4" />
            {NFT_COPY.checkAgain}
          </Button>
        </div>
      )
    case 'message': {
      if (mint.state === 'PAUSED') {
        return <PaymentNotice kind="paused" audience="writer" />
      }
      const copy = ELIGIBILITY_COPY[mint.state]
      if (!copy) return null
      if (mint.state === 'WALLET_NOT_VERIFIED') {
        return (
          <WalletGate
            state={{ kind: 'unverified' }}
            verifyHref={NFT_WALLET_PAGE}
          >
            {null}
          </WalletGate>
        )
      }
      return (
        <div className="nft-v2-action">
          <PaymentNotice kind="refused" copy={copy} />
          <a className="pay-link" href={NFT_WALLET_PAGE}>
            Open your wallet page
          </a>
        </div>
      )
    }
  }
}
