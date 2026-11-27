'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PaymentNotice, TestnetLabel } from '@/components/payments'
import { groupAddress } from '@/lib/stellar/v2/nft-calls'
import type { NftFlowState } from '@/lib/nft/v2-flow'
import { NFT_COPY, TRANSFER_COPY } from '@/lib/copy/nft-v2'

export function ReviewStep({
  flow,
  tokenId,
  onConfirm,
  onBack,
}: {
  flow: Extract<NftFlowState, { kind: 'review' }>
  tokenId: number
  onConfirm: () => void
  onBack: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const prepared = flow.prepared
  const to = prepared.action === 'transfer' ? prepared.args.to : ''
  const username =
    prepared.action === 'transfer' ? prepared.recipient.username : null
  const isContract = to.startsWith('C')

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
    setConfirming(false)
  }, [prepared.submissionId])

  return (
    <div className="nft-v2-review">
      <h3 ref={headingRef} tabIndex={-1} className="nft-v2-step-title">
        {TRANSFER_COPY.reviewTitle}
      </h3>
      {flow.refreshed ? (
        <PaymentNotice
          kind="refused"
          copy={{
            title: 'Check the address again',
            detail: TRANSFER_COPY.refreshed,
          }}
          announce
        />
      ) : null}
      <dl className="nft-v2-facts">
        <div>
          <dt>{TRANSFER_COPY.reviewLead}</dt>
          <dd className="nft-v2-sending">
            <span>
              {NFT_COPY.sectionTitle} #{tokenId}
            </span>
            <TestnetLabel />
          </dd>
        </div>
        <div className="nft-v2-to">
          <dt>{TRANSFER_COPY.reviewTo}</dt>
          <dd>
            {username ? (
              <p className="nft-v2-user">
                {TRANSFER_COPY.reviewUser(username)}
              </p>
            ) : null}
            <p className="nft-v2-address" data-testid="recipient-address">
              {groupAddress(to).map((group, index) => (
                <span key={index} className="nft-v2-address-group">
                  {group}
                </span>
              ))}
            </p>
            <div className="nft-v2-address-tools">
              <button
                type="button"
                className="pay-link nft-v2-copy"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(to)
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 2_500)
                  } catch {
                    setCopied(false)
                  }
                }}
              >
                <Copy aria-hidden="true" />
                {TRANSFER_COPY.copy}
              </button>
              <span role="status" className="nft-v2-note">
                {copied ? TRANSFER_COPY.copied : ''}
              </span>
            </div>
            <p className="nft-v2-note">{TRANSFER_COPY.reviewAddressHelp}</p>
          </dd>
        </div>
      </dl>
      {isContract ? (
        <p className="nft-v2-warning">
          <TriangleAlert aria-hidden="true" />
          <span>{TRANSFER_COPY.contractWarning}</span>
        </p>
      ) : null}
      <p className="nft-v2-warning" data-testid="irreversible">
        <TriangleAlert aria-hidden="true" />
        <span>{TRANSFER_COPY.irreversible}</span>
      </p>
      <div className="nft-v2-footer">
        <Button
          type="button"
          variant="outline"
          className="nft-button nft-button-secondary"
          onClick={onBack}
        >
          {TRANSFER_COPY.back}
        </Button>
        <Button
          type="button"
          className="nft-button nft-v2-primary"
          aria-disabled={confirming ? true : undefined}
          onClick={() => {
            if (confirming) return
            setConfirming(true)
            onConfirm()
          }}
        >
          {TRANSFER_COPY.confirm}
        </Button>
      </div>
    </div>
  )
}
