'use client'

import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ExplorerLink,
  PaymentNotice,
  ShortAddress,
} from '@/components/payments'
import type { NftPanel } from '@/lib/nft/v2-flow'
import { NFT_COPY } from '@/lib/copy/nft-v2'

const EXPLORER_CONTRACT = 'https://stellar.expert/explorer/testnet/contract/'

export function MintedView({
  panel,
  onTransfer,
  transferBusy,
  triggerRef,
}: {
  panel: Extract<NftPanel, { kind: 'minted' }>
  onTransfer: () => void
  transferBusy: boolean
  triggerRef: React.RefObject<HTMLButtonElement | null>
}) {
  const { token } = panel
  return (
    <div className="nft-v2-body">
      <dl className="nft-v2-facts">
        <div>
          <dt>{NFT_COPY.token}</dt>
          <dd>
            <span className="nft-v2-token">#{token.tokenId}</span>
          </dd>
        </div>
        <div>
          <dt>{NFT_COPY.owner}</dt>
          <dd>
            {token.ownerAddress ? (
              <span className="nft-v2-owner">
                {panel.viewerOwns ? (
                  <strong>{NFT_COPY.you}</strong>
                ) : token.ownerUsername ? (
                  <strong>@{token.ownerUsername}</strong>
                ) : (
                  <span className="nft-muted">{NFT_COPY.ownerOutside}</span>
                )}
                <ShortAddress address={token.ownerAddress} />
              </span>
            ) : (
              <span className="nft-muted">{NFT_COPY.updatingOwner}</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="nft-v2-links">
        {token.txHash ? <ExplorerLink hash={token.txHash} /> : null}
        {token.contractId ? (
          <a
            className="pay-link"
            href={`${EXPLORER_CONTRACT}${token.contractId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {NFT_COPY.viewToken}
            <span className="sr-only"> (opens in a new tab)</span>
            <ArrowUpRight aria-hidden="true" />
          </a>
        ) : null}
      </p>
      {panel.transfer === 'allowed' && !transferBusy ? (
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          className="nft-button nft-button-secondary nft-v2-transfer"
          onClick={onTransfer}
        >
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
          {NFT_COPY.transferAction}
        </Button>
      ) : null}
      {panel.transfer === 'paused' ? (
        <PaymentNotice kind="paused" audience="writer" />
      ) : null}
    </div>
  )
}
