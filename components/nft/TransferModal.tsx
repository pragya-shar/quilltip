'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useNFTByArticle } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { Loader2, CheckCircle, AlertCircle, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { userFacingTransferNftError } from '@/lib/convex/userFacingTransferNftError'

type TransferStep = 'details' | 'confirm'

type TransferMessage =
  | { kind: 'none' }
  | { kind: 'progress'; text: string }
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string }

const PROGRESS_COPY = 'Processing transfer...'
const SUCCESS_COPY = 'Transfer completed successfully!'

interface TransferModalProps {
  isOpen: boolean
  onClose: () => void
  articleId: string
  articleTitle: string
  /** Stellar address (or fallback label) shown in the UI */
  currentOwner: string
  /** Username of the current owner; used to block self-transfer on review */
  currentOwnerUsername?: string
  nftId?: Id<'articleNFTs'>
  onTransferComplete?: (newOwner: string) => void
  triggerRef?: RefObject<HTMLElement | null>
}

function validateRecipientUsername(username: string): boolean {
  return /^[a-zA-Z0-9_-]{3,30}$/.test(username)
}

export function TransferModal({
  isOpen,
  onClose,
  articleId,
  articleTitle,
  currentOwner,
  currentOwnerUsername,
  nftId,
  onTransferComplete,
  triggerRef,
}: TransferModalProps) {
  const [recipientUsername, setRecipientUsername] = useState('')
  const [step, setStep] = useState<TransferStep>('details')
  const [transferMessage, setTransferMessage] = useState<TransferMessage>({
    kind: 'none',
  })

  const transferNFT = useMutation(api.nfts.transferNFT)

  const nftData = useNFTByArticle(
    !nftId ? (articleId as Id<'articles'>) : undefined
  )

  const actualNftId =
    nftId || (nftData && nftData.isMinted ? nftData._id : null)

  const nftTokenId =
    nftData && nftData.isMinted && 'tokenId' in nftData ? nftData.tokenId : null

  const nftIdentifier = nftTokenId ?? actualNftId ?? 'Unknown'

  const prevOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setRecipientUsername('')
      setStep('details')
      setTransferMessage({ kind: 'none' })
    }
    prevOpenRef.current = isOpen
  }, [isOpen])

  const isBusy = transferMessage.kind === 'progress'

  const validateTransferInput = (): string | null => {
    if (!recipientUsername.trim()) {
      return 'Please enter a recipient username'
    }

    if (!validateRecipientUsername(recipientUsername)) {
      return 'Invalid username format. Use only letters, numbers, underscores, and hyphens (3-30 characters).'
    }

    const ownerUsername =
      currentOwnerUsername ??
      (nftData && nftData.isMinted ? nftData.ownerInfo?.username : undefined)

    if (
      ownerUsername &&
      recipientUsername.toLowerCase() === ownerUsername.toLowerCase()
    ) {
      return 'Cannot transfer to the current owner'
    }

    if (!actualNftId) {
      return 'NFT not found for this article'
    }

    return null
  }

  const handleReview = () => {
    setTransferMessage({ kind: 'none' })

    const validationError = validateTransferInput()
    if (validationError) {
      setTransferMessage({ kind: 'error', text: validationError })
      return
    }

    setStep('confirm')
  }

  const handleBack = () => {
    if (isBusy) return
    setTransferMessage({ kind: 'none' })
    setStep('details')
  }

  const handleTransfer = async () => {
    setTransferMessage({ kind: 'none' })

    const validationError = validateTransferInput()
    if (validationError) {
      setTransferMessage({ kind: 'error', text: validationError })
      if (step === 'confirm') {
        setStep('details')
      }
      return
    }

    if (!actualNftId) {
      return
    }

    setTransferMessage({ kind: 'progress', text: PROGRESS_COPY })

    try {
      const transferId = await transferNFT({
        nftId: actualNftId,
        toUsername: recipientUsername,
      })

      if (transferId) {
        setTransferMessage({ kind: 'success', text: SUCCESS_COPY })

        toast.success(
          `NFT Transferred Successfully! Article NFT has been transferred to @${recipientUsername}`
        )

        if (onTransferComplete) {
          onTransferComplete(recipientUsername)
        }

        setTimeout(() => {
          handleClose()
        }, 2000)
      } else {
        throw new Error('Transfer failed')
      }
    } catch (error) {
      const text = userFacingTransferNftError(error)
      setTransferMessage({ kind: 'error', text })
      toast.error(text)
    }
  }

  const handleClose = () => {
    if (isBusy) return
    setRecipientUsername('')
    setStep('details')
    setTransferMessage({ kind: 'none' })
    onClose()
  }

  const messageBannerClass =
    transferMessage.kind === 'success'
      ? 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-200'
      : transferMessage.kind === 'error'
        ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-200'
        : transferMessage.kind === 'progress'
          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200'
          : ''

  const messageIcon =
    transferMessage.kind === 'progress' ? (
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
    ) : transferMessage.kind === 'success' ? (
      <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
    ) : transferMessage.kind === 'error' ? (
      <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
    ) : null

  const irreversibleWarning = `You are transferring ownership of the NFT for "${articleTitle}" to @${recipientUsername}. This cannot be undone.`

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose()
      }}
    >
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-x-hidden sm:max-w-md"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault()
            triggerRef.current.focus()
          }
        }}
        onEscapeKeyDown={(e) => {
          if (isBusy) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (isBusy) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {step === 'details' ? 'Transfer NFT Ownership' : 'Confirm transfer'}
          </DialogTitle>
          <DialogDescription>
            {step === 'details'
              ? `Transfer ownership of "${articleTitle}" to another user.`
              : 'Review the details below before completing this transfer.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          {step === 'details' ? (
            <>
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">
                  Current Owner
                </Label>
                <div className="max-w-full overflow-hidden rounded-lg bg-muted px-3 py-2 font-mono text-sm break-all">
                  @{currentOwner}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="recipient">Transfer To (Username)</Label>
                <Input
                  id="recipient"
                  placeholder="Enter recipient username"
                  value={recipientUsername}
                  onChange={(e) => setRecipientUsername(e.target.value)}
                  disabled={isBusy || transferMessage.kind === 'success'}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Enter the username of the recipient (e.g., johndoe)
                </p>
              </div>
            </>
          ) : (
            <>
              <p
                className="min-w-0 break-words rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="transfer-confirm-warning"
              >
                {irreversibleWarning}
              </p>

              <div className="min-w-0 space-y-2 overflow-hidden rounded-md border border-border bg-muted/40 p-3 text-sm">
                <div className="min-w-0">
                  <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Recipient
                  </div>
                  <p
                    className="mt-0.5 font-mono font-medium break-all"
                    data-testid="transfer-confirm-recipient"
                  >
                    @{recipientUsername}
                  </p>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Asset
                  </div>
                  <p
                    className="mt-0.5 break-words font-medium"
                    data-testid="transfer-confirm-asset"
                  >
                    {articleTitle}
                  </p>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    NFT identifier
                  </div>
                  <p
                    className="mt-0.5 font-mono text-xs break-all"
                    data-testid="transfer-confirm-nft-id"
                  >
                    {nftIdentifier}
                  </p>
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Current owner
                  </div>
                  <p
                    className="mt-0.5 font-mono text-xs break-all"
                    data-testid="transfer-confirm-current-owner"
                  >
                    @{currentOwner}
                  </p>
                </div>
              </div>
            </>
          )}

          <div
            className="flex min-h-[3.75rem] items-center rounded-lg"
            data-testid="transfer-modal-message"
            aria-live="polite"
          >
            {transferMessage.kind === 'none' ? (
              <span className="sr-only">No transfer status</span>
            ) : (
              <div
                className={`flex w-full items-center gap-2 rounded-lg p-3 ${messageBannerClass}`}
              >
                {messageIcon}
                <span className="min-w-0 text-sm break-words">
                  {transferMessage.text}
                </span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter
          className={
            step === 'confirm' ? 'sm:flex-row sm:justify-between' : undefined
          }
        >
          {step === 'confirm' ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleBack}
              disabled={isBusy || transferMessage.kind === 'success'}
              className="sm:mr-auto"
            >
              Back
            </Button>
          ) : null}
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={handleClose} disabled={isBusy}>
              Cancel
            </Button>
            {step === 'details' ? (
              <Button
                type="button"
                onClick={handleReview}
                disabled={
                  isBusy ||
                  transferMessage.kind === 'success' ||
                  !recipientUsername.trim()
                }
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              >
                <Send className="mr-2 h-4 w-4" aria-hidden />
                Review transfer
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void handleTransfer()}
                disabled={isBusy || transferMessage.kind === 'success'}
                aria-busy={isBusy}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              >
                {isBusy ? (
                  <>
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden
                    />
                    Confirm transfer
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" aria-hidden />
                    Confirm transfer
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
