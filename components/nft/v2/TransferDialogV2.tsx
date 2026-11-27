'use client'

import { useRef, type RefObject } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { type RecipientInput } from '@/lib/stellar/v2/nft-calls'
import type { NftFlowState, NftSubmissionStatusLike } from '@/lib/nft/v2-flow'
import { NFT_COPY, TRANSFER_COPY } from '@/lib/copy/nft-v2'
import { isTouch } from './isTouch'
import { FlowView } from './NftFlowView'
import { ReviewStep } from './ReviewStep'
import { RecipientForm } from './RecipientForm'
import { StepFocus } from './StepFocus'

/** Prepare refusals that belong to the recipient field. */
const FIELD_CODES = new Set([
  'INVALID_RECIPIENT',
  'RECIPIENT_NOT_FOUND',
  'RECIPIENT_NO_WALLET',
  'SELF_TRANSFER',
])

export interface TransferDialogV2Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
  tokenId: number
  /** The current owner: the viewer's verified address. */
  owner: string
  platformContracts: readonly (string | null | undefined)[]
  flow: NftFlowState
  status: NftSubmissionStatusLike | null | undefined
  onReview: (recipient: RecipientInput) => void
  onConfirm: () => void
  onBack: () => void
  onDismiss: () => void
}

export function TransferDialogV2({
  open,
  onOpenChange,
  triggerRef,
  tokenId,
  owner,
  platformContracts,
  flow,
  status,
  onReview,
  onConfirm,
  onBack,
  onDismiss,
}: TransferDialogV2Props) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const transferFlow =
    flow.kind === 'idle' ||
    (flow.kind === 'review'
      ? flow.prepared.action === 'transfer'
      : flow.action === 'transfer')
      ? flow
      : ({ kind: 'idle' } as const)
  const step =
    transferFlow.kind === 'review'
      ? 'review'
      : transferFlow.kind === 'idle' ||
          transferFlow.kind === 'preparing' ||
          (transferFlow.kind === 'refused' &&
            FIELD_CODES.has(transferFlow.code))
        ? 'form'
        : 'progress'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="nft-dialog nft-v2-dialog"
        onCloseAutoFocus={(event) => {
          if (triggerRef.current) {
            event.preventDefault()
            triggerRef.current.focus()
          }
        }}
        // The form step focuses its own field. On touch that would open the
        // keyboard, so focus moves to the title: inside the dialog, which
        // hides the rest of the page from screen readers.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (isTouch()) titleRef.current?.focus()
        }}
      >
        <DialogHeader className="nft-dialog-header">
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="nft-dialog-title nft-v2-dialog-title"
          >
            {TRANSFER_COPY.dialogTitle}
          </DialogTitle>
          <DialogDescription className="nft-dialog-description">
            {TRANSFER_COPY.dialogDescription}
          </DialogDescription>
        </DialogHeader>
        {step === 'form' ? (
          <RecipientForm
            owner={owner}
            platformContracts={platformContracts}
            preparing={transferFlow.kind === 'preparing'}
            serverError={
              transferFlow.kind === 'refused'
                ? `${transferFlow.copy.title}. ${transferFlow.copy.detail}`
                : null
            }
            onSubmit={onReview}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
        {step === 'review' && transferFlow.kind === 'review' ? (
          <ReviewStep
            flow={transferFlow}
            tokenId={tokenId}
            onConfirm={onConfirm}
            onBack={onBack}
          />
        ) : null}
        {step === 'progress' ? (
          <StepFocus>
            <FlowView
              flow={transferFlow}
              status={status}
              onRetry={onDismiss}
              onDone={() => {
                onDismiss()
                onOpenChange(false)
              }}
              ownerUpdating={NFT_COPY.updatingOwnerDetail}
              headingLevel={3}
            />
          </StepFocus>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Recipient
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------
