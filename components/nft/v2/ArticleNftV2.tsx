'use client'

import { useId, useRef, useState } from 'react'
import { TestnetLabel } from '@/components/payments'
import type { Id } from '@/types/convex'
import { useArticleNftV2 } from '@/hooks/useArticleNftV2'
import { NFT_COPY } from '@/lib/copy/nft-v2'
import { FlowView } from './NftFlowView'
import { TransferDialogV2 } from './TransferDialogV2'
import { MintedView } from './MintedView'
import { ProgressView } from './ProgressView'
import { V1RecordLine } from './V1RecordLine'
import '../nft.css'
import './nft-v2.css'

export interface ArticleNftV2Props {
  articleId: Id<'articles'>
  authorId: Id<'users'>
  currentUserId?: Id<'users'>
  embedded?: boolean
  /** The v1 panel, for a deployment whose NFT contract is not configured. */
  renderV1?: () => React.ReactNode
}

/**
 * The v2 article NFT: progress toward the mint threshold, the author's mint
 * action, the minted token with its owner, and the owner's transfer.
 * Loaded with `import()` when the article details open; nothing here is in
 * the article page's first load.
 */
export default function ArticleNftV2({
  articleId,
  authorId,
  currentUserId,
  embedded = false,
  renderV1,
}: ArticleNftV2Props) {
  const nft = useArticleNftV2({ articleId, authorId, currentUserId })
  const headingId = useId()
  const [transferOpen, setTransferOpen] = useState(false)
  const transferTrigger = useRef<HTMLButtonElement>(null)
  const { panel, flow, status } = nft

  if (panel.kind === 'loading') {
    return (
      <p className="nft-v2-loading" role="status">
        Loading the NFT status…
      </p>
    )
  }
  if (panel.kind === 'v1') return renderV1 ? <>{renderV1()}</> : null
  // An unpublished or missing article shows no NFT.
  if (panel.kind === 'hidden') return null

  const flowAction =
    flow.kind === 'idle'
      ? null
      : flow.kind === 'review'
        ? flow.prepared.action
        : flow.action
  // A transfer runs in its dialog; once the dialog closes, its progress
  // stays visible here until the record is final.
  const showFlowHere =
    flowAction === 'mint' || (flowAction === 'transfer' && !transferOpen)

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

      {panel.kind !== 'not-registered' && panel.v1Record ? (
        <V1RecordLine label={panel.v1Record.label} />
      ) : null}

      {panel.kind === 'not-registered' ? (
        <>
          {panel.v1Record ? (
            <V1RecordLine label={panel.v1Record.label} />
          ) : null}
          <p className="nft-muted">
            {panel.audience === 'author'
              ? NFT_COPY.notRegisteredAuthor
              : NFT_COPY.notRegistered}
          </p>
        </>
      ) : null}

      {panel.kind === 'progress' ? (
        <ProgressView
          panel={panel}
          busy={flowAction === 'mint' && showFlowHere}
          onMint={() => void nft.mint()}
          onCheckAgain={nft.refreshEligibility}
        />
      ) : null}

      {panel.kind === 'minted' ? (
        <MintedView
          panel={panel}
          onTransfer={() => {
            if (flow.kind !== 'idle' && flowAction === 'transfer') {
              // A finished transfer view is cleared before a new one.
              if (
                flow.kind === 'tracking' &&
                status &&
                status.status !== 'SUBMITTED'
              ) {
                nft.dismiss()
              }
            }
            setTransferOpen(true)
          }}
          transferBusy={flowAction === 'transfer' && !transferOpen}
          triggerRef={transferTrigger}
        />
      ) : null}

      {showFlowHere && flowAction ? (
        <FlowView
          flow={flow}
          status={status}
          onRetry={
            flowAction === 'mint'
              ? () => {
                  nft.dismiss()
                  void nft.mint()
                }
              : () => {
                  nft.dismiss()
                  setTransferOpen(true)
                }
          }
          onDone={nft.dismiss}
          ownerUpdating={NFT_COPY.updatingOwnerDetail}
        />
      ) : null}

      {panel.kind === 'minted' && panel.viewerOwns && panel.token.nftId ? (
        <TransferDialogV2
          open={transferOpen}
          onOpenChange={(open) => {
            setTransferOpen(open)
            if (!open) {
              if (flow.kind === 'review') void nft.cancelReview()
              else if (
                flow.kind === 'refused' ||
                flow.kind === 'gate' ||
                flow.kind === 'notice'
              ) {
                nft.dismiss()
              }
            }
          }}
          triggerRef={transferTrigger}
          tokenId={panel.token.tokenId}
          owner={panel.token.ownerAddress ?? ''}
          platformContracts={nft.platformContracts}
          flow={flow}
          status={status}
          onReview={(recipient) => void nft.prepareTransfer(recipient)}
          onConfirm={() => void nft.confirmTransfer()}
          onBack={() => void nft.cancelReview()}
          onDismiss={nft.dismiss}
        />
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Progress and mint
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Minted
// ---------------------------------------------------------------------------
